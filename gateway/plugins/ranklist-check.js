const logger = require('../src/logger');

const RANKLIST_KW = 'webcast/ranklist/audience';

module.exports = {
  schemas: {},

  actions: {
    'ranklist-check': async (context, _params, ctrl) => {
      const profile = ctrl?.profile ?? 'unknown';
      const page = context.pages()[0];
      if (!page) return { ok: false, reason: 'no_page' };

      // 直播已结束则跳过
      const ended = await page.getByText('直播已结束').first()
        .isVisible({ timeout: 500 }).catch(() => false);
      if (ended) {
        logger.info(`[${profile}] ranklist: 直播已结束，跳过`);
        return { ok: false, reason: 'live_ended' };
      }

      // 等贡献用户 tab 出现
      const tab = page.getByText('贡献用户').first();
      try {
        await tab.waitFor({ state: 'visible', timeout: 5_000 });
      } catch {
        logger.warn(`[${profile}] ranklist: 贡献用户 tab 未出现`);
        return { ok: false, reason: 'tab_not_found' };
      }

      // 先移开鼠标确保 mouseenter 能重新触发，再注册监听、hover
      await page.mouse.move(0, 0).catch(() => {});
      await new Promise(r => setTimeout(r, 200));

      const responsePromise = page.waitForResponse(
        r => r.url().includes(RANKLIST_KW),
        { timeout: 10_000 }
      );
      await tab.hover({ timeout: 3_000 }).catch(() => {});

      let json;
      try {
        json = await (await responsePromise).json();
      } catch {
        logger.warn(`[${profile}] ranklist: 响应超时或解析失败`);
        await page.mouse.move(0, 0).catch(() => {});
        return { ok: false, reason: 'timeout' };
      }

      // 响应拿到后移开鼠标，面板收起，下次 hover 才能重新触发 mouseenter
      await page.mouse.move(0, 0).catch(() => {});

      const selfInfo = json?.data?.self_info ?? {};
      const payload = {
        worker_id   : process.env.WORKER_ID ?? '',
        profile,
        task_id     : ctrl?.task_id ?? '',
        live_url    : page.url(),
        timestamp   : Date.now(),
        is_logged_in: !!selfInfo.user,
        nickname    : selfInfo.user?.nickname ?? '',
        rank        : typeof selfInfo.rank === 'number' ? selfInfo.rank : 0,
        is_ranked   : (selfInfo.rank ?? 0) > 0,
      };

      logger.info(`[${profile}] ranklist: 排名=${payload.rank} 昵称=${payload.nickname || '—'}`);

      return { ok: true, rank: payload.rank, nickname: payload.nickname, is_logged_in: payload.is_logged_in };
    },
  },
};
