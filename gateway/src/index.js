const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const logger = require('./logger');
const { createRedisClient } = require('./redis');
const TaskStore = require('./task-store');
const WorkerRegistry = require('./worker-registry');
const Scheduler = require('./scheduler');
const { createWsServer, cleanupWorker } = require('./ws-server');
const { createRouter } = require('./router');
const sseBus = require('./sse-bus');

async function main() {
  // ─── infrastructure ───────────────────────────────────────────────────────
  const backend = (process.env.STORAGE_BACKEND || 'redis').toLowerCase();
  let redis = null;
  let taskStore;

  if (backend === 'sqlite') {
    logger.info('存储后端: SQLite');
    taskStore = new TaskStore();
  } else {
    logger.info('存储后端: Redis');
    redis = createRedisClient(config.redis);
    await redis.connect();
    taskStore = new TaskStore(redis);
  }
  const registry = new WorkerRegistry();
  const scheduler = new Scheduler({ taskStore, registry });

  // On restart, reset in-flight task counters so tasks can be re-dispatched
  await taskStore.resetRunning();

  // ─── express ──────────────────────────────────────────────────────────────
  const app = express();
  app.use(cors());
  // Raw binary parser for screenshot uploads — must be registered before express.json()
  // so image/jpeg requests don't hit the 100KB JSON limit.
  app.use('/api/screenshots', express.raw({ type: 'image/jpeg', limit: '3mb' }));
  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, '../public')));
  // Serve screenshot files directly so the frontend can load them via <img src>
  app.use('/data/screenshots', express.static(path.resolve(__dirname, '../data/screenshots')));
  app.use(createRouter({ taskStore, registry, scheduler }));

  // ─── http + ws server ─────────────────────────────────────────────────────
  const server = http.createServer(app);
  sseBus.init(registry, taskStore);
  createWsServer(server, { registry, taskStore, scheduler });

  server.listen(config.port, () => {
    logger.info(`Gateway listening on port ${config.port}`);
  });

  // Periodic re-dispatch: if tasks are waiting but all workers were offline,
  // no event would trigger dispatch after they reconnect — this acts as a safety net.
  setInterval(() => scheduler.dispatch(), 30_000);

  // ─── Fix ⑦: heartbeat timeout watcher ────────────────────────────────────
  // Workers send heartbeats every 30s. After 90s of silence (3 missed beats),
  // assume the worker is dead and clean up its in-flight tasks.
  const HEARTBEAT_TIMEOUT_MS = 90_000;
  setInterval(() => {
    const stale = registry.getStaleWorkers(HEARTBEAT_TIMEOUT_MS);
    for (const { workerId, ws } of stale) {
      logger.warn(`[${workerId}] heartbeat timeout — forcing cleanup`);
      cleanupWorker(workerId, ws, { registry, taskStore, scheduler })
        .catch(err => logger.error(`[${workerId}] heartbeat cleanup error: ${err.message}`));
    }
  }, 30_000);

  // ─── Fix ⑨: periodic index prune ─────────────────────────────────────────
  // Remove done tasks older than 24h from the sorted set so getDispatchable()
  // doesn't scan them forever.
  setInterval(async () => {
    const count = await taskStore.pruneCompleted(86400).catch(err => {
      logger.error(`Prune error: ${err.message}`);
      return 0;
    });
    if (count > 0) logger.info(`Pruned ${count} completed task(s) from index`);
  }, 60 * 60 * 1000); // every hour

  // Purge screenshot directories older than 24h to prevent disk exhaustion.
  const SCREENSHOTS_DIR = path.resolve(__dirname, '../data/screenshots');
  setInterval(() => {
    if (!fs.existsSync(SCREENSHOTS_DIR)) return;
    const cutoff = Date.now() - 86400 * 1000;
    try {
      for (const taskDir of fs.readdirSync(SCREENSHOTS_DIR)) {
        const taskPath = path.join(SCREENSHOTS_DIR, taskDir);
        try {
          const stat = fs.statSync(taskPath);
          if (stat.isDirectory() && stat.mtimeMs < cutoff) {
            fs.rmSync(taskPath, { recursive: true, force: true });
            logger.info(`Purged screenshot dir: ${taskDir}`);
          }
        } catch {}
      }
    } catch (err) {
      logger.error(`Screenshot purge error: ${err.message}`);
    }
  }, 60 * 60 * 1000);

  // ─── process lifecycle ────────────────────────────────────────────────────
  async function shutdown(signal) {
    logger.info(`Received ${signal} — shutting down`);
    server.close(() => logger.info('HTTP server closed'));
    if (redis) await redis.quit();
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
}

main().catch(err => {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
