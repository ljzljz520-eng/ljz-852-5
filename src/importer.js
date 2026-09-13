// 补丁数据导入：支持 CSV / JSON，字段映射 + 校验 + 批量写入搜索引擎
import fs from 'node:fs';
import { patchesIndex, waitTask } from './meili-client.js';

// 允许的补丁类型
export const TYPES = ['安全更新', '累积更新', '功能更新', '服务堆栈更新', '驱动更新', '紧急补丁', '语言包', '其他'];

/** 极简但支持引号/逗号/换行的 CSV 解析（零依赖） */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function parseSize(v) {
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return Math.round(n * (mult[(m[2] || 'B').toUpperCase()] || 1));
}

function coerce(row, idx, errors) {
  const get = (...keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return String(row[k]).trim();
    }
    return '';
  };
  const name = get('补丁名称', 'name', 'title');
  const osVersion = get('系统版本', 'osVersion', 'os_version', 'platform');
  const type = get('类型', 'type', 'patchType', 'category');
  const summary = get('摘要', 'summary', 'description', 'desc');
  const releasedAt = get('发布时间', 'releasedAt', 'release_date', 'date', 'publishedAt');
  const fileCountRaw = get('文件数量', 'fileCount', 'files', 'file_count');
  const sizeRaw = row['大小'] ?? row['size'] ?? row['sizeBytes'] ?? row['size_bytes'] ?? '';
  const kbId = get('KB编号', 'kbId', 'kb');

  const problems = [];
  if (!name) problems.push('缺少补丁名称');
  if (!osVersion) problems.push('缺少系统版本');
  if (!type) problems.push('缺少类型');
  if (!summary) problems.push('缺少摘要');
  if (!releasedAt || Number.isNaN(Date.parse(releasedAt))) problems.push(`发布时间无效: "${releasedAt}"`);

  // 文件数量必须为非负整数（parseInt 会把 "12abc" 截断成 12，因此先做严格格式校验）
  if (!/^\d+$/.test(fileCountRaw)) problems.push(`文件数量无效: "${fileCountRaw}"`);
  const fileCount = Number.parseInt(fileCountRaw, 10);
  const sizeBytes = parseSize(typeof sizeRaw === 'string' ? sizeRaw : sizeRaw);
  if (sizeBytes === null || sizeBytes < 0) problems.push(`大小无效: "${sizeRaw}"`);
  if (type && !TYPES.includes(type)) problems.push(`类型不在允许列表: "${type}"（允许：${TYPES.join('/')}）`);

  if (problems.length) {
    errors.push({ row: idx + 1, name: name || '(无名)', problems });
    return null;
  }

  const t = Date.parse(releasedAt);
  // Meilisearch 主键只允许 A-Za-z0-9_-，需把中文版本名等清洗掉
  const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '');
  const explicitId = get('id') ? safe(get('id')) : '';
  const id = explicitId
    || `${safe(kbId) || 'PATCH'}-${safe(osVersion) || 'OS'}-${t}-${idx}`;
  return {
    id,
    name,
    osVersion,
    type,
    fileCount,
    sizeBytes,
    sizeText: formatSize(sizeBytes),
    releasedAt: new Date(t).toISOString(),
    releasedAtTimestamp: t,
    releasedDate: new Date(t).toISOString().slice(0, 10),
    summary,
    kbId: kbId || null,
  };
}

export function formatSize(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** 从文件内容 + 类型解析为补丁对象数组 */
export function parsePayload(content, fileType) {
  let records;
  if (fileType === 'json') {
    const data = JSON.parse(content);
    records = Array.isArray(data) ? data : data.patches;
    if (!Array.isArray(records)) throw new Error('JSON 顶层需为数组或含 patches 数组的对象');
  } else {
    const rows = parseCSV(content);
    if (rows.length < 2) throw new Error('CSV 至少需要表头 + 一行数据');
    const header = rows[0].map((h) => h.trim());
    records = rows.slice(1).map((cells) => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
      return obj;
    });
  }
  return records;
}

/**
 * 导入主入口。
 * @returns {Promise<{inserted:number, errors:Array[]}>}
 */
export async function importRecords(records, { mode = 'upsert' } = {}) {
  const errors = [];
  const docs = [];
  records.forEach((r, i) => {
    const doc = coerce(r, i, errors);
    if (doc) docs.push(doc);
  });

  if (mode === 'replace') {
    const del = await patchesIndex.deleteAllDocuments();
    await waitTask(del.taskUid);
  }
  if (docs.length) {
    const task = await patchesIndex.addDocuments(docs);
    await waitTask(task.taskUid);
  }
  return { inserted: docs.length, errors };
}

/** 从文件路径导入（CLI 用） */
export async function importFile(filePath, opts) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = filePath.toLowerCase().endsWith('.json') ? 'json' : 'csv';
  const records = parsePayload(content, ext);
  return importRecords(records, opts);
}
