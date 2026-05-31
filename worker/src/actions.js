const logger   = require('./logger');
const reporter = require('./reporter');

// ─── 工具函数（导出供插件复用）────────────────────────────────────────────────

// 将数值限制在 [min, max] 范围内
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// 获取或创建当前 context 中的第一个页面，并确保 PageHub 已挂载
async function getOrCreatePage(context) {
  const pages = context.pages();
  const page  = pages.length > 0 ? pages[0] : await context.newPage();
  getOrCreateHub(page);
  return page;
}

// 模拟人类鼠标移动轨迹（贝塞尔曲线插值 + 随机抖动）
async function humanMouseMove(page, fromX, fromY, toX, toY) {
  const steps = 8 + Math.floor(Math.random() * 6);
  for (let i = 1; i <= steps; i++) {
    const t  = i / steps;
    const cx = (fromX + toX) / 2 + (Math.random() - 0.5) * 40;
    const cy = (fromY + toY) / 2 + (Math.random() - 0.5) * 40;
    const x  = (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * cx + t * t * toX;
    const y  = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * cy + t * t * toY;
    await page.mouse.move(x, y);
  }
}

// 白名单 getBy* 方法集合，集合外的方法一律拒绝
const GETBY_METHODS = new Set([
  'getByText', 'getByRole', 'getByLabel', 'getByPlaceholder',
  'getByAltText', 'getByTestId', 'getByTitle',
]);

// 禁止在 getBy* 参数中出现的危险关键词
const DANGEROUS_ARGS = /\b(require|import|process|global|eval|Function|setTimeout|setInterval|constructor|__proto__|prototype)\b/;

// 将 CSS 选择器字符串或 getBy* 表达式解析为 Playwright Locator
// 统一接受 selector（首选）或 string（兼容别名）
function resolveLocator(page, selectorOrExpr) {
  const expr = selectorOrExpr.trim();
  const getByMatch = expr.match(/^(getBy\w+)\((.+)\)$/s);
  if (!getByMatch) return page.locator(expr);

  const [, method, rawArgs] = getByMatch;
  if (!GETBY_METHODS.has(method)) throw new Error(`resolveLocator: 未知方法 "${method}"`);
  if (DANGEROUS_ARGS.test(rawArgs))  throw new Error(`resolveLocator: 参数中包含禁止关键词`);

  let args;
  try {
    // eslint-disable-next-line no-new-func
    args = new Function('"use strict"; return [' + rawArgs + ']')();
  } catch {
    throw new Error(`resolveLocator: 无法解析 "${expr}" 的参数`);
  }

  for (const arg of args) {
    const t = typeof arg;
    if (t === 'function' || (t === 'object' && arg !== null && Object.getPrototypeOf(arg) !== Object.prototype)) {
      throw new Error(`resolveLocator: "${expr}" 包含不支持的参数类型`);
    }
  }

  switch (method) {
    case 'getByText':        return page.getByText(...args);
    case 'getByRole':        return page.getByRole(...args);
    case 'getByLabel':       return page.getByLabel(...args);
    case 'getByPlaceholder': return page.getByPlaceholder(...args);
    case 'getByAltText':     return page.getByAltText(...args);
    case 'getByTestId':      return page.getByTestId(...args);
    case 'getByTitle':       return page.getByTitle(...args);
    default: throw new Error(`resolveLocator: 不支持的方法 "${method}"`);
  }
}

// 从 params 中提取选择器，selector 优先，string 为兼容别名
function pickSelector(params) {
  return params.selector ?? params.string ?? null;
}

// 渐进退避延迟表（对齐 Playwright 内部重试策略）
const RETRY_DELAYS = [0, 20, 100, 100, 500];

// 定位元素并等待其可见，按渐进退避策略重试直到 timeout 耗尽
// 返回 { locator, selector } 或 { error: reason, selector }
async function resolveElement(page, params, actionName) {
  const expr = pickSelector(params);
  if (!expr || typeof expr !== 'string') {
    return { error: 'no_selector', selector: null };
  }

  const timeout  = clamp(params.timeout ?? 5000, 500, 15_000);
  const locator  = resolveLocator(page, expr);
  const deadline = Date.now() + timeout;
  let attempt    = 0;

  while (true) {
    // 退避等待（第一次 delay=0，立即尝试）
    const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
    if (delay > 0) await new Promise(r => setTimeout(r, delay));

    // 超时检查
    if (Date.now() >= deadline) {
      logger.warn(`${actionName}: "${expr}" 在 ${timeout}ms 内未出现`);
      return { error: 'not_found', selector: expr };
    }

    try {
      // 剩余时间内等待元素可见
      const remaining = deadline - Date.now();
      await locator.waitFor({ state: 'visible', timeout: Math.max(remaining, 50) });
      return { locator, selector: expr };
    } catch (err) {
      const msg = err.message ?? '';
      // 元素已从 DOM 移除（不可恢复，直接返回）
      if (msg.includes('detached') || msg.includes('destroyed')) {
        logger.warn(`${actionName}: "${expr}" 已从 DOM 移除`);
        return { error: 'not_connected', selector: expr };
      }
      // timeout 耗尽
      if (Date.now() >= deadline) {
        logger.warn(`${actionName}: "${expr}" 在 ${timeout}ms 内未出现`);
        return { error: 'not_found', selector: expr };
      }
      attempt++;
    }
  }
}

// 模拟人类点击，按 Playwright actionability 顺序执行检查：
//   1. enabled   — 元素未被禁用
//   2. stable    — 连续两次 boundingBox 位置一致（50ms 间隔）
//   3. viewport  — 中心点在视口范围内
//   4. 贝塞尔鼠标移动 + 随机偏移点击
// 返回 { ok, box } 或 { ok: false, reason }
async function humanClick(page, locator, dblClick = false) {
  // ① enabled 检查
  let enabled;
  try { enabled = await locator.isEnabled(); } catch { enabled = false; }
  if (!enabled) {
    logger.warn('click: 元素处于禁用状态');
    return { ok: false, reason: 'not_enabled' };
  }

  // ② stable 检查：采样两次 boundingBox，间隔 50ms，位置变化超过 2px 视为不稳定
  let box1;
  try { box1 = await locator.boundingBox(); } catch { box1 = null; }
  if (!box1) {
    logger.warn('click: 元素无边界框（尺寸为零或不可见）');
    return { ok: false, reason: 'no_bbox' };
  }

  await new Promise(r => setTimeout(r, 50));

  let box;
  try { box = await locator.boundingBox(); } catch { box = null; }
  if (!box) {
    logger.warn('click: 采样期间元素消失（已从 DOM 移除）');
    return { ok: false, reason: 'not_connected' };
  }

  const moved = Math.abs(box.x - box1.x) > 2 || Math.abs(box.y - box1.y) > 2 ||
                Math.abs(box.width - box1.width) > 2 || Math.abs(box.height - box1.height) > 2;
  if (moved) {
    // 元素仍在移动，使用最新位置但记录警告（动画中元素，继续执行）
    logger.warn('click: 元素位置不稳定，使用最新坐标继续');
  }

  // ③ viewport 检查：中心点必须在视口内
  const vs  = page.viewportSize() ?? { width: 1280, height: 720 };
  const cx  = box.x + box.width  / 2;
  const cy  = box.y + box.height / 2;
  if (cx < 0 || cy < 0 || cx > vs.width || cy > vs.height) {
    logger.warn(`click: 元素中心点 (${cx.toFixed(0)}, ${cy.toFixed(0)}) 超出视口 ${vs.width}×${vs.height}`);
    return { ok: false, reason: 'not_in_viewport' };
  }

  // ④ 贝塞尔移动 + 随机微偏移点击
  const toX = cx + (Math.random() - 0.5) * 4;
  const toY = cy + (Math.random() - 0.5) * 4;

  await humanMouseMove(page, Math.random() * vs.width, Math.random() * vs.height, toX, toY);
  await new Promise(r => setTimeout(r, 80 + Math.floor(Math.random() * 120)));

  try {
    if (dblClick) {
      await page.mouse.dblclick(toX, toY);
    } else {
      await page.mouse.click(toX, toY);
    }
  } catch (err) {
    logger.warn(`click: 鼠标事件失败 — ${err.message}`);
    return { ok: false, reason: 'click_failed' };
  }

  return { ok: true, box };
}

// ─── Hub：全局 request/response 监听 ─────────────────────────────────────────

// 标准化对象所有 key：连字符转下划线，递归处理嵌套对象（不处理数组元素）
function normalizeKeys(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/-/g, '_'),
      normalizeKeys(v),
    ])
  );
}

