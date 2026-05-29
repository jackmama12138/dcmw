const logger = require('./logger');

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getOrCreatePage(context) {
  const pages = context.pages();
  return pages.length > 0 ? pages[0] : context.newPage();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

// Whitelisted getBy* methods — anything outside this set is rejected
const GETBY_METHODS = new Set([
  'getByText','getByRole','getByLabel','getByPlaceholder',
  'getByAltText','getByTestId','getByTitle',
]);

// Patterns that have no place in getBy* argument strings
const DANGEROUS_ARGS = /\b(require|import|process|global|eval|Function|setTimeout|setInterval|constructor|__proto__|prototype)\b/;

function resolveLocator(page, selectorOrExpr) {
  const expr = selectorOrExpr.trim();
  const getByMatch = expr.match(/^(getBy\w+)\((.+)\)$/s);
  if (!getByMatch) return page.locator(expr);

  const [, method, rawArgs] = getByMatch;

  if (!GETBY_METHODS.has(method)) {
    throw new Error(`resolveLocator: unknown method "${method}"`);
  }
  if (DANGEROUS_ARGS.test(rawArgs)) {
    throw new Error(`resolveLocator: forbidden content in args for "${method}"`);
  }

  let args;
  try {
    // "use strict" prevents access to caller/arguments; combined with the denylist above
    // this limits execution to string/number/boolean/object literals.
    // eslint-disable-next-line no-new-func
    args = new Function('"use strict"; return [' + rawArgs + ']')();
  } catch {
    throw new Error(`resolveLocator: failed to parse args for "${expr}"`);
  }

  // Validate each arg is a primitive or plain object — no functions, no class instances
  for (const arg of args) {
    const t = typeof arg;
    if (t === 'function' || (t === 'object' && arg !== null && Object.getPrototypeOf(arg) !== Object.prototype)) {
      throw new Error(`resolveLocator: unsupported arg type in "${expr}"`);
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
    default: throw new Error(`resolveLocator: unsupported method "${method}"`);
  }
}

// ─── actions ─────────────────────────────────────────────────────────────────

// open / navigate / goto — all navigate the current (or new) page to a URL
async function navigate(context, { url, waitUntil = 'commit' }) {
  if (!url || typeof url !== 'string') throw new Error(`navigate: invalid url "${url}"`);
  const VALID = ['commit', 'load', 'domcontentloaded', 'networkidle'];
  const safeWait = VALID.includes(waitUntil) ? waitUntil : 'commit';
  const page = await getOrCreatePage(context);
  await page.goto(url, { waitUntil: safeWait, timeout: 30_000 });
  return page;
}

async function reload(context) {
  const page = await getOrCreatePage(context);
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    logger.warn(`reload: ${err.message}`);
  }
}

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

async function _resolveElement(page, params, actionName) {
  // Accepts { selector } (CSS) or { string } (getBy* expression)
  const expr = params.string ?? params.selector;
  if (!expr || typeof expr !== 'string') {
    throw new Error(`${actionName}: selector or string is required`);
  }
  const timeout = clamp(params.timeout ?? 5000, 500, 15_000);
  const locator = resolveLocator(page, expr);
  try {
    await locator.waitFor({ state: 'visible', timeout });
  } catch {
    logger.warn(`${actionName}: "${expr}" not visible within ${timeout}ms, skipping`);
    return null;
  }
  return locator;
}

async function _humanClick(page, locator, dblClick = false) {
  let box;
  try {
    box = await locator.boundingBox();
  } catch {
    box = null;
  }
  if (!box) {
    logger.warn('click: element has no bounding box (hidden?), skipping');
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

async function click(context, params) {
  const page = await getOrCreatePage(context);
  const locator = await _resolveElement(page, params, 'click');
  if (!locator) return;
  await _humanClick(page, locator, false);
}

async function dblclick(context, params) {
  const page = await getOrCreatePage(context);
  const locator = await _resolveElement(page, params, 'dblclick');
  if (!locator) return;
  await _humanClick(page, locator, true);
}

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

async function mousemove(context, { x, y }) {
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('mousemove: x and y (number) are required');
  }
  const page = await getOrCreatePage(context);
  await page.mouse.move(x, y);
}

async function mousedown(context, { button = 'left' }) {
  const VALID_BUTTONS = ['left', 'middle', 'right'];
  const safeButton = VALID_BUTTONS.includes(button) ? button : 'left';
  const page = await getOrCreatePage(context);
  await page.mouse.down({ button: safeButton });
}

async function mouseup(context, { button = 'left' }) {
  const VALID_BUTTONS = ['left', 'middle', 'right'];
  const safeButton = VALID_BUTTONS.includes(button) ? button : 'left';
  const page = await getOrCreatePage(context);
  await page.mouse.up({ button: safeButton });
}

// eval: execute arbitrary JS in the page context
// { code: "document.title" } or { code: "() => { ... }" }
async function evalAction(context, { code }) {
  if (!code || typeof code !== 'string') throw new Error('eval: code (string) is required');
  const page = await getOrCreatePage(context);
  try {
    // Pass code as a string so it executes entirely in the browser context,
    // never touching Node.js globals like process/require.
    const result = await page.evaluate(code);
    logger.info(`eval result: ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    logger.warn(`eval error: ${err.message}`);
  }
}

// run-code: execute a Playwright snippet that receives { page, context }
// { code: "async ({ page }) => { await page.click('button') }" }
async function runCode(context, { code }) {
  if (!code || typeof code !== 'string') throw new Error('run-code: code (string) is required');
  const page = await getOrCreatePage(context);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${code})`)();
    await fn({ page, context });
  } catch (err) {
    logger.warn(`run-code error: ${err.message}`);
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

// rtcookie: intercept first matching request, extract cookie, POST to gateway once
async function rtcookie(context, { url }, ctrl) {
  if (!url || typeof url !== 'string') throw new Error('rtcookie: url is required');

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

          // Extract query params from the matched URL
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
                profile: ctrl?.profile,
                task_id: ctrl?.task_id,
                pattern: url,
                matched_url: request.url(),
                cookie,
                device_id,
                user_unique_id,
                user_agent: headers['user-agent'] || '',
                timestamp: Date.now(),
              }),
              signal: AbortSignal.timeout(5000),
            }).catch(err => logger.warn(`rtcookie report: ${err.message}`));
          }
        }
      }
    } finally {
      await route.continue();
    }
  };

  await page.route(pattern, handler);
}

// ─── dispatcher ──────────────────────────────────────────────────────────────

const ACTION_MAP = {
  navigate, open: navigate, goto: navigate, reload,
  wait, dwell,
  click, dblclick, hover, scroll, mousemove, mousedown, mouseup,
  rtcookie,
  eval: evalAction, 'run-code': runCode,
  close,
};

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
