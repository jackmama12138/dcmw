// SSE 事件总线：管理所有 Client 长连接，并将状态变更推送给前端
// 两类推送各自独立 debounce，避免高频事件重复刷新 DOM

class SseBus {
  constructor() {
    // 持有所有活跃的 SSE Response 对象
    this._clients = new Set();
    this._tasksTimer  = null;
    this._workersTimer = null;
  }

  // 注册新的 SSE 客户端连接，连接关闭时自动移除
  addClient(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    this._clients.add(res);

    req.on('close', () => {
      this._clients.delete(res);
    });
  }

  // 通知 tasks 数据已变更，debounce 500ms 后批量推送
  notifyTasks() {
    if (this._tasksTimer) return;
    this._tasksTimer = setTimeout(() => {
      this._tasksTimer = null;
      this._push('tasks');
    }, 500);
  }

  // 通知 workers 数据已变更，debounce 1000ms 后批量推送（心跳来源，频率较高）
  notifyWorkers() {
    if (this._workersTimer) return;
    this._workersTimer = setTimeout(() => {
      this._workersTimer = null;
      this._push('workers');
    }, 1000);
  }

  // 同时通知 tasks 和 workers 更新
  notifyAll() {
    this.notifyTasks();
    this.notifyWorkers();
  }

  // 向所有活跃客户端推送 SSE 事件，写入失败时安全移除
  _push(type) {
    if (this._clients.size === 0) return;
    const data = `data: ${JSON.stringify({ type })}\n\n`;
    for (const res of this._clients) {
      if (res.writableEnded) {
        this._clients.delete(res);
        continue;
      }
      try {
        res.write(data);
      } catch {
        this._clients.delete(res);
      }
    }
  }
}

module.exports = new SseBus();
