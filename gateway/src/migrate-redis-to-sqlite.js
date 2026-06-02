// 一次性迁移脚本：将 Redis 中的 templates 和 cookies 导入 SQLite
// 运行一次后可删除此文件
// 用法：node gateway/src/migrate-redis-to-sqlite.js

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createRedisClient } = require('./redis');
const config        = require('./config');
const TaskStoreSQLite = require('./task-store-sqlite');

async function main() {
  const redis       = createRedisClient(config.redis);
  await redis.connect();
  const sqlite      = new TaskStoreSQLite();

  // ─── 模板迁移 ─────────────────────────────────────────────────────────────
  const templateNames = await redis.zrevrange('templates:index', 0, -1);
  console.log(`模板: 共 ${templateNames.length} 条`);
  for (const name of templateNames) {
    const raw = await redis.get(`template:${name}`);
    if (!raw) continue;
    try {
      const tpl = JSON.parse(raw);
      await sqlite.setTemplate(name, tpl);
      console.log(`  ✓ 模板 ${name}`);
    } catch (err) {
      console.error(`  ✗ 模板 ${name}: ${err.message}`);
    }
  }

  // ─── Cookie 迁移 ──────────────────────────────────────────────────────────
  const uids = await redis.zrevrange('cookies:index', 0, -1);
  console.log(`Cookie: 共 ${uids.length} 条`);
  if (uids.length > 0) {
    const vals = await redis.hmget('cookies:map', ...uids);
    for (const v of vals) {
      if (!v) continue;
      try {
        const data = JSON.parse(v);
        await sqlite.addCookie(data.task_id ?? '', data);
        console.log(`  ✓ Cookie uid=${data.user_unique_id ?? '—'}`);
      } catch (err) {
        console.error(`  ✗ Cookie: ${err.message}`);
      }
    }
  }

  await redis.disconnect();
  console.log('迁移完成');
}

main().catch(err => { console.error(err); process.exit(1); });
