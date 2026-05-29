const WebSocket = require('ws');
const logger = require('./logger');

const HEARTBEAT_MS = 30_000;
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;

class GatewayClient {
  constructor({ serverUrl, workerId, pool, onTask, onStop, onUpdateTime, onReloadActions }) {
    if (!serverUrl) throw new Error('GatewayClient: serverUrl is required');
    if (!workerId) throw new Error('GatewayClient: workerId is required');

    this.serverUrl = serverUrl;
    this.workerId = workerId;
    this.pool = pool;
    this.onTask = onTask;
    this.onStop = onStop ?? (() => {});
    this.onUpdateTime = onUpdateTime ?? (() => {});
    this.onReloadActions = onReloadActions ?? (() => {});

    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectAttempts = 0;
    this.destroyed = false;
  }

  connect() {
    if (this.destroyed) return;

    const url = `${this.serverUrl}?worker_id=${encodeURIComponent(this.workerId)}`;
    logger.info(`Connecting to gateway: ${url}`);

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      logger.error(`Failed to create WebSocket: ${err.message}`);
      this._scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.on('open', () => {
      logger.info('Gateway connected');
      this.reconnectAttempts = 0;
      this._register();
      this._startHeartbeat();
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        logger.warn(`Received non-JSON from gateway: ${String(data).slice(0, 200)}`);
        return;
      }
      this._dispatch(msg);
    });

    ws.on('close', (code, reason) => {
      logger.warn(`Gateway disconnected [${code}] ${reason ?? ''}`);
      this._stopHeartbeat();
      if (!this.destroyed) this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      // 'close' fires after 'error', reconnect happens there
      logger.error(`Gateway WS error: ${err.message}`);
    });
  }

  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn(`Cannot send (ws not open): ${data?.type}`);
      return;
    }
    try {
      this.ws.send(JSON.stringify(data));
    } catch (err) {
      logger.error(`Send failed: ${err.message}`);
    }
  }

  destroy() {
    this.destroyed = true;
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ─── private ─────────────────────────────────────────────────────────────

  _register() {
    this.send({
      type: 'register',
      worker_id: this.workerId,
      profiles: this.pool.profileNames,
      slots: this.pool.stats(),
    });
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    let running = false;
    const beat = async () => {
      if (running || this.destroyed) return;
      running = true;
      try {
        const profiles = await this.pool.getActivePageInfo().catch(() => ({}));
        this.send({
          type: 'heartbeat',
          worker_id: this.workerId,
          slots: this.pool.stats(),
          profiles,
        });
      } finally {
        running = false;
      }
    };
    this.heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _scheduleReconnect() {
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts++;
    logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }

  _dispatch(msg) {
    if (!msg || typeof msg !== 'object') {
      logger.warn('Received malformed message (not an object)');
      return;
    }
    if (!msg.type) {
      logger.warn('Received message without "type" field');
      return;
    }

    switch (msg.type) {
      case 'task':
        this.onTask(msg).catch(err =>
          logger.error(`onTask error: ${err.message}`)
        );
        break;

      case 'stop_task':
        logger.info(`Received stop_task: task=${msg.task_id} profile=${msg.profile}`);
        this.onStop(msg);
        break;

      case 'update_task_time':
        logger.info(`Received update_task_time: task=${msg.task_id} profile=${msg.profile} task_time=${msg.task_time}`);
        this.onUpdateTime(msg);
        break;

      case 'reload_actions':
        logger.info('Received reload_actions from gateway');
        this.onReloadActions(msg);
        break;

      case 'ping':
        this.send({ type: 'pong', worker_id: this.workerId });
        break;

      default:
        logger.warn(`Unknown message type: "${msg.type}"`);
    }
  }
}

module.exports = GatewayClient;
