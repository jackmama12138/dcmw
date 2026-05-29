module.exports = {
  apps: [
    {
      name: 'dcmw-gateway',
      script: 'src/index.js',
      cwd: './gateway',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'dcmw-worker',
      script: 'src/index.js',
      cwd: './worker',
      instances: 1,
      autorestart: true,
      watch: false,
      // Worker reads .env from project root via dotenv in src/index.js
    },
  ],
};
