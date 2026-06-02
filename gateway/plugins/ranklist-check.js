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

      // 先注册监听再 hover，hover 必然触发新请求
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
        return { ok: false, reason: 'timeout' };
      }

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
