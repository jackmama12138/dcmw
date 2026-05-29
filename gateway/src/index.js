const http = require('http');
const path = require('path');
const express = require('express');

const config = require('./config');
const logger = require('./logger');
const { createRedisClient } = require('./redis');
const TaskStore = require('./task-store');
const WorkerRegistry = require('./worker-registry');
const Scheduler = require('./scheduler');
const { createWsServer, cleanupWorker } = require('./ws-server');
const { createRouter } = require('./router');

async function main() {
  // ─── infrastructure ───────────────────────────────────────────────────────
  const redis = createRedisClient(config.redis);
  await redis.connect();

  const taskStore = new TaskStore(redis);
  const registry = new WorkerRegistry();
  const scheduler = new Scheduler({ taskStore, registry });

  // On restart, reset in-flight task counters so tasks can be re-dispatched
  await taskStore.resetRunning();

  // ─── express ──────────────────────────────────────────────────────────────
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, '../public')));
  app.use(createRouter({ taskStore, registry, scheduler }));

  // ─── http + ws server ─────────────────────────────────────────────────────
  const server = http.createServer(app);
  createWsServer(server, { registry, taskStore, scheduler });

  server.listen(config.port, () => {
    logger.info(`Gateway listening on port ${config.port}`);
  });

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

  // ─── process lifecycle ────────────────────────────────────────────────────
  async function shutdown(signal) {
    logger.info(`Received ${signal} — shutting down`);
    server.close(() => logger.info('HTTP server closed'));
    await redis.quit();
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
