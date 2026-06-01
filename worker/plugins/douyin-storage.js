const { getOrCreatePage } = require('../src/actions');
const reporter = require('../src/reporter');

module.exports = {
  schemas: {
    'douyin-storage': {
      label: '抖音数据采集',
      badge: 'bg-pink-50 text-pink-600',
      desc:  '读取抖音 localStorage + live.douyin.com Cookie 并合并上报',
      fields: [],
    },
  },

  actions: {
    // 仅在 *.douyin.com 页面执行，非抖音域名直接跳过
    'douyin-storage': async (context, params, ctrl) => {
      const page = await getOrCreatePage(context);
      const url  = page.url();

      // 域名校验
      let hostname;
      try { hostname = new URL(url).hostname; } catch { hostname = ''; }
      if (!hostname.endsWith('.douyin.com') && hostname !== 'douyin.com') {
        return { ok: false, reason: 'not_douyin', url };
      }

      // 读取 localStorage
      const storage = await page.evaluate(() => {
        const safe = (key) => {
          try { return localStorage.getItem(key) ?? null; } catch { return null; }
        };
        return {
          live_triple: safe('SysInfo'),
          user_info  : safe('user_info'),
        };
      });

      // 解析 JSON 字符串，失败保留原始字符串
      const parse = (raw) => {
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      };

      // 获取 douyin 全域 cookie（context 层面，不受当前页面域名限制）
      const rawCookies = await context.cookies([
        'https://douyin.com',
        'https://live.douyin.com',
      ]);

      // 格式化：{ name: value } 键值对 + 完整 cookie string
      const cookieMap    = Object.fromEntries(rawCookies.map(c => [c.name, c.value]));
      const cookieString = rawCookies.map(c => `${c.name}=${c.value}`).join('; ');

      const result = {
        url,
        live_triple  : parse(storage.live_triple),
        user_info    : parse(storage.user_info),
        cookie_map   : cookieMap,
        cookie_string: cookieString,
      };

      reporter.reportCapture(ctrl, { pattern: 'douyin-storage', matchedUrl: url, body: result });
      return { ok: true, ...result };
    },
  },
};