// 按点路径提取对象字段，中途遇到 null/undefined 不抛错
function pickPath(obj, path) {
  if (!path) return obj;
  if (obj === null || obj === undefined) return undefined;
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

// 从 body 中按 pick 配置提取字段，处理所有边界情况
function applyPick(body, pick) {
  if (body === null || body === undefined) return null;
  if (!pick || (Array.isArray(pick) && pick.length === 0)) return body;

  if (typeof pick === 'string') {
    if (!pick.trim()) return body;
    const val = pickPath(body, pick.trim());
    return val === undefined ? null : val;
  }

  if (Array.isArray(pick)) {
    const result = {};
    for (const path of pick) {
      if (!path || typeof path !== 'string') continue;
      const val = pickPath(body, path.trim());
      result[path] = val === undefined ? null : val;
    }
    return result;
  }

  return body;
}

class PageHub {
  constructor(page) {
    this._subs = new Map();
    this._seq  = 0;
    page.on('response', res => this._dispatch('response', res.url(), res));
    page.on('request',  req => this._dispatch('request',  req.url(), req));
  }

  _dispatch(type, url, obj) {
    for (const [token, sub] of this._subs) {
      if (sub.type !== type) continue;
      if (!url.includes(sub.urlPattern)) continue;
      sub.callback(obj);
      if (sub.remaining !== Infinity) {
        sub.remaining--;
        if (sub.remaining <= 0) this._subs.delete(token);
      }
    }
  }

  subscribe(type, urlPattern, callback, times = 1) {
    const token = ++this._seq;
    this._subs.set(token, {
      type, urlPattern, callback,
      remaining: times === -1 ? Infinity : Math.max(1, times),
    });
    return token;
  }

  unsubscribe(token) {
    this._subs.delete(token);
  }
}

const _hubs = new WeakMap();
function getOrCreateHub(page) {
  if (!_hubs.has(page)) _hubs.set(page, new PageHub(page));
  return _hubs.get(page);
}

// ─── 动作实现 ─────────────────────────────────────────────────────────────────

// 导航到指定 URL
// waitUntil: 'commit'(默认) | 'load' | 'domcontentloaded' | 'networkidle'
// 返回 { ok, url } 或 { ok: false, reason, error }
async function navigate(context, { url, waitUntil = 'commit' }) {
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'invalid_url', error: `无效的 url "${url}"` };
  }
  const VALID   = ['commit', 'load', 'domcontentloaded', 'networkidle'];
  const safeWait = VALID.includes(waitUntil) ? waitUntil : 'commit';
  const page    = await getOrCreatePage(context);
  try {
    await page.goto(url, { waitUntil: safeWait, timeout: 30_000 });
    return { ok: true, url };
  } catch (err) {
    logger.warn(`navigate: 导航失败 "${url}" — ${err.message}`);
    return { ok: false, reason: 'nav_failed', error: err.message };
  }
}

