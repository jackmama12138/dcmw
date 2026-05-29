const Redis = require('ioredis');
const logger = require('./logger');

function createRedisClient({ host, port, password }) {
  const client = new Redis({
    host,
    port,
    password,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 500, 5000),
    maxRetriesPerRequest: null,
  });

  client.on('connect', () => logger.info(`Redis connected ${host}:${port}`));
  client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'));

  return client;
}

module.exports = { createRedisClient };
