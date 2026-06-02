const logger   = require('../src/logger');
const reporter = require('../src/reporter');

const IM_KW = 'webcast/im/fetch';

module.exports = {
  schemas: {
    'douyin-im-cookie': {
      label: '抖音IM Cookie采集',
      badge: 'bg-pink-50 text-pink-600',
      desc : '监听 webcast/im/fetch 请求，提取 device/ua/cookie 上报',
      fields: [],
    },
  },

  actions: {
    'douyin-im-cookie': async (context, _params, ctrl) => {
      const profile = ctrl?.profile ?? 'unknown';
      const pages   = context.pages();
      const page    = pages[0];
      if (!page) return { ok: false, reason: 'no_page' };

      let req;
      try {
        req = await page.waitForRequest(
          r => r.url().includes(IM_KW),
          { timeout: 30_000 }
        );
      } catch {
        logger.warn(`[${profile}] douyin-im-cookie: 等待请求超时`);
        return { ok: false, reason: 'timeout' };
      }

      const url    = req.url();
      const device = new URL(url).searchParams.get('user_unique_id') ?? '';
      const ua     = req.headers()['user-agent'] ?? '';
      const cookie = req.headers()['cookie'] ?? '';

      if (!device) {
        logger.warn(`[${profile}] douyin-im-cookie: user_unique_id 为空`);
        return { ok: false, reason: 'no_device' };
      }

      logger.info(`[${profile}] douyin-im-cookie: device=${device}`);
      reporter.reportCookie(ctrl, { device, ua, cookie });

      return { ok: true, device };
    },
  },
};
