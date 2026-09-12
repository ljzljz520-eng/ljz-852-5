// 补丁包索引站 - HTTP 服务
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { ensureIndex, ping } from './meili-client.js';
import { searchPatches, getFacets, overview } from './search-service.js';
import { importRecords, parsePayload, TYPES } from './importer.js';
import * as hotwords from './hotword-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(PUBLIC_DIR));

function wrap(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[api error]', err);
    res.status(500).json({ error: err.message || String(err) });
  });
}

// 健康检查：同时报告搜索引擎状态
app.get('/api/health', wrap(async (_req, res) => {
  let searchEngine = 'down';
  try { await ping(); searchEngine = 'up'; } catch {}
  res.json({ status: 'ok', searchEngine, engine: 'meilisearch', host: config.meili.host });
}));

app.get('/api/types', wrap(async (_req, res) => res.json({ types: TYPES })));

app.get('/api/facets', wrap(async (_req, res) => res.json(await getFacets())));

app.get('/api/overview', wrap(async (_req, res) => res.json(await overview())));

// 补丁检索：q + 版本/时间/类型/大小过滤 —— 全部下发给搜索引擎
app.get('/api/patches', wrap(async (req, res) => {
  const result = await searchPatches(req.query);
  // 后台记录搜索热词（空关键词不过滤浏览不记录，只记录真实检索）
  if (result.query) hotwords.record(result.query, result.hits);
  res.json(result);
}));

// 导入：multipart 表单太重，这里支持 JSON body 直传 / base64 文件载荷
app.post('/api/import', wrap(async (req, res) => {
  const { format = 'csv', content, mode = 'upsert', records } = req.body || {};
  let docs;
  if (Array.isArray(records)) {
    docs = records;
  } else if (typeof content === 'string') {
    docs = parsePayload(content, format === 'json' ? 'json' : 'csv');
  } else {
    return res.status(400).json({ error: '需要 records 数组或 content 文本（CSV/JSON）' });
  }
  const out = await importRecords(docs, { mode });
  res.json({ ok: true, ...out });
}));

// ---- 热词后台 ----
app.get('/api/admin/hotwords', wrap(async (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 20);
  res.json({
    stats: hotwords.stats(),
    top: hotwords.top(limit, { withZero: req.query.withZero === '1' }),
  });
}));

app.delete('/api/admin/hotwords', wrap(async (_req, res) => {
  hotwords.clearAll();
  res.json({ ok: true });
}));

app.delete('/api/admin/hotwords/:word', wrap(async (req, res) => {
  hotwords.removeWord(decodeURIComponent(req.params.word));
  res.json({ ok: true });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

// SPA 回退（非 API 的 GET 请求一律返回入口页）
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  }
  next();
});

async function main() {
  await ensureIndex();
  hotwords.load();
  app.listen(config.port, () => {
    console.log(`补丁索引站已启动: http://127.0.0.1:${config.port}`);
    console.log(`搜索引擎: Meilisearch @ ${config.meili.host} (index=${config.meili.patchesIndex})`);
  });
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});

// 优雅退出时落盘热词
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { hotwords.flush(); } catch {} process.exit(0); });
}
