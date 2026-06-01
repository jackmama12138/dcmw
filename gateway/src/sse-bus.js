// 事件总线：同时管理 SSE（兼容旧客户端）和前端 WebSocket 推送
// 两类推送各自独立 debounce，避免高频事件重复刷新 DOM

const clientBus = require('./client-bus');

class SseBus {
  constructor() {
    this._clients = new Set();
    this._tasksTimer   = null;
    this._workersTimer = null;
    // registry / taskStore 在 init() 后注入，用于 WS 推送全量数据
    this._registry  = null;
    this._taskStore = null;
  }

  // gateway 启动后注入依赖，使 WS 推送可以携带全量数据
  init(registry, taskStore) {
    this._registry  = registry;
    this._taskStore = taskStore;
  }

  // 注册新的 SSE 客户端连接，连接关闭时自动移除
  addClient(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    this._clients.add(res);
    req.on('close', () => this._clients.delete(res));
  }

  // 通知 tasks 数据已变更，debounce 500ms 后批量推送
  notifyTasks() {
    if (this._tasksTimer) return;
    this._tasksTimer = setTimeout(() => {
      this._tasksTimer = null;
      this._pushSse('tasks');
      this._pushWsTasks();
    }, 500);
  }

  // 通知 workers 数据已变更，debounce 1000ms 后批量推送（心跳来源，频率较高）
  notifyWorkers() {
    if (this._workersTimer) return;
    this._workersTimer = setTimeout(() => {
      this._workersTimer = null;
      this._pushSse('workers');
      this._pushWsWorkers();
    }, 1000);
  }

  // 同时通知 tasks 和 workers 更新
  notifyAll() {
    this.notifyTasks();
    this.notifyWorkers();
  }

  // SSE：向所有活跃客户端推送事件类型通知
  _pushSse(type) {
    if (this._clients.size === 0) return;
    const data = `data: ${JSON.stringify({ type })}\n\n`;
    for (const res of this._clients) {
      if (res.writableEnded) { this._clients.delete(res); continue; }
      try { res.write(data); } catch { this._clients.delete(res); }
    }
  }

  // WS：推送单个 worker 增量（心跳触发，避免全量序列化）
  notifyWorkerPatch(workerId) {
    if (!this._registry || clientBus.size === 0) return;
    const worker = this._registry.workerSummary(workerId);
    if (worker) clientBus.broadcast({ type: 'worker_patch', worker });
  }

  // WS：推送全量 workers 数据（连接初始化 / worker 上下线时用）
  _pushWsWorkers() {
    if (!this._registry || clientBus.size === 0) return;
    clientBus.broadcast({ type: 'workers_update', workers: this._registry.summary() });
  }

  // WS：推送全量 tasks 数据
  _pushWsTasks() {
    if (!this._taskStore || clientBus.size === 0) return;
    this._taskStore.getAll(100).then(tasks => {
      clientBus.broadcast({ type: 'tasks_update', tasks });
    }).catch(() => {});
  }
}

module.exports = new SseBus();
