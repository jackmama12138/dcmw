const WebSocket    = require('ws');
const logger       = require('./logger');
const actionsLoader = require('./actions-loader');

const HEARTBEAT_MS = 30_000;
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;

class GatewayClient {
  constructor({ serverUrl, workerId, pool, onTask, onStop, onUpdateTime, onRanklist, onScreenshot, getStatus }) {
    if (!serverUrl) throw new Error('GatewayClient: serverUrl 是必填项');
    if (!workerId) throw new Error('GatewayClient: workerId 是必填项');

    this.serverUrl = serverUrl;
    this.workerId = workerId;
    this.pool = pool;
    this.onTask = onTask;
    this.onStop = onStop ?? (() => {});
    this.onUpdateTime = onUpdateTime ?? (() => {});
    this.onLoadPlugin   = (msg) => { actionsLoader.loadPlugin(msg.name, msg.code);   this._register(); };
    this.onUnloadPlugin = (msg) => { actionsLoader.unloadPlugin(msg.name);           this._register(); };
    this.onRanklist      = onRanklist      ?? (() => {});
    this.onScreenshot    = onScreenshot    ?? (() => {});
    this.getStatus       = getStatus       ?? (() => ({})); // 返回当前所有运行中任务的状态

    this.ws = null;
    this.heartbeatTimer = null;
    // 修复：持有重连定时器句柄，destroy() 时可取消待执行的重连
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.destroyed = false;
  }

  // 建立到 gateway 的 WebSocket 连接
  connect() {
    if (this.destroyed) return;

    const url = `${this.serverUrl}?worker_id=${encodeURIComponent(this.workerId)}`;
    logger.info(`正在连接 gateway: ${url}`);

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      logger.error(`创建 WebSocket 失败: ${err.message}`);
      this._scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.on('open', () => {
      logger.info('已连接到 gateway');
      this.reconnectAttempts = 0;
      this._register();
      this._startHeartbeat();
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        logger.warn(`收到来自 gateway 的非 JSON 消息: ${String(data).slice(0, 200)}`);
        return;
      }
      this._dispatch(msg);
    });

    ws.on('close', (code, reason) => {
      logger.warn(`与 gateway 断开连接 [${code}] ${reason ?? ''}`);
      this._stopHeartbeat();
      if (!this.destroyed) this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      // 'close' 事件会在 'error' 后触发，重连逻辑在 close 处理
      logger.error(`gateway WebSocket 错误: ${err.message}`);
    });
  }

  // 向 gateway 发送 JSON 消息
  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn(`无法发送（WebSocket 未就绪）: ${data?.type}`);
      return;
    }
    try {
      this.ws.send(JSON.stringify(data));
    } catch (err) {
      logger.error(`发送失败: ${err.message}`);
    }
  }

  // 销毁客户端，取消所有定时器并关闭连接
  destroy() {
    this.destroyed = true;
    this._stopHeartbeat();
    // 取消待执行的重连，防止 destroy 后仍触发 connect()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ─── 私有方法 ─────────────────────────────────────────────────────────────

  // 向 gateway 发送注册消息
  _register() {
    this.send({
      type    : 'register',
      worker_id: this.workerId,
      profiles: this.pool.profileNames,
      slots   : this.pool.stats(),
      schemas : actionsLoader.getSchemas(),
    });
  }

  // 启动心跳定时器，定期上报槽位状态、当前页面信息及运行中任务映射
  _startHeartbeat() {
    this._stopHeartbeat();
    let running = false;
    const beat = async () => {
      if (running || this.destroyed) return;
      running = true;
      try {
        const pageProfiles  = await this.pool.getActivePageInfo().catch(() => ({}));
        const statusProfiles = this.getStatus(); // { Profile1: { task_id, target_url, state } }

        // 合并页面信息与任务状态，gateway 重启后可凭此恢复映射
        const profiles = {};
        const allKeys = new Set([...Object.keys(pageProfiles), ...Object.keys(statusProfiles)]);
        for (const k of allKeys) {
          profiles[k] = { ...(pageProfiles[k] ?? {}), ...(statusProfiles[k] ?? {}) };
        }

        this.send({
          type     : 'heartbeat',
          worker_id: this.workerId,
          slots    : this.pool.stats(),
          profiles,
        });
      } finally {
        running = false;
      }
    };
    this.heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
  }

  // 停止心跳定时器
  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // 使用指数退避调度重连，并保存定时器句柄以便取消
  _scheduleReconnect() {
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts++;
    logger.info(`将在 ${delay}ms 后重连（第 ${this.reconnectAttempts} 次尝试）`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // 根据消息类型分发到对应处理逻辑
  _dispatch(msg) {
    if (!msg || typeof msg !== 'object') {
      logger.warn('收到格式错误的消息（非对象）');
      return;
    }
    if (!msg.type) {
      logger.warn('收到缺少 "type" 字段的消息');
      return;
    }

    switch (msg.type) {
      case 'task':
        this.onTask(msg).catch(err =>
          logger.error(`onTask 错误: ${err.message}`)
        );
        break;

      case 'stop_task':
        logger.info(`收到 stop_task: task=${msg.task_id} profile=${msg.profile}`);
        this.onStop(msg);
        break;

      case 'update_task_time':
        logger.info(`收到 update_task_time: task=${msg.task_id} profile=${msg.profile} task_time=${msg.task_time}`);
        this.onUpdateTime(msg);
        break;

      case 'load_plugin':
        logger.info(`收到来自 gateway 的 load_plugin: ${msg.name}`);
        this.onLoadPlugin(msg);
        break;

      case 'unload_plugin':
        logger.info(`收到来自 gateway 的 unload_plugin: ${msg.name}`);
        this.onUnloadPlugin(msg);
        break;

      case 'run_ranklist':
        this.onRanklist(msg).catch(() => {});
        break;

      case 'run_screenshot':
        this.onScreenshot(msg).catch(() => {});
        break;

      case 'ping':
        this.send({ type: 'pong', worker_id: this.workerId });
        break;

      default:
        logger.warn(`未知消息类型: "${msg.type}"`);
    }
  }
}

module.exports = GatewayClient;
