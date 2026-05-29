require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

module.exports = {
  port: parseInt(process.env.PORT ?? '7777', 10),
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
};
