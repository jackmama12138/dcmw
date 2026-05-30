// 根据 STORAGE_BACKEND 环境变量选择存储实现
// .env 里设置：STORAGE_BACKEND=sqlite 或 STORAGE_BACKEND=redis（默认）

const backend = (process.env.STORAGE_BACKEND || 'redis').toLowerCase();

if (backend === 'sqlite') {
  module.exports = require('./task-store-sqlite');
} else {
  module.exports = require('./task-store-redis');
}
