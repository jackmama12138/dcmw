const { getOrCreatePage } = require('../src/actions');
const reporter = require('../src/reporter');

module.exports = {
  schemas: {
    'douyin-storage': {
      label: '抖音存储读取',
      badge: 'bg-pink-50 text-pink-600',
      desc:  '读取抖音页面 localStorage 中的直播状态与用户信息并上报',
      fields: [],
    },
  },

  actions: {
    // 读取抖音页面 localStorage 指定字段并上报
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

      // 读取 localStorage，不存在时返回 null
      const data = await page.evaluate(() => {
        const safe = (key) => {
          try { return localStorage.getItem(key) ?? null; } catch { return null; }
        };
        return {
          live_triple: safe('__live_triple_screen_icon_key_new__'),
          user_info  : safe('user_info'),
        };
      });

      // 解析 JSON 字符串，解析失败保留原始字符串
      const parse = (raw) => {
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      };

      const result = {
        url,
        live_triple: parse(data.live_triple),
        user_info  : parse(data.user_info),
      };

      reporter.reportCapture(ctrl, { pattern: 'douyin-storage', data: result });
      return { ok: true, ...result };
    },
  },
};
