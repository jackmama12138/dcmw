/**
 * checkRanklist — 检查当前账号在抖音直播间的榜单状态
 *
 * 前置保证（由调用方确保）：
 *   - 页面已在 *.douyin.com 且处于 dwell 阶段
 *   - hover 贡献用户 tab 一定触发 HTTP GET 请求
 *
 * 不加入 pipeline；通过 WS run_ranklist 消息触发。
 * 规则：不抛出、不重试、不循环、最多 2 行日志/次。
 */

const logger = require('./logger');

const RANKLIST_KW = 'webcast/ranklist/audience';

// 执行榜单检查并上报结果到 gateway
async function checkRanklist(context, ctrl) {
  const profile = ctrl?.profile ?? 'unknown';
  const page = context.pages()[0];
  if (!page) return;

  // ── 1. 直播是否已结束（快速非阻塞检查）────────────────────────────────────
  const ended = await page.getByText('直播已结束').first()
    .isVisible({ timeout: 500 }).catch(() => false);
  if (ended) {
    logger.info(`[${profile}] ranklist: 直播已结束，跳过`);
    return;
  }

  // ── 2. 等待「贡献用户」tab 可见 ────────────────────────────────────────────
  const tab = page.getByText('贡献用户').first();
  try {
    await tab.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    logger.warn(`[${profile}] ranklist: 贡献用户 tab 未出现`);
    return;
  }

  // ── 3. 若 tab 已选中，先点「全部」重置，让 hover 触发新请求 ───────────────
  const isSelected = await tab.evaluate(el =>
    el.classList.contains('active') || el.classList.contains('selected') ||
    el.getAttribute('aria-selected') === 'true'
  ).catch(() => false);

  if (isSelected) {
    await page.getByText('全部').first().click({ timeout: 2_000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 200));
  }

  // ── 4. 先注册监听再 hover（避免漏掉请求）──────────────────────────────────
  const responsePromise = page.waitForResponse(
    r => r.url().includes(RANKLIST_KW),
    { timeout: 10_000 }
  );

  await tab.hover({ timeout: 3_000 }).catch(() => {});

  // ── 5. 等响应并解析 ────────────────────────────────────────────────────────
  let json;
  try {
    const res = await responsePromise;
    json = await res.json();
  } catch {
    logger.warn(`[${profile}] ranklist: 响应超时或解析失败`);
    return;
  }

  // ── 6. 组装上报数据（selfInfo 为空也上报，表示未登录状态）────────────────
  const selfInfo = json?.data?.self_info ?? {};
  const payload = {
    worker_id   : process.env.WORKER_ID ?? '',
    profile,
    task_id     : ctrl?.task_id ?? '',
    live_url    : page.url(),
    timestamp   : Date.now(),
    is_logged_in: !!selfInfo.user,
    nickname    : selfInfo.user?.nickname ?? '',
    rank        : typeof selfInfo.rank === 'number' ? selfInfo.rank : 0,
    is_ranked   : (selfInfo.rank ?? 0) > 0,
  };

  logger.info(
    `[${profile}] ranklist: 已登录=${payload.is_logged_in} ` +
    `排名=${payload.rank} 昵称=${payload.nickname || '—'}`
  );

  // ── 7. 停留 10s 后将鼠标移出（避免持续 hover 触发重复请求）──────────────
  await new Promise(r => setTimeout(r, 10_000));
  await page.mouse.move(0, 0).catch(() => {});

  // ── 8. 上报 ────────────────────────────────────────────────────────────────
  const base = (process.env.CENTER_NOTIFY_URL ?? '').replace(/\/notify$/, '');
  if (!base) return;
  fetch(`${base}/api/ranklist`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(payload),
    signal : AbortSignal.timeout(5_000),
  }).catch(() => {});
}

module.exports = { checkRanklist };
