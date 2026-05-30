const logger = require('./logger');

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

// 获取或创建当前 context 中的第一个页面
async function getOrCreatePage(context) {
  const pages = context.pages();
  return pages.length > 0 ? pages[0] : context.newPage();
}

// 将数值限制在 [min, max] 范围内
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// 模拟人类鼠标移动轨迹（贝塞尔曲线）
async function humanMouseMove(page, fromX, fromY, toX, toY) {
  const steps = 8 + Math.floor(Math.random() * 6);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = (fromX + toX) / 2 + (Math.random() - 0.5) * 40;
    const cy = (fromY + toY) / 2 + (Math.random() - 0.5) * 40;
    const x = (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * cx + t * t * toX;
    const y = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * cy + t * t * toY;
    await page.mouse.move(x, y);
  }
}

// 白名单 getBy* 方法集合，集合外的方法一律拒绝
const GETBY_METHODS = new Set([
  'getByText','getByRole','getByLabel','getByPlaceholder',
  'getByAltText','getByTestId','getByTitle',
]);

// 禁止在 getBy* 参数中出现的危险关键词
const DANGEROUS_ARGS = /\b(require|import|process|global|eval|Function|setTimeout|setInterval|constructor|__proto__|prototype)\b/;

// 将选择器字符串或 getBy* 表达式解析为 Playwright Locator
function resolveLocator(page, selectorOrExpr) {
  const expr = selectorOrExpr.trim();
  const getByMatch = expr.match(/^(getBy\w+)\((.+)\)$/s);
  if (!getByMatch) return page.locator(expr);

  const [, method, rawArgs] = getByMatch;

  if (!GETBY_METHODS.has(method)) {
    throw new Error(`resolveLocator: 未知方法 "${method}"`);
  }
  if (DANGEROUS_ARGS.test(rawArgs)) {
    throw new Error(`resolveLocator: "${method}" 的参数中包含禁止关键词`);
  }

  let args;
  try {
    // "use strict" 阻止访问 caller/arguments；加上上方的黑名单，仅允许字面量
    // eslint-disable-next-line no-new-func
    args = new Function('"use strict"; return [' + rawArgs + ']')();
  } catch {
    throw new Error(`resolveLocator: 无法解析 "${expr}" 的参数`);
  }

  // 校验每个参数只能是基本类型或纯对象，不允许函数或类实例
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

// ─── 动作实现 ─────────────────────────────────────────────────────────────────

// 导航到指定 URL，waitUntil 参数经白名单校验
async function navigate(context, { url, waitUntil = 'commit' }) {
  if (!url || typeof url !== 'string') throw new Error(`navigate: 无效的 url "${url}"`);
  const VALID = ['commit', 'load', 'domcontentloaded', 'networkidle'];
  const safeWait = VALID.includes(waitUntil) ? waitUntil : 'commit';
  const page = await getOrCreatePage(context);
  await page.goto(url, { waitUntil: safeWait, timeout: 30_000 });
  return page;
}

// 刷新当前页面
async function reload(context) {
  const page = await getOrCreatePage(context);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    logger.warn(`reload: ${err.message}`);
  }
}

// 等待指定时长（毫秒），支持提前中断
async function wait(_context, params, ctrl) {
  const [defaultMin, defaultMax] = (process.env.WAIT_TIME ?? '3000,4000')
    .split(',').map(Number);
  const min = params.min ?? defaultMin ?? 3000;
  const max = params.max ?? defaultMax ?? 4000;
  const lo = clamp(Math.min(min, max), 0, Infinity);
  const hi = clamp(Math.max(min, max), lo, Infinity);
  const delay = lo + Math.floor(Math.random() * (hi - lo + 1));
  const end = Date.now() + delay;
  await new Promise(resolve => {
    const tick = () => {
      if (ctrl?.stopped || Date.now() >= end) return resolve();
      setTimeout(tick, 100);
    };
    tick();
  });
}

// 停留动作：在 ctrl.stopped 或达到 task_time 前持续等待
async function dwell(_context, _params, ctrl) {
  const maxSec = Math.max(1, Number(process.env.DWELL_MAX_SECONDS) || 72000);
  const start = Date.now();
  await new Promise(resolve => {
    const tick = () => {
      if (!ctrl || ctrl.stopped) return resolve();
      const elapsed = (Date.now() - start) / 1000;
      if (elapsed >= Math.min(ctrl.task_time, maxSec)) return resolve();
      setTimeout(tick, 500);
    };
    tick();
  });
}

