const logger = require('./logger');

const MAX_QUEUE_SIZE = 10_000; // 超过此上限丢弃最旧的，防止内存无限增长

class CaptureQueue {
  constructor() {
    this._queue    = [];
    this._draining = false;
    this._store    = null;
  }

  // 在 taskStore 初始化完成后调用，延迟注入避免循环依赖
  init(taskStore) {
    this._store = taskStore;
  }

  push(task_id, body) {
    if (this._queue.length >= MAX_QUEUE_SIZE) {
      this._queue.shift(); // 丢最旧的，保护内存
      logger.warn('capture-queue: 队列已满，丢弃最早一条');
    }
    this._queue.push({ task_id, body });
    this._drain();
  }

  size() {
    return this._queue.length;
  }

  async _drain() {
    if (this._draining || !this._store) return;
    this._draining = true;
    while (this._queue.length > 0) {
      const { task_id, body } = this._queue.shift();
      try {
        await this._store.addCapture(task_id, body);
      } catch (err) {
        logger.warn(`capture-queue: 写入失败 task=${task_id} — ${err.message}`);
      }
    }
    this._draining = false;
  }
}

module.exports = new CaptureQueue();
