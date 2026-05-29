const logger = require('./logger');

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getOrCreatePage(context) {
  const pages = context.pages();
  return pages.length > 0 ? pages[0] : context.newPage();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Simulate a human-like curved mouse path between two points
async function humanMouseMove(page, fromX, fromY, toX, toY) {
  const steps = 8 + Math.floor(Math.random() * 6);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // quadratic bezier control point with slight random offset
    const cx = (fromX + toX) / 2 + (Math.random() - 0.5) * 40;
    const cy = (fromY + toY) / 2 + (Math.random() - 0.5) * 40;
    const x = (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * cx + t * t * toX;
    const y = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * cy + t * t * toY;
    await page.mouse.move(x, y);
  }
}

// ─── actions ─────────────────────────────────────────────────────────────────

// async function navigate(context, { url, waitUntil = 'commit' }) {
//   if (!url || typeof url !== 'string') {
//     throw new Error(`navigate: invalid url "${url}"`);
//   }
//
//   const VALID_WAIT_UNTIL = ['commit', 'load', 'domcontentloaded', 'networkidle'];
//   const safeWaitUntil = VALID_WAIT_UNTIL.includes(waitUntil) ? waitUntil : 'commit';
//
//   const page = await getOrCreatePage(context);
//   await page.goto(url, { waitUntil: safeWaitUntil, timeout: 30_000 });
//   return page;
// }
async function navigate(context, { url, waitUntil = 'commit' }) {
  if (!url || typeof url !== 'string') {
    throw new Error(`Maps: invalid url "${url}"`);
  }
  const VALID_WAIT_UNTIL = ['commit', 'load', 'domcontentloaded', 'networkidle'];
  const safeWaitUntil = VALID_WAIT_UNTIL.includes(waitUntil) ? waitUntil : 'commit';

  const page = await getOrCreatePage(context);

  // ✨✨✨ 注入终极防挂机与反探测沙箱（刷新、最小化通通免疫）
  await page.addInitScript(() => {
    // 1. 降维打击：伪造永久前台状态，欺骗浏览器的各种隐藏检测
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });

    // 2. 拟人活性事件循环
    if (!window._antiPauseHumanHook) {
      const triggerNext = () => {
        const events = ['mousemove', 'keydown', 'wheel', 'click'];
        const randomEvt = events[Math.floor(Math.random() * events.length)];
        const event = new Event(randomEvt, { bubbles: true });
        document.dispatchEvent(event);

        console.log(`🛡️ [自动化防护] 已伪造永久前台并模拟了事件: ${randomEvt}`);

        const nextDelay = 10000 + Math.floor(Math.random() * 20000);
        window._antiPauseHumanHook = setTimeout(triggerNext, nextDelay);
      };
      triggerNext();
    }
  });

  await page.goto(url, { waitUntil: safeWaitUntil, timeout: 30_000 });
  return page;
}