// 内部辅助：定位并等待元素可见，超时则返回 null
async function _resolveElement(page, params, actionName) {
  // 接受 { selector }（CSS）或 { string }（getBy* 表达式）
  const expr = params.string ?? params.selector;
  if (!expr || typeof expr !== 'string') {
    throw new Error(`${actionName}: 需要提供 selector 或 string`);
  }
  const timeout = clamp(params.timeout ?? 5000, 500, 15_000);
  const locator = resolveLocator(page, expr);
  try {
    await locator.waitFor({ state: 'visible', timeout });
  } catch {
    logger.warn(`${actionName}: "${expr}" 在 ${timeout}ms 内未出现，已跳过`);
    return null;
  }
  return locator;
}

// 内部辅助：模拟人类点击（随机偏移 + 贝塞尔移动）
async function _humanClick(page, locator, dblClick = false) {
  let box;
  try {
    box = await locator.boundingBox();
  } catch {
    box = null;
  }
  if (!box) {
    logger.warn('click: 元素无边界框（可能隐藏），已跳过');
    return;
  }
  const toX = box.x + box.width / 2 + (Math.random() - 0.5) * 4;
  const toY = box.y + box.height / 2 + (Math.random() - 0.5) * 4;
  const vs = page.viewportSize() ?? { width: 1280, height: 720 };
  await humanMouseMove(page, Math.random() * vs.width, Math.random() * vs.height, toX, toY);
  await new Promise(r => setTimeout(r, 80 + Math.floor(Math.random() * 120)));
  if (dblClick) {
    await page.mouse.dblclick(toX, toY);
  } else {
    await page.mouse.click(toX, toY);
  }
}

// 单击指定元素
async function click(context, params) {
  const page = await getOrCreatePage(context);
  const locator = await _resolveElement(page, params, 'click');
  if (!locator) return;
  await _humanClick(page, locator, false);
}

// 双击指定元素
async function dblclick(context, params) {
  const page = await getOrCreatePage(context);
  const locator = await _resolveElement(page, params, 'dblclick');
  if (!locator) return;
  await _humanClick(page, locator, true);
}

// 悬停到指定元素上
async function hover(context, params) {
  const page = await getOrCreatePage(context);
  const locator = await _resolveElement(page, params, 'hover');
  if (!locator) return;
  try {
    await locator.hover({ timeout: 5000 });
  } catch (err) {
    logger.warn(`hover: ${err.message}`);
  }
}

// 滚动页面或指定元素
async function scroll(context, { x = 0, y = 300, selector = null }) {
  const page = await getOrCreatePage(context);
  if (selector) {
    const locator = resolveLocator(page, selector);
    let el;
    try { el = await locator.elementHandle({ timeout: 5000 }); } catch { el = null; }
    if (!el) {
      logger.warn(`scroll: 选择器 "${selector}" 未找到，已跳过`);
      return;
    }
    await el.evaluate((node, { x, y }) => node.scrollBy(x, y), { x, y });
  } else {
    await page.mouse.wheel(x, y);
  }
}

// 将鼠标移动到绝对坐标
async function mousemove(context, { x, y }) {
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('mousemove: x 和 y（数字）是必填项');
  }
  const page = await getOrCreatePage(context);
  await page.mouse.move(x, y);
}

// 按下鼠标按键
async function mousedown(context, { button = 'left' }) {
  const VALID_BUTTONS = ['left', 'middle', 'right'];
  const safeButton = VALID_BUTTONS.includes(button) ? button : 'left';
  const page = await getOrCreatePage(context);
  await page.mouse.down({ button: safeButton });
}

// 释放鼠标按键
async function mouseup(context, { button = 'left' }) {
  const VALID_BUTTONS = ['left', 'middle', 'right'];
  const safeButton = VALID_BUTTONS.includes(button) ? button : 'left';
  const page = await getOrCreatePage(context);
  await page.mouse.up({ button: safeButton });
}

