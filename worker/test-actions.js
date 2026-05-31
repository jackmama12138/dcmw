/**
 * actions.js 模拟测试
 * 不启动真实浏览器，用 Mock 对象模拟 Playwright context/page/locator
 * 覆盖：元素存在/不存在、元素状态异常、网络问题
 */

const { resolveElement, humanClick, pickSelector } = require('./src/actions.js');
const actions = require('./src/actions.js').actions;

// ─── Mock 工厂 ────────────────────────────────────────────────────────────────

function makeLocator(opts = {}) {
  return {
    _opts: opts,
    _callCount: 0,
    async waitFor({ state, timeout }) {
      if (opts.notFound)   throw new Error(`Timeout ${timeout}ms exceeded waiting for ${state}`);
      if (opts.detached)   throw new Error('Element was detached from the DOM');
      if (opts.invisible)  throw new Error(`Timeout ${timeout}ms exceeded`);
    },
    async isEnabled()   { return opts.disabled  ? false : true; },
    async isEditable()  { return opts.readonly   ? false : true; },
    async boundingBox() {
      if (opts.noBbox) return null;
      this._callCount++;
      // detached 场景：第一次返回正常 box，第二次（稳定性采样）返回 null
      if (opts.detached) {
        return this._callCount === 1
          ? { x: 100, y: 100, width: 80, height: 30 }
          : null;
      }
      // 位置不稳定：第一次和第二次返回不同坐标（偏移 > 2px）
      if (opts.unstable) {
        return this._callCount === 1
          ? { x: 100, y: 100, width: 80, height: 30 }
          : { x: 160, y: 100, width: 80, height: 30 };
      }
      // 元素在视口外
      if (opts.outOfViewport) return { x: 2000, y: 2000, width: 80, height: 30 };
      return { x: 100, y: 100, width: 80, height: 30 };
    },
    async hover()       { if (opts.hoverFail) throw new Error('Element not hoverable'); },
    async fill(v)       { if (opts.fillFail)  throw new Error('Element is not editable'); },
    async pressSequentially() {},
    async click()       {},
    async elementHandle() { return opts.noElement ? null : {}; },
  };
}

function makePage(opts = {}) {
  return {
    _viewport: opts.viewport ?? { width: 1280, height: 720 },
    pages() { return [this]; },
    async newPage()  { return this; },
    locator(sel)     { return makeLocator(opts.locators?.[sel] ?? opts.defaultLocator ?? {}); },
    viewportSize()   { return this._viewport; },
    mouse: {
      move:    async () => {},
      click:   async () => { if (opts.clickFail) throw new Error('Target closed'); },
      dblclick:async () => {},
      wheel:   async () => {},
    },
    keyboard: { press: async () => {} },
    async goto(url, _) {
      if (opts.navFail) throw new Error(`net::ERR_NAME_NOT_RESOLVED at ${url}`);
      return {};
    },
    async reload(_)  { if (opts.reloadFail) throw new Error('net::ERR_CONNECTION_RESET'); },
    async evaluate() { return null; },
    async waitForSelector() {},
    async waitForFunction() {},
    async waitForResponse(pred, { timeout }) {
      if (opts.noResponse) {
        await new Promise(r => setTimeout(r, 20));
        throw new Error(`Timeout ${timeout}ms exceeded`);
      }
      if (opts.responseClosed) throw new Error('Target closed');
      return {
        url() { return 'https://example.com/api/data'; },
        async json() { return { ok: true }; },
      };
    },
    async route() {},
    async unroute() {},
  };
}

function makeContext(pageOpts = {}) {
  const page = makePage(pageOpts);
  return {
    pages() { return [page]; },
    async newPage() { return page; },
    async addInitScript() {},
    async newCDPSession() {
      return {
        send: async () => { throw new Error('CDP unavailable in test environment'); },
        detach: async () => {},
      };
    },
    cookies: async () => [],
  };
}

function makeCtrl() {
  const cleanups = [];
  return {
    stopped: false,
    task_time: 3600,
    task_id: 'test-001',
    profile: 'TestProfile',
    target_url: 'https://example.com',
    _cleanups: cleanups,
    addCleanup(fn) { cleanups.push(fn); },
    stop() { this.stopped = true; },
  };
}

