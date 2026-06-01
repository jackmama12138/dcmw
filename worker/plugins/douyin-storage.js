const { getOrCreatePage } = require('../src/actions');
const reporter = require('../src/reporter');

// douyin-reload: 刷新页面并重新执行 mute + pause-video
// antidetect 的 addInitScript 是 context 级别，reload 后自动恢复，无需重跑

module.exports = {
  schemas: {
    'douyin-storage': {
      label: '抖音数据采集',
      badge: 'bg-pink-50 text-pink-600',
      desc:  '读取抖音 localStorage + live.douyin.com Cookie 并合并上报',
      fields: [],
    },
    'douyin-reload': {
      label: '抖音刷新',
      badge: 'bg-pink-50 text-pink-600',
      desc:  '刷新页面并重新静音 + 暂停视频（antidetect 注入自动恢复）',
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

    'douyin-reload': async (context, _params, ctrl) => {
      const page = await getOrCreatePage(context);

      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (err) {
        return { ok: false, reason: `reload_failed: ${err.message}` };
      }

      // 注入持久静音钩子：拦截所有 play 事件，视频一播放立刻静音
      // 页面 JS 加载完成前注入，覆盖 autoplay 和懒加载视频
      await page.addScriptTag({
        content: `(function(){
          const mute = v => { v.muted = true; v.volume = 0; v.pause(); };
          document.querySelectorAll('video').forEach(mute);
          document.addEventListener('play', e => {
            if (e.target.tagName === 'VIDEO') mute(e.target);
          }, true);
          new MutationObserver(mutations => {
            for (const m of mutations)
              for (const n of m.addedNodes)
                if (n.tagName === 'VIDEO') mute(n);
          }).observe(document.body || document.documentElement, { childList: true, subtree: true });
        })();`,
      }).catch(() => {});

      // 等直播画面稳定（视频 readyState >= 2）
      await page.waitForFunction(
        () => { const v = document.querySelector('video'); return v && v.readyState >= 2; },
        { timeout: 15_000 }
      ).catch(() => {});

      // 随机等待 4-8 秒，模拟人类观看行为后再操作，避免刷新后立刻静音被识别
      const delay = 4000 + Math.floor(Math.random() * 4001);
      await new Promise(r => setTimeout(r, delay));

      await page.evaluate(() => {
        document.querySelectorAll('video').forEach(v => {
          v.muted = true; v.volume = 0;
          if (!v.paused) v.pause();
        });
      }).catch(() => {});

      return { ok: true };
    },
  },
};