// 在页面上下文中执行任意 JS 代码并返回结果
// { code: "document.title" } 或 { code: "() => { ... }" }
async function evalAction(context, { code }) {
  if (!code || typeof code !== 'string') throw new Error('eval: code（字符串）是必填项');
  const page = await getOrCreatePage(context);
  try {
    // 将 code 作为字符串传入，使其完全在浏览器上下文中执行，不接触 Node.js 全局
    const result = await page.evaluate(code);
    logger.info(`eval 结果: ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    logger.warn(`eval 错误: ${err.message}`);
  }
}

// 在 Node.js 侧执行接收 { page, context } 的 Playwright 代码片段
// { code: "async ({ page }) => { await page.click('button') }" }
async function runCode(context, { code }, ctrl) {
  if (!code || typeof code !== 'string') throw new Error('run-code: code（字符串）是必填项');
  const page = await getOrCreatePage(context);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${code})`)();
    await fn({ page, context, ctrl });
  } catch (err) {
    logger.warn(`run-code 错误: ${err.message}`);
  }
}

// 关闭所有页面并关闭 context
async function close(context, _params, ctrl) {
  if (!context) return;
  ctrl?.markReleasing();
  try {
    const pages = context.pages();
    await Promise.allSettled(pages.map(p => p.close()));
    await context.close();
  } catch (err) {
    logger.warn(`close: ${err.message}`);
  }
}

// 拦截第一个匹配请求，提取 Cookie 后一次性上报到 gateway
async function rtcookie(context, { url }, ctrl) {
  if (!url || typeof url !== 'string') throw new Error('rtcookie: url 是必填项');

  const page = await getOrCreatePage(context);
  const pattern = `**${url}**`;
  let captured = false;

  const handler = async (route) => {
    try {
      if (!captured) {
        const request = route.request();
        const headers = request.headers();
        const cookie = headers['cookie'] || '';
        if (cookie) {
          captured = true;
          page.unroute(pattern, handler).catch(() => {});

          // 从匹配的 URL 中提取查询参数
          let device_id = '';
          let user_unique_id = '';
          try {
            const u = new URL(request.url());
            device_id = u.searchParams.get('device_id') || '';
            user_unique_id = u.searchParams.get('user_unique_id') || '';
          } catch {}

          const base = (process.env.CENTER_NOTIFY_URL ?? '').replace(/\/notify$/, '');
          if (base) {
            fetch(`${base}/api/cookies`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                profile:   ctrl?.profile,
                task_id:   ctrl?.task_id,
                worker_id: process.env.WORKER_ID ?? '',
                pattern:   url,
                matched_url: request.url(),
                cookie,
                device_id,
                user_unique_id,
                user_agent: headers['user-agent'] || '',
                timestamp: Date.now(),
              }),
              signal: AbortSignal.timeout(5000),
            }).catch(err => logger.warn(`rtcookie 上报失败: ${err.message}`));
          }
        }
      }
    } finally {
      try {
        await route.continue();
      } catch (err) {
        if (!err.message?.includes('already handled')) throw err;
      }
    }
  };

  await page.route(pattern, handler);

  // 任务停止前若路由未触发，及时注销以防泄漏到下一个任务
  const stopPoller = setInterval(() => {
    if (captured || ctrl?.stopped) {
      clearInterval(stopPoller);
      if (!captured) page.unroute(pattern, handler).catch(() => {});
    }
  }, 500);
}

// 定位输入框并填入或逐字输入内容
// 风险缓解：delay 限制在 0–500ms；value 截断到 2000 字符；使用白名单选择器
async function fill(context, { string, value, mode = 'fill', delay = 50, clear = true }) {
  if (!string) throw new Error('fill: string（选择器）是必填项');
  if (typeof value !== 'string') throw new Error('fill: value 必须是字符串');

  const safeValue = value.slice(0, 2000);
  const safeDelay = clamp(Number(delay) || 0, 0, 500);

  const page = await getOrCreatePage(context);
  const locator = resolveLocator(page, string);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    logger.warn(`fill: "${string}" 在 5s 内未可见，已跳过`);
    return;
  }

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
}

