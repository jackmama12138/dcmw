require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const os = require('os');
const path = require('path');
const ChromePool = require('./chrome-pool');
const GatewayClient = require('./ws-client');
const { runTask } = require('./task-runner');
const actionsLoader = require('./actions-loader');
const logger = require('./logger');

// ─── 环境变量校验 ─────────────────────────────────────────────────────────────

// 自动获取本机局域网 IPv4（私有网段 192.168/10/172.16-31），用作 WORKER_ID
// 多台 Worker 可共用同一份配置，无需逐台写死 WORKER_ID；断开的网卡无 IPv4 不会被选中
function getLanIp() {
  const PRIVATE = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;
  const candidates = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal && PRIVATE.test(info.address)) {
        candidates.push({ name, address: info.address });
      }
    }
  }
  // 可选 LAN_PREFIX 强制指定网段（同时存在多个连接的私有网卡时用）
  const prefix = process.env.LAN_PREFIX;
  const pool = prefix ? candidates.filter(c => c.address.startsWith(prefix)) : candidates;
  if (pool.length === 0) return null;
  if (pool.length > 1) {
    logger.warn(`检测到多个局域网 IP，取第一个；如不对请设 LAN_PREFIX：${pool.map(c => `${c.address}(${c.name})`).join(', ')}`);
  }
  return pool[0].address;
}

const {
  MAC_CHROME_PATH,
  CHROME_PROFILES_BASE_DIR,
  CHROME_PROFILE_NAME,
  SERVER_HOST,
} = process.env;

// WORKER_ID：优先用环境变量，未设则自动取本机局域网 IP（取不到则下方校验 fail-fast 退出）
const WORKER_ID = process.env.WORKER_ID || getLanIp();
if (!process.env.WORKER_ID) {
  if (WORKER_ID) logger.info(`WORKER_ID 自动取本机局域网 IP：${WORKER_ID}`);
  else logger.error('WORKER_ID 未设置且无法自动获取局域网 IP（未找到 192.168/10/172 私有网段 IPv4）');
}

const REQUIRED = {
  MAC_CHROME_PATH,
  CHROME_PROFILES_BASE_DIR,
  CHROME_PROFILE_NAME,
  WORKER_ID,
  SERVER_HOST,
};

const missing = Object.entries(REQUIRED)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  logger.error(`缺少必要的环境变量: ${missing.join(', ')}`);
  process.exit(1);
}

const profileNames = CHROME_PROFILE_NAME.split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (profileNames.length === 0) {
  logger.error('CHROME_PROFILE_NAME 中没有有效的 Profile 名称');
  process.exit(1);
}

// ─── 启动前检查 ───────────────────────────────────────────────────────────────

if (!fs.existsSync(MAC_CHROME_PATH)) {
  logger.error(`Chrome 可执行文件不存在: ${MAC_CHROME_PATH}`);
  process.exit(1);
}

const missingProfiles = profileNames.filter(
  name => !fs.existsSync(path.join(CHROME_PROFILES_BASE_DIR, name))
);
if (missingProfiles.length > 0) {
  logger.error(`Chrome Profile 目录不存在: ${missingProfiles.join(', ')} (基础目录: ${CHROME_PROFILES_BASE_DIR})`);
  process.exit(1);
}

logger.info('启动前检查通过');

// ─── 初始化 ───────────────────────────────────────────────────────────────────

const pool = new ChromePool({
  chromePath: MAC_CHROME_PATH,
  profilesBaseDir: CHROME_PROFILES_BASE_DIR,
  profileNames,
  onUnexpectedClose(profile) {
    // Chrome 被意外关闭：只中断 ctrl，task_result 由 pipeline 错误路径统一上报
    // 不在此处发送 task_result，避免与 onComplete 双重上报
    for (const [, ctrl] of runningTasks.entries()) {
      if (ctrl.profile === profile) {
        logger.warn(`[${profile}] Chrome 意外关闭，中断任务 ${ctrl.task_id}`);
        ctrl.stop();
        break;
      }
    }
  },
});

// Map<"taskId:profile", TaskController> — 追踪所有正在执行的任务控制器
const runningTasks = new Map();

// 生成任务的唯一键
function taskKey(taskId, profile) {
  return `${taskId}:${profile}`;
}

