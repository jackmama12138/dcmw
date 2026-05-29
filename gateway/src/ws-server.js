const WebSocket = require('ws');
const { URL } = require('url');
const logger = require('./logger');

function createWsServer(httpServer, { registry, taskStore, scheduler }) {
  const wss = new WebSocket.Server({ noServer: true });

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
      logger.warn('WS rejected: missing worker_id');
      ws.close(1008, 'worker_id required');
      return;
    }

    logger.info(`Worker connected: ${workerId}`);

    // Fix ④: handleMessage is async — must catch or unhandled rejections will surface
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        logger.warn(`[${workerId}] non-JSON message`);
        return;
      }
      handleMessage(workerId, ws, msg, { registry, taskStore, scheduler })
        .catch(err => logger.error(`[${workerId}] handler error: ${err.message}`));
    });

    // Fix ②: only remove this worker if ws matches the currently registered connection.
    // Without this check, a stale 'close' event from the OLD connection fires after
    // the worker reconnects and re-registers, deleting the newly registered entry.
    ws.on('close', () => {
      cleanupWorker(workerId, ws, { registry, taskStore, scheduler })
        .catch(err => logger.error(`[${workerId}] cleanup error: ${err.message}`));
    });

    ws.on('error', (err) => {
      logger.error(`[${workerId}] WS error: ${err.message}`);
    });
  });

  return wss;
}

// Fix ②⑧: shared cleanup — called on both ws 'close' and heartbeat timeout.
// Guards against stale ws references and recovers in-flight task running counts.
async function cleanupWorker(workerId, ws, { registry, taskStore, scheduler }) {
  const current = registry.workers.get(workerId);
  if (!current || current.ws !== ws) return; // stale reference — ignore

  // Fix ⑧: decrement running counts for tasks that were in-flight on this worker.
  // We do NOT increment 'failed' — we want them re-dispatched, not counted as failures.
  const busySlots = registry.getBusySlots(workerId);
  for (const { taskId } of busySlots) {
    if (!taskId) continue;
    try {
      await taskStore.atomicDecrementRunning(String(taskId));
    } catch (err) {
      logger.error(`[${workerId}] failed to decrement task ${taskId}: ${err.message}`);
    }
  }

  registry.remove(workerId);
  logger.info(
    `[${workerId}] disconnected — freed ${busySlots.length} in-flight slot(s)`
  );

  if (busySlots.length > 0) {
    scheduler.dispatch();
  }
}

async function handleMessage(workerId, ws, msg, { registry, taskStore, scheduler }) {
  if (!msg || typeof msg.type !== 'string') {
    logger.warn(`[${workerId}] malformed message`);
    return;
  }

  switch (msg.type) {
    case 'register': {
      const profiles = Array.isArray(msg.profiles) ? msg.profiles.filter(Boolean) : [];
      if (profiles.length === 0) {
        logger.warn(`[${workerId}] register with no profiles`);
        return;
      }
      registry.register(workerId, ws, profiles);
      logger.info(`[${workerId}] registered — profiles: [${profiles.join(', ')}]`);

      // Push the latest custom actions code so newly connected workers are in sync.
      const actionsCode = await taskStore.getActionsCode();
      if (actionsCode) {
        registry.sendTo(workerId, { type: 'reload_actions', code: actionsCode });
        logger.info(`[${workerId}] pushed current actions code`);
      }

      scheduler.dispatch();
      break;
    }

    case 'heartbeat':
      registry.updateHeartbeat(workerId);
      break;

    case 'task_result': {
      const { task_id, profile, status } = msg;
      if (!task_id || !profile || !status) {
        logger.warn(`[${workerId}] invalid task_result: ${JSON.stringify(msg)}`);
        return;
      }

      registry.markIdle(workerId, profile);

      // Fix ⑤: atomic read-modify-write via Lua script
      const task = await taskStore.atomicTaskResult(String(task_id), status === 'success');
      if (!task) {
        logger.warn(`[${workerId}] task_result for unknown task ${task_id}`);
        return;
      }

      logger.info(
        `[${workerId}:${profile}] task ${task_id} ${status} — ${task.completed + task.failed}/${task.count} done`
      );

      scheduler.dispatch();
      break;
    }

    case 'task_rejected': {
      const { task_id, profile, reason } = msg;
      logger.warn(`[${workerId}:${profile}] rejected task ${task_id}: ${reason}`);
      registry.markIdle(workerId, profile);

      // Fix ⑤: atomic decrement
      if (task_id) {
        await taskStore.atomicDecrementRunning(String(task_id));
      }

      // Delay re-dispatch after rejection so the worker has time to recover
      // from error state before the next task arrives (prevents tight reject loops).
      setTimeout(() => scheduler.dispatch(), 1500);
      break;
    }

    case 'pong':
      break;

    default:
      logger.warn(`[${workerId}] unknown type: "${msg.type}"`);
  }
}

module.exports = { createWsServer, cleanupWorker };