// 通过 CDP 截取当前页面 JPEG 并上报到 gateway（二进制上传）
// 风险缓解：quality 限制 20–90；fullPage 默认 false；gateway 侧防路径穿越和磁盘耗尽
async function screenshot(context, { fullPage = false, quality = 60 }, ctrl) {
  const safeQuality = clamp(Number(quality) || 60, 20, 90);
  const page = await getOrCreatePage(context);

  let buffer;
  // CDP 直接截图：不等字体加载，直接抓当前帧
  try {
    const cdp = await context.newCDPSession(page);
    const { data } = await Promise.race([
      cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: safeQuality }),
      new Promise((_, r) => setTimeout(() => r(new Error('CDP 超时')), 10_000)),
    ]);
    buffer = Buffer.from(data, 'base64');
    await cdp.detach().catch(() => {});
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('closed') || msg.includes('destroyed')) return;
    logger.warn(`screenshot: 截图失败: ${msg.split('\n')[0]}`);
    return;
  }

  const base = (process.env.CENTER_NOTIFY_URL ?? '').replace(/\/notify$/, '');
  if (!base) return;

  fetch(`${base}/api/screenshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Task-Id':   String(ctrl?.task_id ?? ''),
      'X-Profile':   String(ctrl?.profile ?? ''),
      'X-Worker-Id': String(process.env.WORKER_ID ?? ''),
      'X-Timestamp': String(Date.now()),
    },
    body: buffer,
    signal: AbortSignal.timeout(15000),
  }).catch(err => logger.warn(`screenshot 上报失败: ${err.message}`));
}

// 悬停元素、停留指定时间后将鼠标移走
async function hoverCapture(context, { string, dwell = 1000, exit_x = 0, exit_y = 0 }) {
  if (!string) throw new Error('hover-capture: string（选择器）是必填项');

  const page = await getOrCreatePage(context);
  const locator = resolveLocator(page, string);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    logger.warn(`hover-capture: "${string}" 在 5s 内未可见，已跳过`);
    return;
  }

  await locator.hover();
  await new Promise(r => setTimeout(r, clamp(Number(dwell) || 1000, 0, 30_000)));
  await page.mouse.move(exit_x, exit_y).catch(() => {});
}

// 内部辅助：将拦截到的响应数据上报到 gateway
async function _reportCapture(ctrl, { pattern, matchedUrl, body }) {
  const base = (process.env.CENTER_NOTIFY_URL ?? '').replace(/\/notify$/, '');
  if (!base) return;
  fetch(`${base}/api/captures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile  : ctrl?.profile,
      task_id  : ctrl?.task_id,
      worker_id: process.env.WORKER_ID ?? '',
      pattern,
      matched_url: matchedUrl,
      data: body,
      timestamp: Date.now(),
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(err => logger.warn(`intercept 上报失败: ${err.message}`));
}

// 注册一次性响应监听器，匹配到 url 后上报数据到 gateway（立即返回，异步等待）
async function intercept(context, { url, timeout = 15000 }, ctrl) {
  if (!url || typeof url !== 'string') throw new Error('intercept: url（匹配模式）是必填项');

  const page = await getOrCreatePage(context);

  page.waitForResponse(
    r => r.url().includes(url),
    { timeout }
  ).then(async response => {
    const matchedUrl = response.url();
    let body;
    try { body = await response.json(); }
    catch { body = await response.text().catch(() => null); }
    await _reportCapture(ctrl, { pattern: url, matchedUrl, body });
  }).catch(err => {
    logger.warn(`intercept: "${url}" 在 ${timeout}ms 内无匹配: ${err.message}`);
  });
}

// 暂停第一个或全部匹配的 <video> 元素
async function pauseVideo(context, { selector = 'video', all = false, timeout = 10000 }) {
  const page = await getOrCreatePage(context);
  try {
    await page.waitForSelector(selector, { timeout: clamp(Number(timeout) || 10000, 1000, 30000) });
  } catch {
    logger.warn(`pause-video: 选择器 "${selector}" 在 ${timeout}ms 内未出现，已跳过`);
    return;
  }
  const result = await page.evaluate(({ sel, all }) => {
    const els = all ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)];
    let total = 0, paused = 0, already = 0;
    for (const v of els) {
      if (!v) continue;
      total++;
      if (v.paused) { already++; } else { v.pause(); paused++; }
    }
    return { total, paused, already };
  }, { sel: selector, all });
  if (result.already > 0 && result.paused === 0) {
    logger.info(`pause-video: 找到 ${result.total} 个元素，均已暂停`);
  } else {
    logger.info(`pause-video: 暂停了 ${result.paused}/${result.total} 个匹配 "${selector}" 的元素`);
  }
}

