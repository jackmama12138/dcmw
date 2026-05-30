/**
 * 一次性数据迁移脚本
 *
 * 迁移内容：
 *   1. ranklist: ranklist:all (list) → ranklist:map (hash) + ranklist:index (sorted set)
 *   2. screenshots: data/screenshots/{taskId}/*.jpg → data/screenshots/*.jpg (平铺)
 *
 * 运行：node gateway/src/migrate.js
 * 迁移完成后可删除本文件。
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const { createRedisClient } = require('./redis');
const config = require('./config');

const SCREENSHOTS_DIR = path.resolve(__dirname, '../data/screenshots');

async function migrateRanklist(redis) {
  const total = await redis.llen('ranklist:all');
  if (!total) {
    console.log('[ranklist] 无旧数据，跳过');
    return;
  }

  const items = await redis.lrange('ranklist:all', 0, -1);
  let migrated = 0, skipped = 0;

  for (const raw of items) {
    try {
      const data = JSON.parse(raw);
      const key  = `${data.worker_id}:${data.profile}`;
      const ts   = data.timestamp || Date.now();

      // 只在新 hash 里没有该 key，或旧数据更新时才写入
      const existing = await redis.hget('ranklist:map', key);
      if (!existing || JSON.parse(existing).timestamp < ts) {
        await redis.hset('ranklist:map', key, raw);
        await redis.zadd('ranklist:index', ts, key);
        migrated++;
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  // 保留旧 key 备份，改名而不是删除
  await redis.rename('ranklist:all', 'ranklist:all_migrated').catch(() => {});
  console.log(`[ranklist] 迁移完成：${migrated} 条写入，${skipped} 条跳过`);
  console.log('[ranklist] 旧 key 已重命名为 ranklist:all_migrated（确认无误后可 DEL）');
}

async function migrateScreenshots() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    console.log('[screenshots] 目录不存在，跳过');
    return;
  }

  const entries = fs.readdirSync(SCREENSHOTS_DIR, { withFileTypes: true });
  const subdirs = entries.filter(e => e.isDirectory());

  if (!subdirs.length) {
    console.log('[screenshots] 无子目录，跳过');
    return;
  }

  let moved = 0, skipped = 0;

  for (const dir of subdirs) {
    const subPath = path.join(SCREENSHOTS_DIR, dir.name);
    let files;
    try {
      files = fs.readdirSync(subPath).filter(f => f.endsWith('.jpg'));
    } catch {
      continue;
    }

    for (const file of files) {
      const src = path.join(subPath, file);
      const dst = path.join(SCREENSHOTS_DIR, file);

      if (fs.existsSync(dst)) {
        // 目标已存在：比较时间戳，保留更新的
        const srcTs = extractTs(file);
        const dstTs = extractTs(path.basename(dst));
        if (srcTs <= dstTs) { skipped++; continue; }
      }

      try {
        fs.copyFileSync(src, dst);
        moved++;
      } catch (err) {
        console.warn(`  [screenshots] 复制失败 ${file}: ${err.message}`);
        skipped++;
      }
    }
  }

  console.log(`[screenshots] 迁移完成：${moved} 张复制，${skipped} 张跳过`);
  console.log('[screenshots] 旧子目录文件已复制，原目录未删除（确认无误后可手动清理）');
}

function extractTs(filename) {
  // 格式：{profile}_{timestamp}.jpg
  const parts = filename.replace('.jpg', '').split('_');
  return parseInt(parts[parts.length - 1]) || 0;
}

async function main() {
  const redis = createRedisClient(config.redis);
  await redis.connect();
  console.log('Redis 已连接\n');

  try {
    await migrateRanklist(redis);
    console.log('');
    await migrateScreenshots();
  } finally {
    await redis.disconnect();
  }

  console.log('\n迁移完毕。');
}

main().catch(err => {
  console.error('迁移失败:', err.message);
  process.exit(1);
});