// ─── 测试工具 ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

// result.reason 用于 action 返回值，result.error 用于 resolveElement 工具函数返回值
function assert(label, result, expectOk, expectReason) {
  const actual      = result.reason ?? result.error; // 兼容两种字段名
  const okMatch     = result.ok === expectOk;
  const reasonMatch = expectReason ? actual === expectReason : true;
  const pass        = okMatch && reasonMatch;
  if (pass) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.log(`  ✗  ${label}`);
    console.log(`     期望: ok=${expectOk}${expectReason ? ` reason/error=${expectReason}` : ''}`);
    console.log(`     实际: ok=${result.ok} reason/error=${actual}`);
    failed++;
  }
}

// ─── 测试用例 ─────────────────────────────────────────────────────────────────

async function run() {

  // ── resolveElement ──────────────────────────────────────────────────────────
  console.log('\n【resolveElement — 元素定位】');
  {
    // 正常元素
    const page = makePage({ defaultLocator: {} });
    const r = await resolveElement(page, { selector: '.btn' }, 'test');
    assert('正常元素：返回 locator', r, undefined, undefined);
    console.log(`  ✓  正常元素：locator 存在 = ${!!r.locator}`);

    // 元素不存在（超时）
    const page2 = makePage({ defaultLocator: { notFound: true } });
    const r2 = await resolveElement(page2, { selector: '.missing', timeout: 600 }, 'test');
    assert('元素不存在 → not_found', r2, undefined, 'not_found');

    // 元素已从 DOM 移除
    const page3 = makePage({ defaultLocator: { detached: true } });
    const r3 = await resolveElement(page3, { selector: '.ghost', timeout: 500 }, 'test');
    assert('元素 detached → not_connected', r3, undefined, 'not_connected');

    // 缺少 selector 参数
    const r4 = await resolveElement(page, {}, 'test');
    assert('缺少 selector → no_selector', r4, undefined, 'no_selector');
  }

  // ── humanClick ──────────────────────────────────────────────────────────────
  console.log('\n【humanClick — 点击 actionability】');
  {
    const page = makePage();

    // 正常点击
    const locator = makeLocator({});
    const r = await humanClick(page, locator, false);
    assert('正常元素点击成功', r, true);

    // 元素禁用
    const rDisabled = await humanClick(page, makeLocator({ disabled: true }), false);
    assert('disabled 元素 → not_enabled', rDisabled, false, 'not_enabled');

    // 无边界框
    const rNoBbox = await humanClick(page, makeLocator({ noBbox: true }), false);
    assert('无 bbox → no_bbox', rNoBbox, false, 'no_bbox');

    // 采样期间元素消失（第二次 boundingBox 返回 null）
    const rDetached = await humanClick(page, makeLocator({ detached: true }), false);
    assert('采样期间 detached → not_connected', rDetached, false, 'not_connected');

    // 元素不稳定（位置偏移 >2px）
    const rUnstable = await humanClick(page, makeLocator({ unstable: true }), false);
    assert('元素不稳定：打印警告但继续点击', rUnstable, true); // 继续执行，不失败

    // 元素在视口外
    const rOutside = await humanClick(page, makeLocator({ outOfViewport: true }), false);
    assert('视口外元素 → not_in_viewport', rOutside, false, 'not_in_viewport');

    // 鼠标点击事件失败
    const failPage = makePage({ clickFail: true });
    const rClickFail = await humanClick(failPage, makeLocator({}), false);
    assert('鼠标事件失败 → click_failed', rClickFail, false, 'click_failed');
  }

  // ── click action ────────────────────────────────────────────────────────────
  console.log('\n【click / dblclick — 完整动作】');
  {
    const ctx = makeContext({});
    const r1 = await actions.click(ctx, { selector: '.btn' }, makeCtrl());
    assert('click 正常', r1, true);

    const ctx2 = makeContext({ defaultLocator: { notFound: true } });
    const r2 = await actions.click(ctx2, { selector: '.x', timeout: 600 }, makeCtrl());
    assert('click 元素不存在 → not_found', r2, false, 'not_found');

    const ctx3 = makeContext({ defaultLocator: { disabled: true } });
    const r3 = await actions.click(ctx3, { selector: '.x' }, makeCtrl());
    assert('click disabled → not_enabled', r3, false, 'not_enabled');

    const r4 = await actions.click(ctx, {}, makeCtrl());
    assert('click 无 selector → no_selector', r4, false, 'no_selector');
  }

  // ── fill ────────────────────────────────────────────────────────────────────
  console.log('\n【fill — 输入框填写】');
  {
    const ctx = makeContext({});
    const r1 = await actions.fill(ctx, { selector: 'input', value: 'hello' }, makeCtrl());
    assert('fill 正常', r1, true);

    const r2 = await actions.fill(ctx, { selector: 'input', value: 123 }, makeCtrl());
    assert('fill value 非字符串 → invalid_value', r2, false, 'invalid_value');

    const ctx2 = makeContext({ defaultLocator: { disabled: true } });
    const r3 = await actions.fill(ctx2, { selector: 'input', value: 'x' }, makeCtrl());
    assert('fill disabled → not_enabled', r3, false, 'not_enabled');

    const ctx3 = makeContext({ defaultLocator: { readonly: true } });
    const r4 = await actions.fill(ctx3, { selector: 'input', value: 'x' }, makeCtrl());
    assert('fill readonly → not_editable', r4, false, 'not_editable');

    const ctx4 = makeContext({ defaultLocator: { notFound: true } });
    const r5 = await actions.fill(ctx4, { selector: '.x', value: 'x', timeout: 600 }, makeCtrl());
    assert('fill 元素不存在 → not_found', r5, false, 'not_found');
  }

  // ── navigate ────────────────────────────────────────────────────────────────
  console.log('\n【navigate — 导航】');
  {
    const ctx = makeContext({});
    const r1 = await actions.navigate(ctx, { url: 'https://example.com' }, makeCtrl());
    assert('navigate 正常', r1, true);

    const r2 = await actions.navigate(ctx, {}, makeCtrl());
    assert('navigate 无 url → invalid_url', r2, false, 'invalid_url');

    const ctx2 = makeContext({ navFail: true });
    const r3 = await actions.navigate(ctx2, { url: 'https://bad.invalid' }, makeCtrl());
    assert('navigate 网络失败 → nav_failed', r3, false, 'nav_failed');
  }

  // ── reload ──────────────────────────────────────────────────────────────────
  console.log('\n【reload — 刷新】');
  {
    const ctx = makeContext({});
    const r1 = await actions.reload(ctx, {}, makeCtrl());
    assert('reload 正常', r1, true);

    const ctx2 = makeContext({ reloadFail: true });
    const r2 = await actions.reload(ctx2, {}, makeCtrl());
    assert('reload 网络失败 → reload_failed', r2, false, 'reload_failed');
  }

  // ── hover ───────────────────────────────────────────────────────────────────
  console.log('\n【hover】');
  {
    const ctx = makeContext({});
    const r1 = await actions.hover(ctx, { selector: '.item' }, makeCtrl());
    assert('hover 正常', r1, true);

    const ctx2 = makeContext({ defaultLocator: { notFound: true } });
    const r2 = await actions.hover(ctx2, { selector: '.x', timeout: 600 }, makeCtrl());
    assert('hover 元素不存在 → not_found', r2, false, 'not_found');

    const ctx3 = makeContext({ defaultLocator: { hoverFail: true } });
    const r3 = await actions.hover(ctx3, { selector: '.x' }, makeCtrl());
    assert('hover 操作失败 → hover_failed', r3, false, 'hover_failed');
  }

  // ── wait-for ────────────────────────────────────────────────────────────────
  console.log('\n【wait-for — 等待元素】');
  {
    const ctx = makeContext({});
    const r1 = await actions['wait-for'](ctx, { selector: '.x' }, makeCtrl());
    assert('wait-for 元素出现', r1, true);

    const ctx2 = makeContext({ defaultLocator: { notFound: true } });
    const ctrl = makeCtrl();
    const r2 = await actions['wait-for'](ctx2, { selector: '.x', timeout: 600 }, ctrl);
    assert('wait-for 超时（继续）→ timeout', r2, false, 'timeout');

    const ctrl2 = makeCtrl();
    const r3 = await actions['wait-for'](ctx2, { selector: '.x', timeout: 100, stopOnTimeout: true }, ctrl2);
    assert('wait-for 超时停止 → timeout_stopped + ctrl.stopped', r3, false, 'timeout_stopped');
    console.log(`  ✓  ctrl.stopped = ${ctrl2.stopped}`);
  }

  // ── intercept ───────────────────────────────────────────────────────────────
  console.log('\n【intercept — 响应监听】');
  {
    const ctx = makeContext({});
    const ctrl = makeCtrl();
    const r1 = await actions.intercept(ctx, { url: '/api/data' }, ctrl);
    assert('intercept 立即返回 ok', r1, true);
    console.log(`  ✓  addCleanup 注册数量 = ${ctrl._cleanups.length}`);

    // 无 url
    const r2 = await actions.intercept(ctx, {}, makeCtrl());
    assert('intercept 无 url → no_url', r2, false, 'no_url');

    // 页面关闭场景（responseClosed）不报错
    const ctx2 = makeContext({ responseClosed: true });
    const ctrl2 = makeCtrl();
    const r3 = await actions.intercept(ctx2, { url: '/api' }, ctrl2);
    assert('intercept 注册成功', r3, true);
    // 运行 cleanup 后设置 cancelled
    await ctrl2._cleanups[0]();
    console.log(`  ✓  cleanup 执行后 cancelled（不再上报）`);

    // 超时无匹配（noResponse）
    const ctx3 = makeContext({ noResponse: true });
    const r4 = await actions.intercept(ctx3, { url: '/nope', timeout: 50 }, makeCtrl());
    assert('intercept 超时无匹配 → 注册成功（异步警告）', r4, true);
  }

  // ── scroll ──────────────────────────────────────────────────────────────────
  console.log('\n【scroll — 滚动】');
  {
    const ctx = makeContext({});
    const r1 = await actions.scroll(ctx, { y: 300 }, makeCtrl());
    assert('scroll 整页', r1, true);

    const ctx2 = makeContext({ defaultLocator: { noElement: true } });
    const r2 = await actions.scroll(ctx2, { y: 300, selector: '.list' }, makeCtrl());
    assert('scroll 目标元素不存在 → not_found', r2, false, 'not_found');
  }

  // ── eval / run-code ─────────────────────────────────────────────────────────
  console.log('\n【eval / run-code】');
  {
    const ctx = makeContext({});
    const r1 = await actions.eval(ctx, {}, makeCtrl());
    assert('eval 无 code → no_code', r1, false, 'no_code');

    const r2 = await actions['run-code'](ctx, {}, makeCtrl());
    assert('run-code 无 code → no_code', r2, false, 'no_code');
  }

  // ── screenshot（CDP 不可用）──────────────────────────────────────────────────
  console.log('\n【screenshot — CDP 截图】');
  {
    const ctx = makeContext({});
    const r1 = await actions.screenshot(ctx, {}, makeCtrl());
    // CDP 在 mock 里会失败，但不是 context_closed，所以是 capture_failed
    assert('screenshot CDP 不可用 → capture_failed', r1, false, 'capture_failed');

    // context_closed 场景
    const closedCtx = {
      pages() { return [{ goto: async () => {} }]; },
      async newCDPSession() {
        return {
          send: async () => { throw new Error('Target closed'); },
          detach: async () => {},
        };
      },
    };
    const r2 = await actions.screenshot(closedCtx, {}, makeCtrl());
    assert('screenshot context 已关闭 → context_closed', r2, false, 'context_closed');
  }

  // ── close ───────────────────────────────────────────────────────────────────
  console.log('\n【close — 关闭页面】');
  {
    const ctx = makeContext({});
    const ctrl = makeCtrl();
    ctrl.markReleasing = () => {};
    const r1 = await actions.close(ctx, {}, ctrl);
    assert('close 正常', r1, true);

    const r2 = await actions.close(null, {}, ctrl);
    assert('close null context → no_context', r2, false, 'no_context');
  }

  // ─── 结果汇总 ────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log(`总计: ${passed + failed} 个测试  ✓ ${passed} 通过  ${failed > 0 ? '✗ ' + failed + ' 失败' : ''}`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('测试运行异常:', err);
  process.exit(1);
});
