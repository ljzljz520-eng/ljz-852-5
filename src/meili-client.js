// 搜索引擎客户端：Meilisearch（独立运行的真实搜索引擎，不是数组遍历模拟）
import { Meilisearch } from 'meilisearch';
import { config } from './config.js';

export const meili = new Meilisearch({
  host: config.meili.host,
  apiKey: config.meili.apiKey,
});

export const patchesIndex = meili.index(config.meili.patchesIndex);

/** 等待索引任务完成（不同版本 SDK 兼容封装） */
export async function waitTask(taskUid) {
  return meili.tasks.waitForTask(taskUid, { timeOutMs: 60_000, intervalMs: 200 });
}

/**
 * 初始化索引与检索配置。幂等，可反复调用。
 */
export async function ensureIndex() {
  const name = config.meili.patchesIndex;
  try {
    await meili.getIndex(name);
  } catch {
    // 索引不存在则创建，显式声明主键
    await waitTask((await meili.createIndex(name, { primaryKey: 'id' })).taskUid);
  }

  const idx = meili.index(name);
  // 可过滤字段：版本 / 类型 / 时间范围 / 大小范围
  await waitTask((await idx.updateFilterableAttributes([
    'osVersion',
    'type',
    'releasedAtTimestamp',
    'sizeBytes',
  ])).taskUid);
  // 可排序字段：时间、大小、名称
  await waitTask((await idx.updateSortableAttributes([
    'releasedAtTimestamp',
    'sizeBytes',
    'name',
  ])).taskUid);
  // 搜索字段：名称 / 摘要 / 版本 / 类型 / KB编号
  await waitTask((await idx.updateSearchableAttributes([
    'name',
    'summary',
    'osVersion',
    'type',
    'kbId',
  ])).taskUid);
  // 相关性排序规则（Meilisearch 内置 charabia 分词器支持中日韩）
  await waitTask((await idx.updateRankingRules([
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',
    'exactness',
  ])).taskUid);
  return idx;
}

/** 健康检查，供 /api/health 使用 */
export async function ping() {
  return meili.health();
}
