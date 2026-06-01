// 前端 WebSocket 连接管理：维护所有前端 WS 客户端，提供广播和单播能力
const WebSocket = require('ws');

class ClientBus {
  constructor() {
    this._clients = new Set();
  }

  add(ws) {
    this._clients.add(ws);
    ws.on('close', () => this._clients.delete(ws));
    ws.on('error', () => this._clients.delete(ws));
  }

  // 向所有前端广播消息
  broadcast(payload) {
    if (this._clients.size === 0) return;
    const data = JSON.stringify(payload);
    for (const ws of this._clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        this._clients.delete(ws);
        continue;
      }
      try { ws.send(data); } catch { this._clients.delete(ws); }
    }
  }

  get size() { return this._clients.size; }
}

module.exports = new ClientBus();
