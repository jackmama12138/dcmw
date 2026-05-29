const actionsLoader = require('./actions-loader');
const logger = require('./logger');

const CENTER_NOTIFY_URL = process.env.CENTER_NOTIFY_URL;

async function httpNotify(profile, status, targetUrl, taskId) {
  if (!CENTER_NOTIFY_URL) return;
  try {
    await fetch(CENTER_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_name: profile, status, target_url: targetUrl, task_id: taskId }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    logger.warn(`httpNotify failed: ${err.message}`);
  }
}

/**
 * Execute a task's pipeline inside the given BrowserContext.
 *
 * Returns a controller synchronously — caller can call:
 *   ctrl.stop()                  → interrupt execution (dwell exits early)
 *   ctrl.updateTaskTime(seconds) → adjust hang duration in real time
 *
 * onComplete is guaranteed to be called exactly once (success / error / timeout).
 * task_time is now the hang/dwell duration, not a max execution timeout.
 * A safety-net timeout fires at task_time + 300s to catch runaway processes.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {object} task  - { task_id, pipeline, task_time, target_url, profile }
 * @param {object} opts  - { onComplete: (result) => Promise<void> }
 * @returns {{ stop: () => void, updateTaskTime: (s: number) => void }}
 */
function runTask(context, task, { onComplete, pool }) {
  const ctrl = {
    stopped: false,
    task_time: Math.max(0, Number(task.task_time) || 0),
    task_id: task.task_id,
    profile: task.profile,
    stop() { this.stopped = true; },
    updateTaskTime(seconds) { this.task_time = Math.max(0, seconds); },
    // Called by the 'close' pipeline action so chrome-pool knows the close is intentional.
    markReleasing() {
      const slot = pool?.slots.get(task.profile);
      if (slot) slot.releasing = true;
    },
  };

  // If the browser context closes unexpectedly (Chrome crash / bot kill),
  // stop the ctrl immediately so dwell/wait exit on their next tick
  // instead of running for the full task_time duration.
  context.once('close', () => ctrl.stop());

  _execute(context, task, { onComplete, ctrl })
    .catch(err => logger.error(`[${task.profile}][task:${task.task_id}] runTask crash: ${err.message}`));

  return ctrl;
}

async function _execute(context, task, { onComplete, ctrl }) {
  const { task_id, pipeline, task_time, target_url, profile } = task;
  const tag = `[${profile}][task:${task_id}]`;

  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    await onComplete({ task_id, profile, status: 'error', target_url, error: 'pipeline is empty' });
    return;
  }

  let settled = false;

  async function settle(result) {
    if (settled) return;
    settled = true;
    ctrl.stopped = true; // signal all pollers (rtcookie stopPoller, dwell tick) to self-clean
    await httpNotify(result.profile, result.status, result.target_url, result.task_id);
    await onComplete(result);
  }

  // Safety-net: fires only if dwell/stop logic fails to exit on its own.
  const safetyMs = (Math.max(0, task_time) + 300) * 1000;
  const safetyHandle = setTimeout(async () => {
    logger.warn(`${tag} safety timeout after ${safetyMs}ms`);
    await settle({ task_id, profile, status: 'timeout', target_url });
  }, safetyMs);

  try {
    for (let i = 0; i < pipeline.length; i++) {
      if (settled || ctrl.stopped) break;
      const step = pipeline[i];
      logger.info(`${tag} step ${i + 1}/${pipeline.length}: ${step?.type}`);
      await actionsLoader.runStep(context, step, ctrl);
    }

    clearTimeout(safetyHandle);
    await settle({ task_id, profile, status: 'success', target_url });
    logger.info(`${tag} completed`);
  } catch (err) {
    clearTimeout(safetyHandle);
    logger.error(`${tag} failed: ${err.message}`);
    await settle({ task_id, profile, status: 'error', target_url, error: err.message });
  }
}

module.exports = { runTask };
