const WebSocket = require('ws');
const { URL } = require('url');
const fs   = require('fs');
const path = require('path');
const logger = require('./logger');
const sseBus = require('./sse-bus');
const clientBus = require('./client-bus');

const PLUGINS_DIR = process.env.GATEWAY_PLUGINS_DIR
  ? path.resolve(process.env.GATEWAY_PLUGINS_DIR)
  : path.resolve(__dirname, '../plugins');

// plugin_ack 对账表：Map<name, { timer, pending: Set<workerId> }>
const pluginAckMap = new Map();

// 读取插件目录，返回 [{ name, code }]
function readPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  return fs.readdirSync(PLUGINS_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => ({
      name: f.replace(/\.js$/, ''),
      code: fs.readFileSync(path.join(PLUGINS_DIR, f), 'utf8'),
    }));
}

// 创建 WebSocket 服务器并挂载到已有的 HTTP 服务器上
function createWsServer(httpServer, { registry, taskStore, sqliteStore, scheduler }) {
  const wss = new WebSocket.Server({ noServer: true });

  // 前端 WebSocket 服务器（/ws/client）
  const clientWss = new WebSocket.Server({ noServer: true });

  // 拦截 HTTP Upgrade 请求，按路径分发到不同 WS 服务器
  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/ws/client') {
      clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
    } else if (pathname === '/ws/livetop') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  // 前端 WS 连接处理
  clientWss.on('connection', (ws) => {
    clientBus.add(ws);
    logger.info(`前端 WS 已连接，当前客户端数: ${clientBus.size}`);

    // 连接后立即推送全量快照
    handleClientMessage(ws, { type: 'subscribe' }, { registry, taskStore, sqliteStore });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      handleClientMessage(ws, msg, { registry, taskStore, sqliteStore });
    });
  });

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const workerId = params.get('worker_id')?.trim();

    if (!workerId) {
      logger.warn('WebSocket 已拒绝: 缺少 worker_id');
      ws.close(1008, 'worker_id 是必填项');
      return;
    }

    logger.info(`Worker 已连接: ${workerId}`);

    // handleMessage 是异步函数，必须捕获 rejection 以防未处理的 Promise 拒绝
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        logger.warn(`[${workerId}] 收到非 JSON 消息`);
        return;
      }
      handleMessage(workerId, ws, msg, { registry, taskStore, sqliteStore, scheduler })
        .catch(err => logger.error(`[${workerId}] 消息处理错误: ${err.message}`));
    });

    // 仅当 ws 与当前已注册连接一致时才清理，防止旧连接的 close 事件误删新注册记录
    ws.on('close', () => {
      cleanupWorker(workerId, ws, { registry, taskStore, scheduler })
        .catch(err => logger.error(`[${workerId}] 清理错误: ${err.message}`));
    });

    ws.on('error', (err) => {
      logger.error(`[${workerId}] WebSocket 错误: ${err.message}`);
    });
  });

  function broadcastPluginAndTrack(msg) {
    const { name } = msg;
    // 取消上一轮未结束的对账（文件快速连续变更时覆盖）
    if (pluginAckMap.has(name)) {
      clearTimeout(pluginAckMap.get(name).timer);
    }
    const pending = new Set(
      [...registry.workers.entries()]
        .filter(([, w]) => w.ws.readyState === 1)
        .map(([id]) => id)
    );
    registry.broadcast(msg);
    const timer = setTimeout(() => {
      if (pending.size > 0) {
        logger.warn(`plugin_ack 超时: ${name} — ${pending.size} 个 Worker 未确认: [${[...pending].join(', ')}]`);
      }
      pluginAckMap.delete(name);
    }, 30_000);
    pluginAckMap.set(name, { timer, pending });
  }

  // 监听 plugins/ 目录，文件新增或修改时广播给所有在线 Worker
  if (fs.existsSync(PLUGINS_DIR)) {
    let debounce = null;
    fs.watch(PLUGINS_DIR, (event, filename) => {
      if (!filename || !filename.endsWith('.js')) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const name     = filename.replace(/\.js$/, '');
        const filePath = path.join(PLUGINS_DIR, filename);
        if (!fs.existsSync(filePath)) {
          registry.broadcast({ type: 'unload_plugin', name });
          logger.info(`plugins 目录: ${filename} 已删除，广播卸载`);
        } else {
          const code = fs.readFileSync(filePath, 'utf8');
          broadcastPluginAndTrack({ type: 'load_plugin', name, code });
          logger.info(`plugins 目录: ${filename} 变更，广播热更新`);
        }
      }, 300);
    });
    logger.info(`监听插件目录: ${PLUGINS_DIR}`);
  } else {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    logger.info(`已创建插件目录: ${PLUGINS_DIR}`);
  }


  return wss;
}

