const WebSocket = require('ws');
const { URL } = require('url');
const logger = require('./logger');

// 创建 WebSocket 服务器并挂载到已有的 HTTP 服务器上
function createWsServer(httpServer, { registry, taskStore, scheduler }) {
  const wss = new WebSocket.Server({ noServer: true });

  // 拦截 HTTP Upgrade 请求，仅处理指定路径的 WebSocket 升级
  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname !== '/ws/livetop') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
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
      handleMessage(workerId, ws, msg, { registry, taskStore, scheduler })
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

  if (busySlots.length > 0) {
    scheduler.dispatch();
  }
}

// 处理来自 Worker 的各类 WebSocket 消息
async function handleMessage(workerId, ws, msg, { registry, taskStore, scheduler }) {
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
      registry.register(workerId, ws, profiles);
      logger.info(`[${workerId}] 已注册 — Profile 列表: [${profiles.join(', ')}]`);

      // 向新连接的 Worker 推送最新自定义动作代码，保证代码同步
      const actionsCode = await taskStore.getActionsCode();
      if (actionsCode) {
        registry.sendTo(workerId, { type: 'reload_actions', code: actionsCode });
        logger.info(`[${workerId}] 已推送当前动作代码`);
      }

      scheduler.dispatch();
      break;
    }

    case 'heartbeat':
      // 更新心跳时间戳并记录各 Profile 的当前页面信息
      registry.updateHeartbeat(workerId, msg.profiles ?? {});
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

      setTimeout(() => scheduler.dispatch(), 1500);
      break;
    }

    case 'pong':
      // 心跳应答，无需处理
      break;

    default:
      logger.warn(`[${workerId}] 未知消息类型: "${msg.type}"`);
  }
}

module.exports = { createWsServer, cleanupWorker };
