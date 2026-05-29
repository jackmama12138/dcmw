require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const ChromePool = require('./chrome-pool');
const GatewayClient = require('./ws-client');
const { runTask } = require('./task-runner');
const actionsLoader = require('./actions-loader');
const logger = require('./logger');

// ─── env validation ───────────────────────────────────────────────────────────

const {
  MAC_CHROME_PATH,
  CHROME_PROFILES_BASE_DIR,
  CHROME_PROFILE_NAME,
  WORKER_ID,
  SERVER_HOST,
} = process.env;

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
  logger.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const profileNames = CHROME_PROFILE_NAME.split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (profileNames.length === 0) {
  logger.error('CHROME_PROFILE_NAME contains no valid profile names');
  process.exit(1);
}

// ─── setup ────────────────────────────────────────────────────────────────────

const pool = new ChromePool({
  chromePath: MAC_CHROME_PATH,
  profilesBaseDir: CHROME_PROFILES_BASE_DIR,
  profileNames,
});

// Map<"taskId:profile", TaskController> — tracks all in-flight task controllers.
const runningTasks = new Map();

function taskKey(taskId, profile) {
  return `${taskId}:${profile}`;
}

const client = new GatewayClient({
  serverUrl: SERVER_HOST,
  workerId: WORKER_ID,
  pool,
  onTask: handleTask,

  onStop({ task_id, profile }) {
    const ctrl = runningTasks.get(taskKey(task_id, profile));
    if (ctrl) {
      ctrl.stop();
      logger.info(`[${profile}] task ${task_id} stop signal received`);
    } else {
      logger.warn(`[${profile}] stop_task for unknown task ${task_id}`);
    }
  },

  onUpdateTime({ task_id, profile, task_time }) {
    const ctrl = runningTasks.get(taskKey(task_id, profile));
    if (ctrl) {
      ctrl.updateTaskTime(task_time);
      logger.info(`[${profile}] task ${task_id} task_time updated → ${task_time}s`);
    } else {
      logger.warn(`[${profile}] update_task_time for unknown task ${task_id}`);
    }
  },

  onReloadActions({ code }) {
    actionsLoader.reload(code);
  },
});

// ─── task handler ─────────────────────────────────────────────────────────────

async function handleTask(task) {
  const { task_id, profile } = task;

  if (!task_id || !profile) {
    logger.warn(`Received task with missing task_id or profile: ${JSON.stringify(task)}`);
    return;
  }

  const slot = pool.slots.get(profile);
  if (!slot) {
    logger.warn(`[${profile}] unknown profile — rejecting task ${task_id}`);
    client.send({ type: 'task_rejected', task_id, profile, reason: 'unknown_profile' });
    return;
  }

  if (slot.state !== 'idle') {
    logger.warn(`[${profile}] not idle (${slot.state}) — rejecting task ${task_id}`);
    client.send({ type: 'task_rejected', task_id, profile, reason: 'slot_busy' });
    // Reset error state so the next dispatch can relaunch Chrome cleanly.
    if (slot.state === 'error') await pool.release(profile);
    return;
  }

  let context;
  try {
    context = await pool.acquire(profile);
  } catch (err) {
    logger.error(`[${profile}] failed to launch Chrome: ${err.message}`);
    client.send({ type: 'task_result', task_id, profile, status: 'error', error: err.message });
    // Fix ③: reset the slot to idle so the gateway can re-dispatch to this profile.
    await pool.release(profile);
    return;
  }

  const key = taskKey(task_id, profile);
  const ctrl = runTask(context, task, {
    onComplete: async (result) => {
      runningTasks.delete(key);
      client.send({ type: 'task_result', ...result });
      await pool.release(profile);
    },
  });
  runningTasks.set(key, ctrl);
}

// ─── process lifecycle ────────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down`);
  client.destroy();
  await pool.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack ?? err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

// ─── start ────────────────────────────────────────────────────────────────────

pool.init();
client.connect();

logger.info(`Worker started — id: ${WORKER_ID}, profiles: ${profileNames.length}`);
