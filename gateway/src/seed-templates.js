/**
 * 内置模版初始化脚本
 * 运行：node gateway/src/seed-templates.js
 * 已存在同名模版时跳过（不覆盖）。
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { createRedisClient } = require('./redis');
const TaskStore = require('./task-store');
const config    = require('./config');

// ─── 模版定义 ─────────────────────────────────────────────────────────────────

const TEMPLATES = [

  // ── 抖音直播挂机（IM Cookie 采集）────────────────────────────────────────
  {
    name       : '抖音挂机',
    description: '进入直播间，被动监听 webcast/im/fetch 请求采集 Cookie，全程静音暂停视频',
    task_time  : 3600,
    pipeline   : [
      {
        type     : 'navigate',
        url      : 'https://live.douyin.com',
        waitUntil: 'commit',
      },
      {
        type: 'wait',
        min : 10000,
        max : 12000,
      },
      {
        type     : 'navigate',
        url      : '{target_url}',
        waitUntil: 'commit',
      },
      {
        type: 'antidetect',
      },
      {
        type: 'run-code',
        // 被动监听 page.on('request')，捕获 IM 请求中的 cookie / uid / ua
        // ctrl 已由 run-code 传入，包含 profile / task_id
        code: `async ({ page, context, ctrl }) => {
  const base = (process.env.CENTER_NOTIFY_URL ?? '').replace(/\\/notify$/, '');
  if (!base) return;

  const reported = new Set();

  page.on('request', req => {
    if (!req.url().includes('webcast/im/fetch/?resp_content_type')) return;

    const h      = req.headers();
    const cookie = h['cookie'] || '';
    if (!cookie) return;

    let uid = '';
    try { uid = new URL(req.url()).searchParams.get('user_unique_id') || ''; } catch {}

    // 同一个 uid 本次任务只上报一次
    if (uid && reported.has(uid)) return;
    if (uid) reported.add(uid);

    fetch(base + '/api/cookies', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        profile        : ctrl.profile,
        task_id        : ctrl.task_id,
        worker_id      : process.env.WORKER_ID ?? '',
        cookie,
        user_agent     : h['user-agent'] || '',
        user_unique_id : uid,
        timestamp      : Date.now(),
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  });
}`,
      },
      {
        type    : 'pause-video',
        selector: 'video',
        all     : false,
      },
      {
        type    : 'mute-video',
        selector: 'video',
        mute    : true,
        all     : false,
      },
      {
        type: 'dwell',
      },
    ],
  },

];

// ─── 写入 Redis ───────────────────────────────────────────────────────────────

async function main() {
  const redis = createRedisClient(config.redis);
  await redis.connect();
  const store = new TaskStore(redis);

  for (const tpl of TEMPLATES) {
    const existing = await store.getTemplate(tpl.name);
    if (existing) {
      console.log(`[跳过] "${tpl.name}" 已存在`);
      continue;
    }
    await store.setTemplate(tpl.name, tpl);
    console.log(`[写入] "${tpl.name}"`);
  }

  await redis.disconnect();
  console.log('\n完成。');
}

main().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