const client = new GatewayClient({
  serverUrl: SERVER_HOST,
  workerId: WORKER_ID,
  pool,
  onTask: handleTask,

  // 收到停止任务指令时，通知对应控制器停止
  onStop({ task_id, profile }) {
    const ctrl = runningTasks.get(taskKey(task_id, profile));
    if (ctrl) {
      ctrl.stop();
      logger.info(`[${profile}] 任务 ${task_id} 收到停止信号`);
    } else {
      logger.warn(`[${profile}] 收到未知任务 ${task_id} 的停止指令`);
    }
  },

  // 收到更新任务时长指令时，动态更新对应控制器的 task_time
  onUpdateTime({ task_id, profile, task_time }) {
    const ctrl = runningTasks.get(taskKey(task_id, profile));
    if (ctrl) {
      ctrl.updateTaskTime(task_time);
      logger.info(`[${profile}] 任务 ${task_id} task_time 已更新 → ${task_time}s`);
    } else {
      logger.warn(`[${profile}] 收到未知任务 ${task_id} 的 update_task_time 指令`);
    }
  },

  // 执行榜单检查（走 plugin ranklist-check action）
  async onRanklist({ profile, task_id }) {
    const slot = pool.slots.get(profile);
    if (!slot?.context) {
      logger.warn(`[${profile}] run_ranklist: 无活跃 context`);
      return;
    }
    const ctrl = runningTasks.get(taskKey(task_id, profile)) ?? { profile, task_id };
    const result = await actionsLoader.runStep(slot.context, { type: 'ranklist-check' }, ctrl);
    client.send({
      type        : 'ranklist_result',
      worker_id   : process.env.WORKER_ID ?? '',
      profile,
      ok          : result?.ok ?? false,
      reason      : result?.reason ?? '',
      rank        : result?.rank ?? 0,
      nickname    : result?.nickname ?? '',
      is_logged_in: result?.is_logged_in ?? false,
    });
  },

  // 执行截图
  async onScreenshot({ profile, task_id }) {
    const slot = pool.slots.get(profile);
    if (!slot?.context) {
      logger.warn(`[${profile}] run_screenshot: 无活跃 context`);
      return;
    }
    const ctrl = runningTasks.get(taskKey(task_id, profile)) ?? { profile, task_id };
    await actionsLoader.runStep(slot.context, { type: 'screenshot' }, ctrl);
  },

  async onAction({ profile, action, params }) {
    const slot = pool.slots.get(profile);
    if (!slot?.context) {
      logger.warn(`[${profile}] run_action(${action}): 无活跃 context`);
      return;
    }
    const ctrl = { profile, task_id: '' };
    await actionsLoader.runStep(slot.context, { type: action, ...params }, ctrl);
    logger.info(`[${profile}] run_action(${action}) 完成`);
  },

  // 提供当前所有运行中任务的状态，gateway 重启后心跳携带此信息恢复映射
  getStatus() {
    const result = {};
    for (const [key, ctrl] of runningTasks.entries()) {
      if (ctrl.stopped) continue; // 已收到停止信号，不再上报 busy，防止 gateway 心跳恢复
      const colonIdx = key.indexOf(':');
      const profile  = key.slice(colonIdx + 1);
      result[profile] = {
        state         : 'busy',
        task_id       : ctrl.task_id,
        target_url    : ctrl.target_url ?? '',
        current_action: ctrl.currentAction ?? '',
      };
    }
    return result;
  },
});

// ─── 任务处理 ─────────────────────────────────────────────────────────────────

// 接收来自 gateway 的任务并启动执行流程
async function handleTask(task) {
  const { task_id, profile } = task;

  if (!task_id || !profile) {
    logger.warn(`收到缺少 task_id 或 profile 的任务: ${JSON.stringify(task)}`);
    return;
  }

  const slot = pool.slots.get(profile);
  if (!slot) {
    logger.warn(`[${profile}] 未知 Profile — 拒绝任务 ${task_id}`);
    client.send({ type: 'task_rejected', task_id, profile, reason: 'unknown_profile' });
    return;
  }

  if (slot.state !== 'idle') {
    logger.warn(`[${profile}] 非空闲状态 (${slot.state}) — 拒绝任务 ${task_id}`);
    client.send({ type: 'task_rejected', task_id, profile, reason: 'slot_busy' });
    // 重置错误状态，以便 gateway 下次可以重新分配到该 Profile
    if (slot.state === 'error') await pool.release(profile);
    return;
  }

  let context;
  try {
    context = await pool.acquire(profile);
  } catch (err) {
    logger.error(`[${profile}] 启动 Chrome 失败: ${err.message}`);
    client.send({ type: 'task_result', task_id, profile, status: 'error', error: err.message });
    await pool.release(profile, { forceClose: true });
    return;
  }

  const key = taskKey(task_id, profile);
  const ctrl = runTask(context, task, {
    pool,
    onProgress: (data) => {
      client.send(data);
      if (data.action === 'dwell') client.beat();
    },
    onComplete: async (result) => {
      runningTasks.delete(key);
      // 先 release 再上报：确保 slot 真正空闲后 gateway 才会重新调度
      // 否则 gateway 收到 task_result 立刻派新任务，worker 还在 goto about:blank，
      // 导致新任务被 slot_busy 拒绝并触发 20 秒冷却
      try { await pool.release(profile); } catch (err) {
        logger.error(`[${profile}] pool.release 失败: ${err.message}`);
        // 尝试关闭 context 再清除引用，避免 Chrome 进程驻留
        const s = pool.slots.get(profile);
        if (s) {
          if (s.context) { try { await s.context.close(); } catch {} }
          s.state = 'idle'; s.context = null; s.releasing = false;
        }
      }
      client.send({ type: 'task_result', ...result });
    },
  });
  runningTasks.set(key, ctrl);
}

// ─── 进程生命周期 ─────────────────────────────────────────────────────────────

// 优雅退出：断开 WebSocket、关闭所有 Chrome 实例
async function shutdown(signal) {
  logger.info(`收到 ${signal} 信号 — 正在关闭`);
  client.destroy();
  await pool.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error(`未捕获的异常: ${err.stack ?? err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`未处理的 Promise 拒绝: ${reason}`);
});

// ─── 启动 ─────────────────────────────────────────────────────────────────────

pool.init();
client.connect();

logger.info(`Worker 已启动 — id: ${WORKER_ID}, Profile 数量: ${profileNames.length}`);