// 刷新当前页面
// 返回 { ok } 或 { ok: false, reason }
async function reload(context) {
  const page = await getOrCreatePage(context);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    return { ok: true };
  } catch (err) {
    logger.warn(`reload: ${err.message}`);
    return { ok: false, reason: 'reload_failed' };
  }
}

// 随机等待指定范围的时长（毫秒），ctrl.stopped 时提前退出
// 参数: min（默认读环境变量 WAIT_TIME）, max
async function wait(_context, params, ctrl) {
  const [defaultMin, defaultMax] = (process.env.WAIT_TIME ?? '3000,4000')
    .split(',').map(Number);
  const min   = params.min ?? defaultMin ?? 3000;
  const max   = params.max ?? defaultMax ?? 4000;
  const lo    = clamp(Math.min(min, max), 0, Infinity);
  const hi    = clamp(Math.max(min, max), lo, Infinity);
  const delay = lo + Math.floor(Math.random() * (hi - lo + 1));
  const end   = Date.now() + delay;
  await new Promise(resolve => {
    const tick = () => {
      if (ctrl?.stopped || Date.now() >= end) return resolve();
      setTimeout(tick, 100);
    };
    tick();
  });
  return { ok: true };
}

// 停留动作：持续等待直到 ctrl.stopped 或达到 task_time 上限
async function dwell(_context, _params, ctrl) {
  const maxSec = Math.max(1, Number(process.env.DWELL_MAX_SECONDS) || 72000);
  const start  = Date.now();
  await new Promise(resolve => {
    const tick = () => {
      if (!ctrl || ctrl.stopped) return resolve();
      const elapsed = (Date.now() - start) / 1000;
      if (elapsed >= Math.min(ctrl.task_time, maxSec)) return resolve();
      setTimeout(tick, 500);
    };
    tick();
  });
  return { ok: true };
}

