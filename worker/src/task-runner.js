const actionsLoader = require('./actions-loader');
const logger = require('./logger');

const CENTER_NOTIFY_URL = process.env.CENTER_NOTIFY_URL;

// 向中心服务器发送任务完成通知
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
    logger.warn(`httpNotify 失败: ${err.message}`);
  }
}

/**
 * 在指定 BrowserContext 中执行任务的 pipeline。
 *
 * 同步返回控制器，调用方可以：
 *   ctrl.stop()                  → 中断执行（dwell 提前退出）
 *   ctrl.updateTaskTime(seconds) → 实时调整停留时长
 *
 * onComplete 保证只调用一次（成功 / 错误 / 超时）。
 * task_time 是停留/dwell 时长，不是最大执行超时。
 * 安全网定时器在 task_time + 300s 后触发，用于兜底捕获失控进程。
 */
function runTask(context, task, { onComplete, onProgress, pool }) {
  // 构建任务控制器对象
  const ctrl = {
    stopped   : false,
    task_time : Math.max(0, Number(task.task_time) || 0),
    task_id   : task.task_id,
    profile   : task.profile,
    target_url: task.target_url ?? '',  // 心跳上报用，gateway 重启后恢复映射
    _cleanups : [],

    stop() { this.stopped = true; },
    updateTaskTime(seconds) { this.task_time = Math.max(0, seconds); },

    // 注册任务级清理函数（page.route / page.on 等），任务结束时统一执行
    addCleanup(fn) { this._cleanups.push(fn); },

    // 由 close pipeline 动作调用，告知 chrome-pool 此次关闭是主动行为
    markReleasing() {
      const slot = pool?.slots.get(task.profile);
      if (slot) slot.releasing = true;
    },
  };

  // 任务结束后清理 context 级别的监听器，防止懒关闭复用时监听器叠加
  const cleanup = () => {
    context.off('close', onContextClose);
    context.off('page', onNewPage);
  };

  const onContextClose = () => ctrl.stop();
  context.on('close', onContextClose);

  // 用户手动关闭 tab 时，context 仍存活（Chrome 会新开空白 tab），
  // 需要单独监听 page close 来停止任务
  const onPageClose = () => {
    if (!ctrl.stopped) {
      logger.info(`[${task.profile}][task:${task.task_id}] 页面被关闭，停止任务`);
      ctrl.stop();
    }
  };
  const onNewPage = page => page.once('close', onPageClose);
  for (const page of context.pages()) page.once('close', onPageClose);
  context.on('page', onNewPage);

  _execute(context, task, { onComplete, onProgress, ctrl, cleanup })
    .catch(err => logger.error(`[${task.profile}][task:${task.task_id}] runTask 崩溃: ${err.message}`));

  return ctrl;
}

// 异步执行 pipeline 步骤，包含安全网超时和 settle 去重保护
async function _execute(context, task, { onComplete, onProgress, ctrl, cleanup }) {
  const { task_id, pipeline, task_time, target_url, profile } = task;
  const tag = `[${profile}][task:${task_id}]`;

  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    await onComplete({ task_id, profile, status: 'error', target_url, error: 'pipeline 为空' });
    return;
  }

  let settled = false;

  // 保证 onComplete 只被调用一次
  async function settle(result) {
    if (settled) return;
    settled = true;
    ctrl.stopped = true;
    // 先执行动作注册的清理钩子（page.route / page.on 等），再清理 context 监听器
    for (const fn of ctrl._cleanups) {
      try { await fn(); } catch {}
    }
    cleanup?.();
    await httpNotify(result.profile, result.status, result.target_url, result.task_id);
    await onComplete(result);
  }

  // 安全网：仅在 dwell/stop 逻辑失败时兜底触发
  const safetyMs = (Math.max(0, task_time) + 300) * 1000;
  const safetyHandle = setTimeout(async () => {
    logger.warn(`${tag} 安全网超时，已过 ${safetyMs}ms`);
    await settle({ task_id, profile, status: 'timeout', target_url });
  }, safetyMs);

  const startMs = Date.now();

  try {
    for (let i = 0; i < pipeline.length; i++) {
      if (settled || ctrl.stopped) break;
      const step = pipeline[i];
      ctrl.currentAction = step?.type ?? '';
      logger.info(`${tag} 执行步骤 ${i + 1}/${pipeline.length}: ${step?.type}`);

      onProgress?.({
        type      : 'task_progress',
        worker_id : process.env.WORKER_ID ?? '',
        profile,
        task_id,
        step      : i + 1,
        total     : pipeline.length,
        action    : step?.type ?? '',
        elapsed_ms: Date.now() - startMs,
      });

      const result = await actionsLoader.runStep(context, step, ctrl);

      // on_fail 处理：仅当动作返回 { ok: false } 时生效
      // 'continue'（默认）→ 跳过本步骤继续执行
      // 'stop'           → 以 success 结束任务（预期中止）
      // 'error'          → 以 error 结束任务（意外失败）
      if (result && result.ok === false) {
        const onFail = step.on_fail ?? 'continue';
        logger.warn(`${tag} 步骤 ${i + 1}(${step.type}) 失败: ${result.reason ?? 'unknown'} — on_fail=${onFail}`);
        if (onFail === 'stop') {
          clearTimeout(safetyHandle);
          await settle({ task_id, profile, status: 'success', target_url });
          return;
        }
        if (onFail === 'error') {
          clearTimeout(safetyHandle);
          await settle({ task_id, profile, status: 'error', target_url,
            error: `step[${i + 1}:${step.type}] ${result.reason ?? 'failed'}` });
          return;
        }
        // 'continue': 继续下一步，不中断
      }
    }

    clearTimeout(safetyHandle);
    await settle({ task_id, profile, status: 'success', target_url });
    logger.info(`${tag} 已完成`);
  } catch (err) {
    clearTimeout(safetyHandle);
    logger.error(`${tag} 执行失败: ${err.message}`);
    await settle({ task_id, profile, status: 'error', target_url, error: err.message });
  }
}

module.exports = { runTask };
