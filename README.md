# 软件补丁包索引站（Patch Index）

一个面向企业补丁管理场景的补丁包索引 / 检索站：

- **补丁导入**：补丁名称、系统版本、文件数量、大小、发布时间、摘要、类型、KB 编号
- **多维过滤**：系统版本（多选）、补丁类型、发布时间区间、文件大小区间 + 5 种排序
- **全文检索**：检索层接入真实搜索引擎 **Meilisearch**（HTTP API + 任务化索引），
  应用层不做任何数组遍历式"伪全文搜索"
- **热词后台**：记录每次真实检索的关键词、次数、命中数、时间，支持零结果词分析 / 删除 / 清空，
  并在首页展示"大家在搜"

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | 原生 HTML/CSS/JS 单页（无构建） |
| 后端 | Node.js 20 + Express |
| **搜索引擎** | **Meilisearch 1.10**（filterable / sortable / facet 聚合 / 高亮） |
| 热词存储 | 内存计数 + JSON 文件原子落盘（可平滑换成 Redis/MySQL） |
| 编排 | Docker Compose（或本地二进制） |

> 选择 Meilisearch 的原因：单二进制、无需 JVM、中文分词开箱即用（内置 Charabia）。
> 检索层被封装在 `src/search-service.js`，如要替换成 Elasticsearch / OpenSearch，只需实现
> `buildFilter / searchPatches / getFacets` 三个函数。

## 目录结构

```
src/
  config.js          环境变量配置
  meili-client.js    搜索引擎连接、索引与字段配置（可过滤/可排序/搜索字段权重）
  search-service.js  检索层：关键词 + filter 表达式 + 排序 + 分页 + facet 聚合
  importer.js        CSV/JSON 解析、字段映射、数据校验、批量索引
  cli-import.js      命令行导入工具
  hotword-store.js   搜索热词计数与持久化
  server.js          Express 路由（检索 / 导入 / 热词后台 / 健康检查）
public/              前端页面
data/sample-patches.csv  示例数据（28 条，覆盖 8 种补丁类型）
docker-compose.yml  一键编排（搜索引擎 + Web）
```

## 快速开始

### 方式 A：Docker Compose（推荐）

```bash
docker compose up -d
# 导入示例数据
docker compose exec web node src/cli-import.js data/sample-patches.csv --replace
```

打开 http://localhost:3000

### 方式 B：本地运行（当前环境无 Docker 时）

```bash
# 1. 安装依赖
npm install
# 2. 启动搜索引擎（首次自动下载 Meilisearch 二进制到 .bin/）
npm run engine        # 监听 127.0.0.1:7700
# 3. 另开终端，启动 Web 并导入示例数据
npm run import:sample
npm start
```

打开 http://127.0.0.1:3000

## 导入格式

CSV（首行表头，列名兼容中英文）：

```csv
补丁名称,系统版本,类型,文件数量,大小,发布时间,摘要,KB编号
Windows 11 24H2 累积更新,Windows 11 24H2,累积更新,19,768.3 MB,2026-09-10,修复搜索框无响应…,KB5046228
```

- **大小**：支持 `B / KB / MB / GB / TB` 后缀或纯字节数
- **发布时间**：任意 ISO 可解析日期
- **类型**：安全更新、累积更新、功能更新、服务堆栈更新、驱动更新、紧急补丁、语言包、其他
- 校验失败的行会在导入报告中逐行给出原因，不影响合法行写入

导入途径：

1. 页面「数据导入」：上传 `.csv/.json` 或直接粘贴文本，支持 upsert / 全量替换
2. CLI：`node src/cli-import.js <文件> [--replace]`
3. API：`POST /api/import`

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/patches?q=&osVersions=&types=&dateFrom=&dateTo=&minSizeBytes=&maxSizeBytes=&sort=&page=` | 检索（真实请求 Meilisearch `/search`），有关键词时记录热词 |
| GET | `/api/facets` | 版本 / 类型聚合（引擎侧 facetDistribution，非内存遍历） |
| GET | `/api/overview` | 索引文档总数与聚合 |
| POST | `/api/import` | 导入（body: `{format, content, mode}` 或 `{records, mode}`） |
| GET | `/api/admin/hotwords?limit=&withZero=0|1` | 热词榜 + 统计 |
| DELETE | `/api/admin/hotwords` | 清空热词 |
| DELETE | `/api/admin/hotwords/:word` | 删除单个热词 |
| GET | `/api/health` | Web 与搜索引擎健康状态 |

## 设计说明：为什么不是数组 filter？

`GET /api/patches` 的处理流程：

1. 解析查询参数，编译为 Meilisearch filter 表达式
   （如 `` osVersion = "Windows 11 24H2" AND releasedAtTimestamp >= 1751328000000 ``）
2. 调用 `index.search(q, { filter, sort, limit, offset })` —— 由搜索引擎完成
   倒排索引召回、拼写容错、相关性排名、字段高亮、facet 聚合
3. 返回引擎统计的命中数与处理耗时（`estimatedTotalHits / processingTimeMs`）

应用层从不把全部文档读进内存再 `.filter()`；facet 计数同样来自引擎的 `facetDistribution`。
