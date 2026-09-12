// 全局配置，全部可通过环境变量覆盖
export const config = {
  port: Number(process.env.PORT || 3000),
  meili: {
    host: process.env.MEILI_HOST || 'http://127.0.0.1:7700',
    // 管理端使用 master key（需要建索引 / 改设置 / 写数据）
    apiKey: process.env.MEILI_API_KEY || 'patchIndexDevKey2026',
    patchesIndex: process.env.MEILI_INDEX || 'patches',
    // 查询超时
    timeout: 10000,
  },
  hotwordsFile: process.env.HOTWORDS_FILE || 'data/hotwords.json',
  pageSize: 10,
};