// 单击指定元素（人类模拟）
// 返回 { ok, selector, box } 或 { ok: false, reason, selector }
async function click(context, params) {
  const page = await getOrCreatePage(context);
  const { locator, error, selector } = await resolveElement(page, params, 'click');
  if (error) return { ok: false, reason: error, selector };
  const result = await humanClick(page, locator, false);
  return { ...result, selector };
}

// 双击指定元素（人类模拟）
// 返回 { ok, selector, box } 或 { ok: false, reason, selector }
async function dblclick(context, params) {
  const page = await getOrCreatePage(context);
  const { locator, error, selector } = await resolveElement(page, params, 'dblclick');
  if (error) return { ok: false, reason: error, selector };
  const result = await humanClick(page, locator, true);
  return { ...result, selector };
}

// 悬停到指定元素
// 返回 { ok, selector } 或 { ok: false, reason, selector }
async function hover(context, params) {
  const page = await getOrCreatePage(context);
  const { locator, error, selector } = await resolveElement(page, params, 'hover');
  if (error) return { ok: false, reason: error, selector };
  try {
    await locator.hover({ timeout: 5000 });
    return { ok: true, selector };
  } catch (err) {
    logger.warn(`hover: ${err.message}`);
    return { ok: false, reason: 'hover_failed', selector };
  }
}

// 填写输入框，检查顺序：visible → enabled → editable → 填写
// mode: 'fill'（直接赋值，默认）| 'type'（逐字模拟键盘输入）
// 返回 { ok, selector } 或 { ok: false, reason, selector }
async function fill(context, params) {
  const { value, mode = 'fill', delay = 50, clear = true } = params;
  const selector = pickSelector(params);

  if (!selector) return { ok: false, reason: 'no_selector' };
  if (typeof value !== 'string') return { ok: false, reason: 'invalid_value' };

  const safeValue = value.slice(0, 2000);
  const safeDelay = clamp(Number(delay) || 0, 0, 500);
  const page      = await getOrCreatePage(context);

  // ① visible 检查（复用渐进退避）
  const { locator, error } = await resolveElement(page, params, 'fill');
  if (error) return { ok: false, reason: error, selector };

  // ② enabled 检查
  let enabled;
  try { enabled = await locator.isEnabled(); } catch { enabled = false; }
  if (!enabled) {
    logger.warn(`fill: "${selector}" 处于禁用状态`);
    return { ok: false, reason: 'not_enabled', selector };
  }

  // ③ editable 检查（Playwright: input/textarea/[contenteditable]，排除 readonly）
  let editable;
  try { editable = await locator.isEditable(); } catch { editable = true; }
  if (!editable) {
    logger.warn(`fill: "${selector}" 不可编辑（readonly 或非输入元素）`);
    return { ok: false, reason: 'not_editable', selector };
  }

  // ④ 填写
  try {
    if (mode === 'type') {
      await locator.click();
      if (clear) {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
      }
      await locator.pressSequentially(safeValue, { delay: safeDelay });
    } else {
      await locator.fill(safeValue);
    }
    return { ok: true, selector };
  } catch (err) {
    logger.warn(`fill: 填写失败 — ${err.message}`);
    return { ok: false, reason: 'fill_failed', selector };
  }
}

