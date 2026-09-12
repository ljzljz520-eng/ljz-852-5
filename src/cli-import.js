// 命令行导入：node src/cli-import.js <文件.csv|文件.json> [--replace]
import path from 'node:path';
import { ensureIndex } from './meili-client.js';
import { importFile, TYPES } from './importer.js';

const file = process.argv[2];
const mode = process.argv.includes('--replace') ? 'replace' : 'upsert';

if (!file) {
  console.error('用法: node src/cli-import.js <补丁数据.csv|.json> [--replace]');
  console.error('支持类型:', TYPES.join('、'));
  process.exit(1);
}

const t0 = Date.now();
await ensureIndex();
const result = await importFile(path.resolve(file), { mode });
console.log(`\n导入完成，耗时 ${Date.now() - t0} ms`);
console.log(`  成功写入: ${result.inserted} 条`);
if (result.errors.length) {
  console.log(`  校验失败: ${result.errors.length} 行`);
  for (const e of result.errors.slice(0, 20)) {
    console.log(`    第 ${e.row} 行 [${e.name}]: ${e.problems.join('；')}`);
  }
  if (result.errors.length > 20) console.log(`    ...另有 ${result.errors.length - 20} 行`);
  process.exitCode = 2;
}
process.exit(0);
