#!/usr/bin/env node
/**
 * playwright-cli 选择器查找工具
 *
 * 用法：
 *   node index.js <url>                       - 启动新浏览器，导航到 url
 *   node index.js --cdp <endpoint> [url]      - 连接已有 Chrome（如 Worker 的 --remote-debugging-port）
 *
 * 交互：
 *   输入文字过滤  /  上下箭头选择  /  Enter 输出 selector  /  Ctrl+C 退出
 */

'use strict';

const { chromium } = require('playwright');
const readline     = require('readline');

// ─── CLI 参数解析 ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let cdpEndpoint  = null;
let targetUrl    = null;
let userDataDir  = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cdp') {
    cdpEndpoint = args[++i];
  } else if (args[i] === '--user-data-dir') {
    userDataDir = args[++i];
  } else if (!args[i].startsWith('--')) {
    targetUrl = args[i];
  }
}

if (!cdpEndpoint && !targetUrl) {
  console.log('用法：');
  console.log('  node index.js <url>                              启动新浏览器');
  console.log('  node index.js <url> --user-data-dir <path>       指定 Chrome 用户目录');
  console.log('  node index.js --cdp <endpoint> [url]             连接已有 Chrome');
  console.log('  node index.js --cdp http://localhost:9222');
  process.exit(0);
}

// ─── 元素提取 ─────────────────────────────────────────────────────────────────

// 从 accessibility snapshot 树中递归提取所有有名称的节点
function walkSnapshot(node, results = []) {
  if (!node) return results;

  const { role, name, children } = node;

  if (name && name.trim()) {
    results.push({ role: role || 'generic', name: name.trim() });
  }

  if (Array.isArray(children)) {
    for (const child of children) walkSnapshot(child, results);
  }

  return results;
}