// 对匹配的 <video> 元素设置静音或取消静音
async function muteVideo(context, { selector = 'video', mute = true, all = false, timeout = 10000 }) {
  const page = await getOrCreatePage(context);
  try {
    await page.waitForSelector(selector, { timeout: clamp(Number(timeout) || 10000, 1000, 30000) });
  } catch {
    logger.warn(`mute-video: 选择器 "${selector}" 在 ${timeout}ms 内未出现，已跳过`);
    return;
  }
  const found = await page.evaluate(({ sel, mute, all }) => {
    const els = all ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)];
    let count = 0;
    for (const v of els) {
      if (v) { v.muted = mute; v.volume = mute ? 0 : 1; count++; }
    }
    return count;
  }, { sel: selector, mute, all });
  logger.info(`mute-video: ${mute ? '已静音' : '已取消静音'} ${found} 个匹配 "${selector}" 的元素`);
}

// 等待指定元素出现，超时可选择结束任务
async function waitFor(context, { string, timeout = 10000, stopOnTimeout = false }, ctrl) {
  if (!string) throw new Error('wait-for: string（选择器）是必填项');
  const page = await getOrCreatePage(context);
  const safeTimeout = clamp(Number(timeout) || 10000, 500, 120_000);
  const locator = resolveLocator(page, string);
  try {
    await locator.waitFor({ state: 'visible', timeout: safeTimeout });
  } catch {
    if (stopOnTimeout) {
      logger.warn(`wait-for: "${string}" 超时，结束任务`);
      ctrl?.stop();
    } else {
      logger.warn(`wait-for: "${string}" 超时，继续执行`);
    }
  }
}

// 注入可见性欺骗脚本并启动人类活动模拟循环，防止页面检测到后台状态
// 使用 context.addInitScript 确保导航后依然生效；活动循环每 30–60s 触发一次
async function antidetect(context) {
  const script = () => {
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(Document.prototype, 'hidden',          { get: () => false,     configurable: true });

    if (!window._antiPauseHumanHook) {
      const triggerNext = () => {
        const types = ['mousemove', 'keydown', 'wheel', 'click'];
        document.dispatchEvent(new Event(types[Math.floor(Math.random() * types.length)], { bubbles: true }));
        const delay = 30_000 + Math.floor(Math.random() * 30_000); // 30–60 秒
        window._antiPauseHumanHook = setTimeout(triggerNext, delay);
      };
      triggerNext();
    }
  };

  await context.addInitScript(script); // 未来的导航也会执行
  const page = await getOrCreatePage(context);
  try {
    await page.evaluate(script);       // 当前页面立即执行
  } catch (err) {
    logger.warn(`antidetect: evaluate 已跳过 (${err.message})`);
  }
}

// ─── 动作分发器 ──────────────────────────────────────────────────────────────

const ACTION_MAP = {
  navigate, open: navigate, goto: navigate, reload,
  wait, dwell,
  click, dblclick, hover, fill, scroll, mousemove, mousedown, mouseup,
  rtcookie, screenshot, antidetect,
  'pause-video': pauseVideo, 'mute-video': muteVideo, 'wait-for': waitFor,
  'hover-capture': hoverCapture,
  intercept,
  eval: evalAction, 'run-code': runCode,
  close,
};

// 执行 pipeline 中的单个步骤，根据 type 分发到对应动作函数
async function runStep(context, step, ctrl) {
  if (!step || typeof step !== 'object') {
    throw new Error(`runStep: 无效的步骤 "${JSON.stringify(step)}"`);
  }
  const { type, ...params } = step;
  if (!type) throw new Error('runStep: 步骤缺少 "type" 字段');
  const fn = ACTION_MAP[type];
  if (!fn) throw new Error(`runStep: 未知的动作类型 "${type}"`);
  await fn(context, params, ctrl);
}

module.exports = { runStep };