// 滚动页面或指定元素
// 不指定 selector 则滚动整个页面
// 返回 { ok } 或 { ok: false, reason }
async function scroll(context, { x = 0, y = 300, selector = null }) {
  const page = await getOrCreatePage(context);
  if (selector) {
    const locator = resolveLocator(page, selector);
    let el;
    try { el = await locator.elementHandle({ timeout: 5000 }); } catch { el = null; }
    if (!el) {
      logger.warn(`scroll: 选择器 "${selector}" 未找到，已跳过`);
      return { ok: false, reason: 'not_found', selector };
    }
    await el.evaluate((node, { x, y }) => node.scrollBy(x, y), { x, y });
  } else {
    await page.mouse.wheel(x, y);
  }
  return { ok: true };
}

// 将鼠标移动到绝对坐标
// 返回 { ok } 或 { ok: false, reason }
async function mousemove(context, { x, y }) {
  if (typeof x !== 'number' || typeof y !== 'number') {
    return { ok: false, reason: 'invalid_coords' };
  }
  const page = await getOrCreatePage(context);
  await page.mouse.move(x, y);
  return { ok: true };
}

// 等待指定元素出现
// stopOnTimeout: true 时超时则停止整个任务
// 返回 { ok, selector } 或 { ok: false, reason, selector }
async function waitFor(context, params, ctrl) {
  const selector = pickSelector(params);
  if (!selector) return { ok: false, reason: 'no_selector' };

  const page        = await getOrCreatePage(context);
  const safeTimeout = clamp(Number(params.timeout) || 10000, 500, 120_000);
  const locator     = resolveLocator(page, selector);

  try {
    await locator.waitFor({ state: 'visible', timeout: safeTimeout });
    return { ok: true, selector };
  } catch {
    if (params.stopOnTimeout) {
      logger.warn(`wait-for: "${selector}" 超时，结束任务`);
      ctrl?.stop();
      return { ok: false, reason: 'timeout_stopped', selector };
    }
    logger.warn(`wait-for: "${selector}" 超时，继续执行`);
    return { ok: false, reason: 'timeout', selector };
  }
}

// 悬停到元素上，停留 duration 毫秒后将鼠标移走
// 参数: selector（选择器）, duration（停留毫秒，默认1000）, exit_x/exit_y（移出坐标）
// 返回 { ok, selector } 或 { ok: false, reason, selector }
async function hoverCapture(context, params) {
  const selector = pickSelector(params);
  if (!selector) return { ok: false, reason: 'no_selector' };

  const { duration = 1000, exit_x = 0, exit_y = 0 } = params;
  const page = await getOrCreatePage(context);
  const { locator, error } = await resolveElement(page, { selector, timeout: params.timeout }, 'hover-capture');
  if (error) return { ok: false, reason: error, selector };

  await locator.hover();
  await new Promise(r => setTimeout(r, clamp(Number(duration) || 1000, 0, 30_000)));
  await page.mouse.move(exit_x, exit_y).catch(() => {});
  return { ok: true, selector };
}

// 监听响应或请求事件并上报到 gateway（基于 PageHub 全局监听，零 CDP 开销）
//
// type:  'response'（默认）| 'request'
// times: 捕获次数上限（默认 1，-1 表示不限次数）
// pick:  字段提取路径，字符串（单路径）或数组（多路径），不配置则上报完整 body
//
// 返回 { ok: true }（立即返回，捕获异步进行）
async function intercept(context, { url, type = 'response', times = 1, pick }, ctrl) {
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'no_url' };
  }
  if (type !== 'response' && type !== 'request') {
    return { ok: false, reason: 'invalid_type' };
  }

  const page = await getOrCreatePage(context);
  const hub  = getOrCreateHub(page);

  const callback = async (obj) => {
    const matchedUrl = obj.url();

    if (type === 'request') {
      let postParams = null;
      try {
        postParams = obj.method() === 'POST' ? obj.postDataJSON() : null;
      } catch { postParams = null; }

      const reported = {
        method:  obj.method(),
        url:     matchedUrl,
        headers: normalizeKeys(obj.headers()),
        query:   Object.fromEntries(new URL(matchedUrl).searchParams),
        body:    postParams,
      };
      const extracted = applyPick(reported, pick);
      reporter.reportCapture(ctrl, { pattern: url, matchedUrl, data: extracted });
      return;
    }

    // type === 'response'
    let body = null;
    try { body = await obj.json(); } catch { body = await obj.text().catch(() => null); }
    const extracted = applyPick(body, pick);
    reporter.reportCapture(ctrl, { pattern: url, matchedUrl, body: extracted });
  };

  const token = hub.subscribe(type, url, callback, times);
  ctrl?.addCleanup(() => hub.unsubscribe(token));

  return { ok: true };
}