async function wait(_context, { min = 1000, max = 3000 }, ctrl) {
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

// Hang on the current page for ctrl.task_time seconds.
// Exits early if ctrl.stopped is set or task_time is adjusted to a value
// that has already elapsed.
async function dwell(_context, _params, ctrl) {
  const start = Date.now();
  await new Promise(resolve => {
    const tick = () => {
      if (!ctrl || ctrl.stopped) return resolve();
      const elapsed = (Date.now() - start) / 1000;
      if (elapsed >= ctrl.task_time) return resolve();
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function click(context, { selector, timeout = 5000 }) {
  if (!selector || typeof selector !== 'string') {
    throw new Error('click: selector is required');
  }

  const page = await getOrCreatePage(context);

  let el;
  try {
    el = await page.waitForSelector(selector, { timeout: clamp(timeout, 500, 15_000) });
  } catch {
    logger.warn(`click: selector "${selector}" not found within ${timeout}ms, skipping`);
    return;
  }

  const box = await el.boundingBox();
  if (!box) {
    logger.warn(`click: selector "${selector}" has no bounding box (hidden?), skipping`);
    return;
  }

  // Target center with small random jitter
  const toX = box.x + box.width / 2 + (Math.random() - 0.5) * 4;
  const toY = box.y + box.height / 2 + (Math.random() - 0.5) * 4;

  const viewportSize = page.viewportSize() ?? { width: 1280, height: 720 };
  const fromX = Math.random() * viewportSize.width;
  const fromY = Math.random() * viewportSize.height;

  await humanMouseMove(page, fromX, fromY, toX, toY);

  // Small pre-click pause
  await new Promise(r => setTimeout(r, 80 + Math.floor(Math.random() * 120)));
  await page.mouse.click(toX, toY);
}

async function scroll(context, { x = 0, y = 300, selector = null }) {
  const page = await getOrCreatePage(context);

  if (selector) {
    const el = await page.$(selector);
    if (!el) {
      logger.warn(`scroll: selector "${selector}" not found, skipping`);
      return;
    }
    await el.evaluate((node, { x, y }) => node.scrollBy(x, y), { x, y });
  } else {
    await page.mouse.wheel(x, y);
  }
}

async function close(context) {
  if (!context) return;
  try {
    const pages = context.pages();
    await Promise.allSettled(pages.map(p => p.close()));
    await context.close();
  } catch (err) {
    logger.warn(`close: ${err.message}`);
  }
}

// actions.js
async function waitForRequest(context, { urlKeyword, timeout = 10000 }) {
  if (!urlKeyword || typeof urlKeyword !== 'string') {
    throw new Error('waitForRequest: urlKeyword 是必须的');
  }

  // ✨ 强行修复：不管前端传过来的是字符串 "15000" 还是数字 15000，通通扒光变成纯数字
  const safeTimeout = clamp(Number(timeout) || 10000, 1000, 60000);

  const page = await getOrCreatePage(context);
  console.log(`⏱️  正在等待包含关键字 "${urlKeyword}" 的请求，超时限制: ${safeTimeout}ms...`);

  try {
    const matchedRequest = await page.waitForRequest(
        req => req.url().includes(urlKeyword),
        { timeout: safeTimeout } // ✨ 使用处理后绝对安全的数字
    );
    console.log(`✅ [检测成功] 目标网络请求已出现: ${matchedRequest.url()}`);
    return matchedRequest.url();

  } catch (err) {
    console.warn(`❌ [检测超时] 未检测到包含 "${urlKeyword}" 的请求`);
    return null;
  }
}

// ─── 新增功能 1：动态 JS 注入 ─────────────────────────────────────────────────
// actions.js 内部的 injectJS 函数修改为：
async function injectJS(context, { script, arg = null }) {
  if (!script || typeof script !== 'string') {
    throw new Error('injectJS: script 代码内容是必须的');
  }
  const page = await getOrCreatePage(context);
  console.log(`💉 正在向网页注入并执行自定义 JavaScript 代码...`);

  try {
    // ✨ 核心修改：将参数打包成一个匿名对象 { payloadScript, payloadArg } 传进去
    const result = await page.evaluate(({ payloadScript, payloadArg }) => {
      // 在浏览器内部解包执行
      const fn = new Function('arg', payloadScript);
      return fn(payloadArg);
    }, { payloadScript: script, payloadArg: arg }); // ✨ 包装成单对象传递

    console.log(`✅ [注入成功] 执行结果:`, result);
    return result !== undefined ? JSON.stringify(result) : "执行成功(无返回值)";
  } catch (err) {
    console.warn(`❌ [注入失败] 代码执行崩溃: ${err.message}`);
    return `❌ 注入失败: ${err.message}`;
  }
}

// ─── 新增功能 2：检测并控制视频暂停 ───────────────────────────────────────────
async function controlVideo(context, { actionType = 'pause' }) {
  const page = await getOrCreatePage(context);
  console.log(`🎬 正在尝试在网页中检测并 [${actionType}] 视频 (Video)...`);

  try {
    // 在网页内检测是否存在 video 标签并操控它
    const result = await page.evaluate((type) => {
      const videos = document.querySelectorAll('video');
      if (videos.length === 0) return { success: false, msg: '未在页面上找到任何 <video> 标签' };

      let count = 0;
      videos.forEach(v => {
        if (type === 'pause') {
          v.pause(); // 强行暂停
        } else if (type === 'play') {
          v.play().catch(()=>{}); // 强行播放
        }
        count++;
      });

      return { success: true, msg: `成功检测到 ${count} 个视频，并强行触发了 [${type}]` };
    }, actionType);

    console.log(`🎬 [视频控制结果]: ${result.msg}`);
    return JSON.stringify(result);
  } catch (err) {
    console.warn(`❌ [视频控制异常]: ${err.message}`);
    return `❌ 视频控制失败: ${err.message}`;
  }
}

// ─── dispatcher ──────────────────────────────────────────────────────────────

const ACTION_MAP = { navigate, wait, click, scroll, close, dwell , waitForRequest, injectJS, controlVideo};

async function runStep(context, step, ctrl) {
  if (!step || typeof step !== 'object') {
    throw new Error(`runStep: invalid step "${JSON.stringify(step)}"`);
  }
  const { type, ...params } = step;
  if (!type) throw new Error('runStep: step is missing "type"');

  const fn = ACTION_MAP[type];
  if (!fn) throw new Error(`runStep: unknown action type "${type}"`);

  console.log(context,"params:",params,"ctrl",ctrl)
  return await fn(context, params, ctrl);
}

module.exports = { runStep };
