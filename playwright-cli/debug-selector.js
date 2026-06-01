#!/usr/bin/env node
/**
 * 用法：node debug-selector.js <url> <selector>
 * 例：  node debug-selector.js https://www.baidu.com "getByText('贴吧')"
 */
'use strict';

const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');

const [,, url, selectorExpr] = process.argv;
if (!url || !selectorExpr) {
  console.log('用法：node debug-selector.js <url> <selector>');
  process.exit(0);
}

// 复用与 actions.js 相同的 resolveLocator 逻辑
const GETBY_METHODS = new Set([
  'getByText','getByRole','getByLabel','getByPlaceholder',
  'getByAltText','getByTestId','getByTitle',
]);

function resolveLocator(page, expr) {
  expr = expr.trim();
  const m = expr.match(/^(getBy\w+)\((.+)\)$/s);
  if (!m) return page.locator(expr);
  const [, method, rawArgs] = m;
  if (!GETBY_METHODS.has(method)) throw new Error(`未知方法 "${method}"`);
  // eslint-disable-next-line no-new-func
  const args = new Function('"use strict"; return [' + rawArgs + ']')();
  return page[method](...args);
}

async function main() {
  const dir = path.join(os.homedir(), 'ChromeProfiles/Profile2');
  const context = await chromium.launchPersistentContext(dir, {
    headless      : false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  const page = context.pages()[0] ?? await context.newPage();
  console.log(`\n导航到 ${url} ...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 分阶段检查，每 1s 检查一次，最多等 15s
  console.log(`\n开始检查 selector: ${selectorExpr}\n`);
  const locator = resolveLocator(page, selectorExpr);

  for (let i = 1; i <= 15; i++) {
    await page.waitForTimeout(1000);
    const count = await locator.count();

    if (count > 0) {
      console.log(`✓ ${i}s 后找到 ${count} 个匹配元素`);
      // 逐个检查状态
      for (let j = 0; j < Math.min(count, 5); j++) {
        const el      = locator.nth(j);
        const visible = await el.isVisible().catch(() => false);
        const enabled = await el.isEnabled().catch(() => false);
        const text    = await el.textContent().catch(() => '');
        const box     = await el.boundingBox().catch(() => null);
        console.log(`  [${j}] visible=${visible} enabled=${enabled} text="${text?.trim().slice(0,40)}" box=${JSON.stringify(box)}`);
      }
      break;
    } else {
      process.stdout.write(`  ${i}s: 未找到\r`);
    }

    if (i === 15) {
      console.log('\n✗ 15s 内始终未找到该元素');
      console.log('\n── 页面上所有含目标文字的元素 ──');

      // 尝试提取目标关键词从 selectorExpr
      const kwMatch = selectorExpr.match(/'([^']+)'/);
      if (kwMatch) {
        const kw = kwMatch[1];
        const found = await page.$$eval('*', (els, kw) =>
          els
            .filter(el => el.children.length === 0 && el.textContent?.includes(kw))
            .slice(0, 10)
            .map(el => ({
              tag  : el.tagName,
              id   : el.id,
              cls  : el.className.toString().slice(0, 40),
              text : el.textContent?.trim().slice(0, 50),
              vis  : el.offsetParent !== null,
            })),
          kw,
        );

        if (found.length > 0) {
          console.log(`找到包含 "${kw}" 文字的叶节点：`);
          found.forEach((el, i) => console.log(`  [${i}] <${el.tag}> id="${el.id}" class="${el.cls}" text="${el.text}" visible=${el.vis}`));
          console.log('\n可能原因：元素存在但 getByText 匹配方式不对，试试 CSS 选择器或 getByRole');
        } else {
          console.log(`页面上完全找不到含 "${kw}" 的文字，可能是：`);
          console.log('  1. 页面未登录，内容被替换');
          console.log('  2. 内容在 iframe 里');
          console.log('  3. 需要更长等待时间');
        }
      }
    }
  }

  console.log('\n按 Ctrl+C 退出...');
  await new Promise(() => {});
}

main().catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});
