// 搜索热词存储：内存计数 + JSON 文件持久化（带防抖落盘，避免高频写）
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = path.resolve(config.hotwordsFile);

// word -> { word, count, lastResultCount, firstAt, lastAt }
const words = new Map();
let loaded = false;
let flushTimer = null;

export function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(FILE, 'utf-8');
    const arr = JSON.parse(raw);
    for (const item of arr) words.set(item.word, item);
  } catch {
    // 文件不存在或损坏时从空开始
  }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 1500);
}

export function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const arr = [...words.values()].sort((a, b) => b.count - a.count);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, FILE); // 原子替换
}

/** 规范化搜索词 */
export function normalizeWord(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

/**
 * 记录一次搜索。
 * @param {string} rawWord 用户原始输入
 * @param {number} resultCount 命中数量（用于区分零结果热词）
 */
export function record(rawWord, resultCount = 0) {
  load();
  const word = normalizeWord(rawWord);
  if (!word) return;
  const now = Date.now();
  const hit = words.get(word);
  if (hit) {
    hit.count += 1;
    hit.lastResultCount = resultCount;
    hit.lastAt = now;
  } else {
    words.set(word, {
      word,
      count: 1,
      lastResultCount: resultCount,
      firstAt: now,
      lastAt: now,
    });
  }
  scheduleFlush();
}

/**
 * Top N 热词。
 * @param {number} limit
 * @param {object} opts { withZero: 是否包含零结果词 }
 */
export function top(limit = 20, opts = {}) {
  load();
  let arr = [...words.values()];
  if (!opts.withZero) arr = arr.filter((w) => w.lastResultCount > 0);
  arr.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  return arr.slice(0, limit);
}

export function stats() {
  load();
  return {
    distinctWords: words.size,
    totalSearches: [...words.values()].reduce((s, w) => s + w.count, 0),
    zeroResultWords: [...words.values()].filter((w) => w.lastResultCount === 0).length,
  };
}

export function clearAll() {
  words.clear();
  flush();
}

export function removeWord(word) {
  words.delete(normalizeWord(word));
  flush();
}
