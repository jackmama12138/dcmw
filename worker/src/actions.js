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

async function navigate(context, { url, waitUntil = 'commit' }) {
  if (!url || typeof url !== 'string') {
    throw new Error(`navigate: invalid url "${url}"`);
  }

  const VALID_WAIT_UNTIL = ['commit', 'load', 'domcontentloaded', 'networkidle'];
  const safeWaitUntil = VALID_WAIT_UNTIL.includes(waitUntil) ? waitUntil : 'commit';

  const page = await getOrCreatePage(context);
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

// ─── dispatcher ──────────────────────────────────────────────────────────────

const ACTION_MAP = { navigate, wait, click, scroll, close, dwell };

async function runStep(context, step, ctrl) {
  if (!step || typeof step !== 'object') {
    throw new Error(`runStep: invalid step "${JSON.stringify(step)}"`);
  }
  const { type, ...params } = step;
  if (!type) throw new Error('runStep: step is missing "type"');

  const fn = ACTION_MAP[type];
  if (!fn) throw new Error(`runStep: unknown action type "${type}"`);

  await fn(context, params, ctrl);
}

module.exports = { runStep };