// Worker 断开时的共享清理逻辑：同时处理 ws close 事件和心跳超时两种情况
// 防止旧 ws 引用干扰；恢复正在执行任务的运行计数
async function cleanupWorker(workerId, ws, { registry, taskStore, scheduler }) {
  const current = registry.workers.get(workerId);
  if (!current || current.ws !== ws) return; // 引用已过期，忽略

  // 减少此 Worker 上正在执行任务的计数，使其可被重新调度（不计为失败）
  const busySlots = registry.getBusySlots(workerId);
  for (const { taskId } of busySlots) {
    if (!taskId) continue;
    try {
      await taskStore.atomicDecrementRunning(String(taskId));
    } catch (err) {
      logger.error(`[${workerId}] 减少任务 ${taskId} 运行计数失败: ${err.message}`);
    }
  }

  registry.remove(workerId);
  logger.info(
    `[${workerId}] 已断开 — 释放 ${busySlots.length} 个进行中的槽位`
  );

  sseBus.notifyAll();

  if (busySlots.length > 0) {
    scheduler.dispatch();
  }
}

// 处理来自 Worker 的各类 WebSocket 消息
async function handleMessage(workerId, ws, msg, { registry, taskStore, sqliteStore, scheduler }) {
  if (!msg || typeof msg.type !== 'string') {
    logger.warn(`[${workerId}] 消息格式错误`);
    return;
  }

  switch (msg.type) {
    case 'register': {
      const profiles = Array.isArray(msg.profiles) ? msg.profiles.filter(Boolean) : [];
      if (profiles.length === 0) {
        logger.warn(`[${workerId}] 注册时未携带 Profile`);
        return;
      }
      registry.register(workerId, ws, profiles, msg.schemas ?? {});
      logger.info(`[${workerId}] 已注册 — Profile 列表: [${profiles.join(', ')}]`);

      // 推送 gateway plugins/ 目录下所有插件
      for (const { name, code } of readPlugins()) {
        registry.sendTo(workerId, { type: 'load_plugin', name, code });
        logger.info(`[${workerId}] 已推送插件: ${name}`);
      }

      sseBus.notifyWorkers();
      scheduler.dispatch();
      break;
    }

    case 'plugin_ack': {
      const entry = pluginAckMap.get(msg.name);
      if (entry) {
        entry.pending.delete(workerId);
        if (!msg.ok) {
          logger.warn(`[${workerId}] plugin_ack 失败: ${msg.name} — ${msg.reason ?? '未知'}`);
        }
      }
      break;
    }

    case 'schemas_update':
      registry.updateSchemas(workerId, msg.schemas ?? {});
      break;

    case 'ranklist_result': {
      const { profile, rank, nickname, is_logged_in } = msg;
      if (profile && typeof rank === 'number') {
        registry.updateRank(workerId, profile, rank, nickname ?? '', is_logged_in ?? false);
        sseBus.notifyWorkerPatch(workerId);
      }
      break;
    }

    case 'heartbeat':
      registry.updateHeartbeat(workerId, msg.profiles ?? {});
      sseBus.notifyWorkerPatch(workerId);
      break;

    case 'task_result': {
      const { task_id, profile, status } = msg;
      if (!task_id || !profile || !status) {
        logger.warn(`[${workerId}] 无效的 task_result: ${JSON.stringify(msg)}`);
        return;
      }

      // 仅当槽位仍对应同一 task_id 时才标记为空闲，防止已重新调度的槽位被误改
      const _slot = registry.workers.get(workerId)?.profiles.get(profile);
      if (_slot && (_slot.state !== 'busy' || _slot.taskId === task_id)) {
        registry.markIdle(workerId, profile);
      }

      // 原子化更新任务结果（Lua 脚本保证读改写一致性）
      const task = await taskStore.atomicTaskResult(String(task_id), status === 'success');
      if (!task) {
        logger.warn(`[${workerId}] 收到未知任务 ${task_id} 的 task_result`);
        return;
      }

      logger.info(
        `[${workerId}:${profile}] 任务 ${task_id} ${status} — ${task.completed + task.failed}/${task.count} 已完成`
      );

      if (task.status === 'done') {
        sqliteStore.archiveTask(task);
      }

      sseBus.notifyAll();
      scheduler.dispatch();
      break;
    }

    case 'task_rejected': {
      const { task_id, profile, reason } = msg;
      logger.warn(`[${workerId}:${profile}] 拒绝任务 ${task_id}: ${reason}`);

      // slot_busy 表示 Worker 仍在释放上一个任务，给 20s 冷却期避免频繁重试
      // 其他拒绝原因（unknown_profile 等）立即标记为空闲
      if (reason === 'slot_busy') {
        registry.markIdleWithCooldown(workerId, profile, 20_000);
      } else {
        registry.markIdle(workerId, profile);
      }

      // 原子化减少该任务的运行计数
      if (task_id) {
        await taskStore.atomicDecrementRunning(String(task_id));
      }

      sseBus.notifyAll();
      setTimeout(() => scheduler.dispatch(), 1500);
      break;
    }

    case 'task_progress':
      // Worker 通过 WS 上报执行进度，直接广播给所有前端客户端
      clientBus.broadcast(msg);
      break;

    case 'pong':
      // 心跳应答，无需处理
      break;

    default:
      logger.warn(`[${workerId}] 未知消息类型: "${msg.type}"`);
  }
}