// 通过 CDP 截取当前页面 JPEG 并上报到 gateway（二进制上传）
// quality: 20–90（默认60），fullPage: 是否截全页
// 返回 { ok } 或 { ok: false, reason }
async function screenshot(context, { fullPage = false, quality = 60 }, ctrl) {
  const safeQuality = clamp(Number(quality) || 60, 20, 90);
  const page        = await getOrCreatePage(context);

  let buffer;
  try {
    const cdp = await context.newCDPSession(page);
    const { data } = await Promise.race([
      cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: safeQuality, captureBeyondViewport: fullPage }),
      new Promise((_, r) => setTimeout(() => r(new Error('CDP 超时')), 10_000)),
    ]);
    buffer = Buffer.from(data, 'base64');
    await cdp.detach().catch(() => {});
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('closed') || msg.includes('destroyed')) return { ok: false, reason: 'context_closed' };
    logger.warn(`screenshot: 截图失败 — ${msg.split('\n')[0]}`);
    return { ok: false, reason: 'capture_failed' };
  }

  const reported = reporter.reportScreenshot(ctrl, buffer);
  if (!reported) return { ok: false, reason: 'no_gateway_url' };
  return { ok: true };
}

// 暂停第一个或全部匹配的 <video> 元素
// all: false（默认，只暂停第一个）| true（全部）
// 返回 { ok, paused, total }
async function pauseVideo(context, { selector = 'video', all = false, timeout = 10000 }) {
  const selectAll   = all === true || all === 'true';
  const safeTimeout = clamp(Number(timeout) || 10000, 1000, 30000);
  const page        = await getOrCreatePage(context);

  try {
    await page.waitForFunction(
      ({ sel, all }) => {
        const els = all ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)];
        return els.some(v => v && v.readyState > 0);
      },
      { sel: selector, all: selectAll },
      { timeout: safeTimeout }
    );
  } catch {
    logger.warn(`pause-video: "${selector}" 在 ${safeTimeout}ms 内未就绪，已跳过`);
    return { ok: false, reason: 'not_ready' };
  }

  const result = await page.evaluate(({ sel, all }) => {
    const els = all ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)];
    let total = 0, paused = 0;
    for (const v of els) {
      if (!v || v.readyState === 0) continue;
      total++;
      if (!v.paused) { v.pause(); paused++; }
    }
    return { total, paused };
  }, { sel: selector, all: selectAll });

  logger.info(`pause-video: 暂停了 ${result.paused}/${result.total} 个 "${selector}"`);
  return { ok: true, ...result };
}

// 对匹配的 <video> 元素设置静音或取消静音
// mute: true（静音，默认）| false（取消静音）
// 返回 { ok, count }
async function muteVideo(context, { selector = 'video', mute = true, all = false, timeout = 10000 }) {
  const selectAll   = all === true || all === 'true';
  const safeMute    = mute === true || mute === 'true';
  const safeTimeout = clamp(Number(timeout) || 10000, 1000, 30000);
  const page        = await getOrCreatePage(context);

  try {
    await page.waitForSelector(selector, { timeout: safeTimeout });
  } catch {
    logger.warn(`mute-video: "${selector}" 在 ${safeTimeout}ms 内未出现，已跳过`);
    return { ok: false, reason: 'not_found' };
  }

  const count = await page.evaluate(({ sel, mute, all }) => {
    const els = all ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)];
    let n = 0;
    for (const v of els) {
      if (!v) continue;
      v.muted = mute;
      v.volume = mute ? 0 : 1;
      n++;
    }
    return n;
  }, { sel: selector, mute: safeMute, all: selectAll });

  logger.info(`mute-video: ${safeMute ? '静音' : '取消静音'} ${count} 个 "${selector}"`);
  return { ok: true, count };
}