// 根据 role + name 生成最优 selector 字符串（供 actions.js 使用）
function buildSelector(role, name) {
  const escaped = name.replace(/'/g, "\\'");
  const truncated = name.length > 60 ? name.slice(0, 60) + '…' : name;
  const escapedT  = truncated.replace(/'/g, "\\'");

  switch (role) {
    case 'button':
      return `getByRole('button', { name: '${escapedT}' })`;
    case 'link':
      return `getByRole('link', { name: '${escapedT}' })`;
    case 'textbox':
    case 'searchbox':
      return `getByRole('${role}', { name: '${escapedT}' })`;
    case 'combobox':
      return `getByRole('combobox', { name: '${escapedT}' })`;
    case 'checkbox':
      return `getByRole('checkbox', { name: '${escapedT}' })`;
    case 'radio':
      return `getByRole('radio', { name: '${escapedT}' })`;
    case 'tab':
      return `getByRole('tab', { name: '${escapedT}' })`;
    case 'menuitem':
      return `getByRole('menuitem', { name: '${escapedT}' })`;
    case 'img':
      return `getByAltText('${escapedT}')`;
    default:
      return `getByText('${escapedT}')`;
  }
}

// 从页面提取元素，返回 [{ role, name, selector, label }]
async function extractElements(page) {
  // 1. Accessibility snapshot（interestingOnly: false 获取完整树）
  let snapNodes = [];
  try {
    const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
    snapNodes = walkSnapshot(snapshot);
  } catch (err) {
    process.stderr.write(`[warn] accessibility.snapshot 失败: ${err.message}\n`);
  }

  // 2. DOM 查询：补充 placeholder / data-testid / id / CSS class
  let domNodes = [];
  try {
    domNodes = await page.$$eval(
      'a, button, input, textarea, select, [role], [data-testid], [placeholder]',
      els => els.map(el => {
        const rect = el.getBoundingClientRect();
        // 过滤不可见元素
        if (rect.width === 0 && rect.height === 0) return null;

        const tag  = el.tagName.toLowerCase();
        const ph   = el.getAttribute('placeholder');
        const tid  = el.getAttribute('data-testid');
        const id   = el.id;
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const aria = el.getAttribute('aria-label') || '';

        const results = [];
        if (ph)   results.push({ role: 'input',   name: ph,           extra: 'placeholder' });
        if (tid)  results.push({ role: 'testid',  name: tid,          extra: 'testid' });
        if (id)   results.push({ role: tag,        name: id,           extra: 'id' });
        if (aria) results.push({ role: tag,        name: aria,         extra: 'aria-label' });
        if (text && tag === 'a')      results.push({ role: 'link',   name: text, extra: 'role' });
        if (text && tag === 'button') results.push({ role: 'button', name: text, extra: 'role' });
        return results.length > 0 ? results : null;
      }).filter(Boolean).flat(),
    );
  } catch {}

  // 合并、去重（按 selector 字符串）
  const seen = new Set();
  const all  = [];

  for (const { role, name } of snapNodes) {
    const sel = buildSelector(role, name);
    if (seen.has(sel)) continue;
    seen.add(sel);
    const display = `[${role}] ${name.length > 70 ? name.slice(0, 70) + '…' : name}`;
    all.push({ role, name, selector: sel, label: display });
  }

  for (const { role, name, extra } of domNodes) {
    let sel;
    if (extra === 'placeholder') sel = `getByPlaceholder('${name.replace(/'/g, "\\'")}')`;
    else if (extra === 'testid') sel = `getByTestId('${name.replace(/'/g, "\\'")}')`;
    else if (extra === 'id')     sel = `#${name}`;
    else if (extra === 'role')       sel = buildSelector(role, name);
    else if (extra === 'aria-label') sel = `getByLabel('${name.replace(/'/g, "\\'")}')`;
    else continue;

    if (seen.has(sel)) continue;
    seen.add(sel);
    all.push({ role, name, selector: sel, label: `[${extra}] ${name}` });
  }

  return all;
}

// ─── 终端 TUI ─────────────────────────────────────────────────────────────────

const VISIBLE_ROWS = 15; // 列表最多显示行数

class SelectorUI {
  constructor(elements) {
    this.all      = elements;
    this.filtered = elements;
    this.cursor   = 0;
    this.query    = '';
    this.offset   = 0; // 滚动偏移
  }

  filter(q) {
    this.query    = q;
    const lower   = q.toLowerCase();
    this.filtered = q
      ? this.all.filter(e =>
          e.label.toLowerCase().includes(lower) ||
          e.selector.toLowerCase().includes(lower),
        )
      : this.all;
    this.cursor = 0;
    this.offset = 0;
  }

  moveUp()   { if (this.cursor > 0) { this.cursor--; this._fixOffset(); } }
  moveDown() { if (this.cursor < this.filtered.length - 1) { this.cursor++; this._fixOffset(); } }

  _fixOffset() {
    if (this.cursor < this.offset) this.offset = this.cursor;
    if (this.cursor >= this.offset + VISIBLE_ROWS) this.offset = this.cursor - VISIBLE_ROWS + 1;
  }

  selected() { return this.filtered[this.cursor] || null; }

  render() {
    const out  = [];
    const url  = targetUrl || '(当前页面)';
    const total = this.all.length;

    // 清屏
    out.push('\x1b[2J\x1b[H');

    // 标题
    out.push(`\x1b[1;36m── playwright selector finder ──\x1b[0m`);
    out.push(`页面: \x1b[33m${url}\x1b[0m  共 ${total} 个元素`);
    out.push('');

    // 搜索框
    out.push(`\x1b[1m搜索:\x1b[0m ${this.query}\x1b[7m \x1b[0m  (↑↓选择 Enter确认 Ctrl+C退出)`);
    out.push(`\x1b[90m匹配: ${this.filtered.length} 个\x1b[0m`);
    out.push('');

    // 元素列表
    const slice = this.filtered.slice(this.offset, this.offset + VISIBLE_ROWS);
    for (let i = 0; i < slice.length; i++) {
      const idx  = this.offset + i;
      const el   = slice[i];
      const isOn = idx === this.cursor;
      const prefix = isOn ? '\x1b[1;32m❯ \x1b[0m' : '  ';
      const label  = isOn ? `\x1b[1m${el.label}\x1b[0m` : `\x1b[90m${el.label}\x1b[0m`;
      const sel    = isOn ? `\x1b[32m${el.selector}\x1b[0m` : '';
      out.push(`${prefix}${label}`);
      if (isOn) out.push(`    \x1b[2m→ ${el.selector}\x1b[0m`);
    }

    if (this.filtered.length > VISIBLE_ROWS) {
      out.push(`\x1b[90m  ... ${this.offset + VISIBLE_ROWS}/${this.filtered.length}\x1b[0m`);
    }

    process.stdout.write(out.join('\n') + '\n');
  }
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  let browser = null;
  let context = null;
  let page    = null;
  let ownBrowser = false;

  console.log('正在连接浏览器...');

  if (cdpEndpoint) {
    browser = await chromium.connectOverCDP(cdpEndpoint);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      console.error('CDP 连接成功，但没有打开的页面');
      process.exit(1);
    }
    context = contexts[0];
    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();

    if (targetUrl) {
      console.log(`导航到 ${targetUrl}...`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      targetUrl = page.url();
    }
  } else {
    const dir = userDataDir || require('path').join(require('os').homedir(), 'ChromeProfiles/Profile2');
    context = await chromium.launchPersistentContext(dir, {
      headless      : false,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });
    browser    = null;
    ownBrowser = true;
    const ctxPages = context.pages();
    page = ctxPages.length > 0 ? ctxPages[0] : await context.newPage();
    console.log(`导航到 ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
  }

  console.log('提取元素中...');
  const elements = await extractElements(page);

  async function closeBrowser() {
    if (!ownBrowser) return;
    if (browser) await browser.close().catch(() => {});
    else await context.close().catch(() => {});
  }

  if (elements.length === 0) {
    console.error('未能提取到任何元素，请检查页面是否加载完成');
    await closeBrowser();
    process.exit(1);
  }

  // 启动 TUI
  const ui = new SelectorUI(elements);

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  ui.render();

  process.stdin.on('keypress', async (ch, key) => {
    if (!key) return;

    if ((key.ctrl && key.name === 'c') || key.name === 'escape') {
      process.stdout.write('\x1b[2J\x1b[H');
      await closeBrowser();
      process.exit(0);
    }

    if (key.name === 'return') {
      const item = ui.selected();
      process.stdout.write('\x1b[2J\x1b[H');
      if (item) {
        console.log('\x1b[1;32m✓ 已选择：\x1b[0m');
        console.log(`\x1b[36m${item.selector}\x1b[0m`);
        console.log('');
        console.log('可直接用于 pipeline：');
        console.log(`  "selector": "${item.selector}"`);
      }
      await closeBrowser();
      process.exit(0);
    }

    if (key.name === 'up') {
      ui.moveUp();
    } else if (key.name === 'down') {
      ui.moveDown();
    } else if (key.name === 'backspace') {
      ui.filter(ui.query.slice(0, -1));
    } else if (ch && !key.ctrl && !key.meta) {
      ui.filter(ui.query + ch);
    }

    ui.render();
  });
}

main().catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});
