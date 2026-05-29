const winston = require('winston');
const path = require('path');
const fs = require('fs');

const LOG_DIR = path.resolve(__dirname, '../../logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function cleanOldLogs() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let files;
  try {
    files = fs.readdirSync(LOG_DIR);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.startsWith('worker-') || !file.endsWith('.log')) continue;
    const filePath = path.join(LOG_DIR, file);
    try {
      const { mtimeMs } = fs.statSync(filePath);
      if (mtimeMs < cutoff) fs.unlinkSync(filePath);
    } catch {
      // ignore individual file errors
    }
  }
}

cleanOldLogs();

const today = new Date().toISOString().slice(0, 10);

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) =>
      `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(LOG_DIR, `worker-${today}.log`),
      maxsize: 20 * 1024 * 1024,  // 20 MB per file
      maxFiles: 3,                  // keep at most 3 rotated files → max 60 MB total
    }),
  ],
});

module.exports = logger;