// 注入可见性欺骗脚本 + 人类活动模拟，防止页面检测到后台状态
// 同一 context 只注入一次（懒关闭复用不重复叠加）
const _antidetectInited = new WeakSet();

async function antidetect(context) {
  const script = () => {
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(Document.prototype, 'hidden',          { get: () => false,     configurable: true });

    if (!window._antiPauseHumanHook) {
      const triggerNext = () => {
        const types = ['mousemove', 'keydown', 'wheel', 'click'];
        document.dispatchEvent(new Event(types[Math.floor(Math.random() * types.length)], { bubbles: true }));
        window._antiPauseHumanHook = setTimeout(triggerNext, 30_000 + Math.floor(Math.random() * 30_000));
      };
      triggerNext();
    }

    if (!window._antiMuteHook) {
      window._antiMuteHook = true;
      document.addEventListener('play', e => {
        if (e.target.tagName === 'VIDEO') { e.target.muted = true; e.target.volume = 0; }
      }, true);
    }
  };

  if (!_antidetectInited.has(context)) {
    _antidetectInited.add(context);
    await context.addInitScript(script);
  }
  const page = await getOrCreatePage(context);
  try {
    await page.evaluate(script);
  } catch (err) {
    logger.warn(`antidetect: evaluate 已跳过 (${err.message})`);
  }
  return { ok: true };
}

// 在页面上下文中执行 JS 表达式或函数，返回执行结果
// code: 'document.title' 或 '() => { return ... }'
async function evalAction(context, { code }) {
  if (!code || typeof code !== 'string') {
    return { ok: false, reason: 'no_code' };
  }
  const page = await getOrCreatePage(context);
  try {
    const result = await page.evaluate(code);
    logger.info(`eval 结果: ${JSON.stringify(result)}`);
    return { ok: true, result };
  } catch (err) {
    logger.warn(`eval 错误: ${err.message}`);
    return { ok: false, reason: 'eval_failed', error: err.message };
  }
}

// 在 Node.js 侧执行接收 { page, context, ctrl } 的 Playwright 代码片段
// code: 'async ({ page, context, ctrl }) => { ... }'
async function runCode(context, { code }, ctrl) {
  if (!code || typeof code !== 'string') {
    return { ok: false, reason: 'no_code' };
  }
  const page = await getOrCreatePage(context);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${code})`)();
    const result = await fn({ page, context, ctrl });
    return { ok: true, result };
  } catch (err) {
    logger.warn(`run-code 错误: ${err.message}`);
    return { ok: false, reason: 'run_failed', error: err.message };
  }
}

// 懒关闭：导航到 about:blank，真正关闭由 chrome-pool 空闲超时负责
async function close(context, _params, ctrl) {
  if (!context) return { ok: false, reason: 'no_context' };
  ctrl?.markReleasing();
  try {
    const pages = context.pages();
    if (pages.length > 0) await pages[0].goto('about:blank').catch(() => {});
    return { ok: true };
  } catch (err) {
    logger.warn(`close: ${err.message}`);
    return { ok: false, reason: 'close_failed' };
  }
}

// ─── 动作注册表 ───────────────────────────────────────────────────────────────

const actions = {
  navigate,
  reload,
  wait,
  dwell,
  click,
  dblclick,
  hover,
  fill,
  scroll,
  mousemove,
  screenshot,
  antidetect,
  intercept,
  'pause-video'  : pauseVideo,
  'mute-video'   : muteVideo,
  'wait-for'     : waitFor,
  'hover-capture': hoverCapture,
  'eval'         : evalAction,
  'run-code'     : runCode,
  close,
};

// ─── 导出 ─────────────────────────────────────────────────────────────────────
// actions      供 actions-loader 合并到全局 ACTION_MAP
// 工具函数     供业务插件复用，避免重复实现

module.exports = {
  actions,
  // 工具函数（供插件复用）
  clamp,
  getOrCreatePage,
  humanMouseMove,
  resolveLocator,
  pickSelector,
  resolveElement,
  humanClick,
  pickPath,
  applyPick,
  getOrCreateHub,
};
