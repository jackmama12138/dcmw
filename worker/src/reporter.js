const logger = require('./logger');

// gateway 上报基地址，统一从 CENTER_NOTIFY_URL 推导
function gatewayBase() {
  return (process.env.CENTER_NOTIFY_URL ?? '').replace(/\/notify$/, '');
}

// 上报拦截到的响应数据到 gateway /api/captures
function reportCapture(ctrl, { pattern, matchedUrl, body }) {
  const base = gatewayBase();
  if (!base) return;
  fetch(`${base}/api/captures`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({
      profile    : ctrl?.profile,
      task_id    : ctrl?.task_id,
      worker_id  : process.env.WORKER_ID ?? '',
      pattern,
      matched_url: matchedUrl,
      data       : body,
      timestamp  : Date.now(),
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(err => logger.warn(`reportCapture 上报失败: ${err.message}`));
}

// 上报 JPEG 截图 buffer 到 gateway /api/screenshots
function reportScreenshot(ctrl, buffer) {
  const base = gatewayBase();
  if (!base) return false;
  fetch(`${base}/api/screenshots`, {
    method : 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Task-Id'   : String(ctrl?.task_id ?? ''),
      'X-Profile'   : String(ctrl?.profile  ?? ''),
      'X-Worker-Id' : String(process.env.WORKER_ID ?? ''),
      'X-Timestamp' : String(Date.now()),
    },
    body  : buffer,
    signal: AbortSignal.timeout(15000),
  }).catch(err => logger.warn(`reportScreenshot 上报失败: ${err.message}`));
  return true;
}

// 上报 Cookie/设备信息到 gateway /api/cookies（按 device 去重覆盖）
function reportCookie(ctrl, { device, ua, cookie }) {
  const base = gatewayBase();
  if (!base) return;
  fetch(`${base}/api/cookies`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({
      user_unique_id: device,
      profile       : ctrl?.profile ?? '',
      task_id       : ctrl?.task_id ?? '',
      worker_id     : process.env.WORKER_ID ?? '',
      ua,
      cookie,
      timestamp     : Date.now(),
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(err => logger.warn(`reportCookie 上报失败: ${err.message}`));
}

module.exports = { reportCapture, reportScreenshot, reportCookie };
