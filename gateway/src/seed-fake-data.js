/**
 * 假数据填充脚本（仅用于 UI 预览）
 * 运行：node gateway/src/seed-fake-data.js
 * 使用 SQLite 后端直接写入，不依赖 gateway 进程。
 */

process.env.STORAGE_BACKEND = 'sqlite';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../../data/dcmw.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── 确保表存在 ────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    task_id    TEXT    PRIMARY KEY,
    data       TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS templates (
    name       TEXT    PRIMARY KEY,
    data       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cookies (
    uid       TEXT    PRIMARY KEY,
    data      TEXT    NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS captures (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT    NOT NULL,
    data       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ranklist (
    key       TEXT    PRIMARY KEY,
    data      TEXT    NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS screenshots_meta (
    filename TEXT PRIMARY KEY,
    data     TEXT NOT NULL
  );
`);

// ─── 工具函数 ──────────────────────────────────────────────────────────────

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[rand(0, arr.length - 1)];
const uid = () => Math.random().toString(36).slice(2, 10);

const WORKERS = ['worker-win-01', 'worker-win-02', 'worker-win-03', 'worker-mac-01'];
const TASK_TYPES = ['douyin-live', 'cookie-harvest', 'screenshot', 'ranklist-scan'];
const URLS = [
  'https://live.douyin.com/123456789',
  'https://live.douyin.com/987654321',
  'https://live.douyin.com/555888999',
  'https://live.douyin.com/111222333',
  'https://live.douyin.com/444777000',
];
const STATUSES = ['pending', 'running', 'done', 'done', 'done']; // done 多一些更真实
const PROFILES = ['chrome_01', 'chrome_02', 'chrome_03', 'chrome_04', 'chrome_05',
                  'chrome_06', 'chrome_07', 'chrome_08', 'chrome_09', 'chrome_10'];
const DOUYIN_NAMES = ['小红书用户', '抖音达人', '直播小助手', '电商运营', '带货主播',
                      '美食博主', '游戏玩家', '时尚达人', '宠物博主', '旅行者'];

// ─── 生成 Tasks ────────────────────────────────────────────────────────────

console.log('\n📋 生成 Tasks...');
const insertTask = db.prepare(
  'INSERT OR IGNORE INTO tasks (task_id, data, status, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, ?)'
);

let taskCount = 0;
const now = Date.now();

for (let i = 0; i < 80; i++) {
  const taskId = `task_${uid()}`;
  const status = pick(STATUSES);
  const count = rand(10, 200);
  const completed = status === 'done' ? count : rand(0, count - 1);
  const failed = status === 'done' ? 0 : rand(0, Math.floor((count - completed) / 3));
  const running = status === 'running' ? rand(1, Math.min(5, count - completed - failed)) : 0;
  const createdAt = now - rand(0, 7 * 24 * 3600 * 1000); // 最近 7 天内
  const worker = pick(WORKERS);
  const taskType = pick(TASK_TYPES);

  const task = {
    task_id: taskId,
    target_url: pick(URLS),
    task_type: taskType,
    pipeline: [{ type: 'navigate', url: pick(URLS) }, { type: 'dwell' }],
    task_time: rand(1800, 7200),
    count,
    running,
    completed,
    failed,
    status,
    target_worker_id: worker,
    target_node: `node_${rand(1, 8)}`,
    created_at: createdAt,
    updated_at: createdAt + rand(60000, 3600000),
  };

  const isActive = status !== 'done' ? 1 : 0;
  insertTask.run(taskId, JSON.stringify(task), status, task.created_at, task.updated_at, isActive);
  taskCount++;
}
console.log(`  ✓ 插入 ${taskCount} 条 tasks`);

// ─── 生成 Cookies ──────────────────────────────────────────────────────────

console.log('\n🍪 生成 Cookies...');
const insertCookie = db.prepare(
  'INSERT OR IGNORE INTO cookies (uid, data, timestamp) VALUES (?, ?, ?)'
);

let cookieCount = 0;
for (let i = 0; i < 150; i++) {
  const profile = pick(PROFILES);
  const userId = `${rand(10000000000, 99999999999)}`;
  const cookieTs = now - rand(0, 3 * 24 * 3600 * 1000);
  const cookieData = {
    profile,
    task_id: `task_${uid()}`,
    worker_id: pick(WORKERS),
    cookie: `passport_csrf_token=abc${uid()}; sessionid=xyz${uid()}; ttwid=1%7C${uid()}%7C1; msToken=${uid()}${uid()}`,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    user_unique_id: userId,
    timestamp: cookieTs,
  };
  insertCookie.run(userId, JSON.stringify(cookieData), cookieTs);
  cookieCount++;
}
console.log(`  ✓ 插入 ${cookieCount} 条 cookies`);

// ─── 生成 Captures ────────────────────────────────────────────────────────

console.log('\n📸 生成 Captures...');
const insertCapture = db.prepare(
  'INSERT INTO captures (task_id, data, created_at) VALUES (?, ?, ?)'
);

// 先查已有 task_id
const existingTasks = db.prepare('SELECT task_id FROM tasks LIMIT 20').all().map(r => r.task_id);

let captureCount = 0;
for (const taskId of existingTasks.slice(0, 15)) {
  const n = rand(3, 12);
  for (let j = 0; j < n; j++) {
    const name = pick(DOUYIN_NAMES);
    const captureTs = now - rand(0, 24 * 3600 * 1000);
    const data = {
      type: 'user_profile',
      nickname: `${name}${rand(100, 999)}`,
      user_id: `${rand(10000000, 99999999)}`,
      followers: rand(100, 5000000),
      following: rand(10, 2000),
      likes: rand(0, 10000000),
      live_url: pick(URLS),
      captured_at: captureTs,
    };
    insertCapture.run(taskId, JSON.stringify(data), captureTs);
    captureCount++;
  }
}
console.log(`  ✓ 插入 ${captureCount} 条 captures`);

// ─── 生成 Ranklist ────────────────────────────────────────────────────────

console.log('\n🏆 生成 Ranklist...');
const insertRanklist = db.prepare(
  'INSERT OR REPLACE INTO ranklist (key, data, timestamp) VALUES (?, ?, ?)'
);

let rankCount = 0;
for (const worker of WORKERS) {
  for (const profile of PROFILES) {
    const ts = now - rand(0, 2 * 3600 * 1000);
    const data = {
      worker_id: worker,
      profile,
      score: rand(0, 9999),
      level: rand(1, 60),
      nickname: `${pick(DOUYIN_NAMES)}${rand(10, 99)}`,
      user_id: `${rand(10000000, 99999999)}`,
      task_id: `task_${uid()}`,
      timestamp: ts,
    };
    insertRanklist.run(`${worker}:${profile}`, JSON.stringify(data), ts);
    rankCount++;
  }
}
console.log(`  ✓ 插入 ${rankCount} 条 ranklist`);

// ─── 生成 Templates ───────────────────────────────────────────────────────

console.log('\n📝 生成 Templates...');
const insertTemplate = db.prepare(
  'INSERT OR IGNORE INTO templates (name, data, created_at) VALUES (?, ?, ?)'
);

const templates = [
  { name: '抖音挂机', description: '进入直播间采集 IM Cookie' },
  { name: '截图巡检', description: '定期对直播间截图存档' },
  { name: 'Ranklist 扫描', description: '抓取直播间排行榜数据' },
  { name: 'Cookie 刷新', description: '自动刷新过期 Cookie' },
  { name: '批量关注', description: '批量执行关注操作' },
];

let tplCount = 0;
for (const tpl of templates) {
  const data = {
    name: tpl.name,
    description: tpl.description,
    pipeline: [{ type: 'navigate', url: '{target_url}' }, { type: 'antidetect' }, { type: 'dwell' }],
    task_time: rand(1800, 7200),
    created_at: now - rand(0, 30 * 24 * 3600 * 1000),
    updated_at: now,
  };
  insertTemplate.run(tpl.name, JSON.stringify(data), data.created_at);
  tplCount++;
}
console.log(`  ✓ 插入 ${tplCount} 条 templates`);

// ─── 汇总 ─────────────────────────────────────────────────────────────────

const counts = {
  tasks:     db.prepare('SELECT COUNT(*) as c FROM tasks').get().c,
  cookies:   db.prepare('SELECT COUNT(*) as c FROM cookies').get().c,
  captures:  db.prepare('SELECT COUNT(*) as c FROM captures').get().c,
  ranklist:  db.prepare('SELECT COUNT(*) as c FROM ranklist').get().c,
  templates: db.prepare('SELECT COUNT(*) as c FROM templates').get().c,
};

console.log('\n✅ 数据库当前记录数：');
console.table(counts);
console.log(`\n数据库位置：${DB_PATH}\n`);

db.close();