// 处理前端 WS 消息
async function handleClientMessage(ws, msg, { registry, taskStore, sqliteStore }) {
  switch (msg.type) {
    case 'subscribe': {
      // 推送全量快照
      const [workers, tasks] = await Promise.all([
        Promise.resolve(registry.summary()),
        taskStore.getAll(100).catch(() => []),
      ]);
      ws.send(JSON.stringify({ type: 'workers_update', workers }));
      ws.send(JSON.stringify({ type: 'tasks_update', tasks }));
      break;
    }

    case 'ranklist_check': {
      // { targets: [{ worker_id, profile }] }
      const targets = Array.isArray(msg.targets) ? msg.targets : [];
      for (const { worker_id, profile } of targets) {
        if (worker_id && profile) {
          registry.sendTo(worker_id, { type: 'run_ranklist', profile });
          logger.info(`[WS] 触发榜单检查 → ${worker_id}:${profile}`);
        }
      }
      break;
    }

    case 'run_action': {
      // { worker_id, profile, action, params? }
      const { worker_id, profile, action, params } = msg;
      if (worker_id && profile && action) {
        registry.sendTo(worker_id, { type: 'run_action', profile, action, params: params ?? {} });
        logger.info(`[WS] 触发 action ${action} → ${worker_id}:${profile}`);
      }
      break;
    }

    case 'stop_node': {
      const { worker_id, profile } = msg;
      if (!worker_id || !profile) break;
      const w = registry.workers.get(worker_id);
      const slot = w?.profiles.get(profile);
      if (!slot || slot.state !== 'busy') break;
      registry.sendTo(worker_id, { type: 'stop_task', task_id: slot.taskId, profile });
      registry.markIdle(worker_id, profile);
      const _stoppedSlot = registry.workers.get(worker_id)?.profiles.get(profile);
      if (_stoppedSlot) _stoppedSlot.stoppedAt = Date.now();
      logger.info(`[WS] 停止节点 → ${worker_id}:${profile}`);
      sseBus.notifyAll();
      break;
    }

    case 'stop_worker': {
      const { worker_id } = msg;
      if (!worker_id) break;
      const busySlots = registry.getBusySlots(worker_id);
      const _now1 = Date.now();
      for (const { profileName, taskId } of busySlots) {
        registry.sendTo(worker_id, { type: 'stop_task', task_id: taskId, profile: profileName });
        registry.markIdle(worker_id, profileName);
        const _s = registry.workers.get(worker_id)?.profiles.get(profileName);
        if (_s) _s.stoppedAt = _now1;
      }
      logger.info(`[WS] 停止 Worker ${worker_id}: ${busySlots.length} 个节点`);
      sseBus.notifyAll();
      break;
    }

    case 'stop_url': {
      const { target_url } = msg;
      if (!target_url) break;
      const slots = registry.getSlotsByUrl(target_url);
      const _now2 = Date.now();
      for (const { workerId, profileName, taskId } of slots) {
        registry.sendTo(workerId, { type: 'stop_task', task_id: taskId, profile: profileName });
        registry.markIdle(workerId, profileName);
        const _s = registry.workers.get(workerId)?.profiles.get(profileName);
        if (_s) _s.stoppedAt = _now2;
      }
      logger.info(`[WS] 按 URL 停止 [${target_url}]: ${slots.length} 个节点`);
      sseBus.notifyAll();
      break;
    }

    default:
      break;
  }
}

module.exports = { createWsServer, cleanupWorker };
