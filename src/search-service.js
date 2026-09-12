// 检索服务层：所有补丁查询都走 Meilisearch，禁止在应用层做数组遍历过滤
import { patchesIndex } from './meili-client.js';
import { config } from './config.js';

function escapeFilterValue(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 构造 Meilisearch filter 表达式。
 * 支持：版本（多选）、类型（多选）、时间范围、大小范围
 */
export function buildFilter(q = {}) {
  const parts = [];

  if (q.osVersions) {
    const vals = String(q.osVersions).split(',').map((s) => s.trim()).filter(Boolean);
    if (vals.length) {
      parts.push('( ' + vals.map((v) => `osVersion = "${escapeFilterValue(v)}"`).join(' OR ') + ' )');
    }
  }
  if (q.types) {
    const vals = String(q.types).split(',').map((s) => s.trim()).filter(Boolean);
    if (vals.length) {
      parts.push('( ' + vals.map((v) => `type = "${escapeFilterValue(v)}"`).join(' OR ') + ' )');
    }
  }
  if (q.dateFrom) {
    const t = Date.parse(q.dateFrom);
    if (!Number.isNaN(t)) parts.push(`releasedAtTimestamp >= ${t}`);
  }
  if (q.dateTo) {
    // 结束日期按当天 23:59:59.999 处理，方便前端传 yyyy-mm-dd
    const t = Date.parse(q.dateTo);
    if (!Number.isNaN(t)) parts.push(`releasedAtTimestamp <= ${t + (q.dateTo.length <= 10 ? 86_399_999 : 0)}`);
  }
  if (q.minSizeBytes) {
    const n = Number(q.minSizeBytes);
    if (Number.isFinite(n)) parts.push(`sizeBytes >= ${n}`);
  }
  if (q.maxSizeBytes) {
    const n = Number(q.maxSizeBytes);
    if (Number.isFinite(n)) parts.push(`sizeBytes <= ${n}`);
  }

  return parts.join(' AND ');
}

const SORT_MAP = {
  time_desc: ['releasedAtTimestamp:desc'],
  time_asc: ['releasedAtTimestamp:asc'],
  size_desc: ['sizeBytes:desc'],
  size_asc: ['sizeBytes:asc'],
  name_asc: ['name:asc'],
};

/**
 * 搜索补丁。
 * @returns {Promise<{hits:number, items:any[], page:number, totalPages:number, processingTimeMs:number, query:string}>}
 */
export async function searchPatches(rawQuery = {}) {
  const q = String(rawQuery.q || '').trim();
  const page = Math.max(1, Number.parseInt(rawQuery.page || '1', 10) || 1);
  const limit = config.pageSize;
  const filter = buildFilter(rawQuery);
  const sort = SORT_MAP[rawQuery.sort] || SORT_MAP.time_desc;

  // 真正调用搜索引擎（POST /indexes/patches/search）
  const res = await patchesIndex.search(q, {
    filter: filter || undefined,
    sort,
    limit,
    offset: (page - 1) * limit,
    attributesToHighlight: ['name', 'summary'],
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
  });

  return {
    query: q,
    hits: res.estimatedTotalHits ?? res.hits.length,
    page,
    pageSize: limit,
    totalPages: Math.max(1, Math.ceil((res.estimatedTotalHits ?? 0) / limit)),
    processingTimeMs: res.processingTimeMs,
    items: res.hits,
  };
}

/**
 * 获取过滤面板所需的聚合选项（版本列表、类型列表）。
 * 通过搜索引擎的 distinct / 文档统计获得，不在内存里遍历。
 */
export async function getFacets() {
  // search 接口的 facetsDistribution 是搜索引擎侧聚合
  const res = await patchesIndex.search('', {
    facets: ['osVersion', 'type'],
    limit: 0,
  });
  const dist = res.facetDistribution || {};
  const osVersions = Object.entries(dist.osVersion || {})
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, 'zh-CN'));
  const types = Object.entries(dist.type || {})
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
  return { osVersions, types };
}

/** 概览统计（文档总数、搜索引擎耗时） */
export async function overview() {
  const [stats, facets] = await Promise.all([patchesIndex.getStats(), getFacets()]);
  return {
    totalDocuments: stats.numberOfDocuments,
    isIndexing: stats.isIndexing,
    facets,
  };
}
