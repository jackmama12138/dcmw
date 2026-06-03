const { getOrCreatePage } = require('../src/actions');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function randNormal(mean, std) {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

module.exports = {
  schemas: {
    'dz': {
      label: '点赞',
      badge: 'bg-red-50 text-red-500',
      desc:  '模拟真实双击 #LikeLayout 点赞 50 次',
      fields: [],
    },
  },

  actions: {
    'dz': async (context) => {
      const page = await getOrCreatePage(context);

      const el = await page.$('#LikeLayout').catch(() => null);
      if (!el) return { ok: false, reason: 'LikeLayout_not_found' };

      const box = await el.boundingBox().catch(() => null);
      if (!box) return { ok: false, reason: 'LikeLayout_not_visible' };
      if (box.width === 0 || box.height === 0) return { ok: false, reason: `LikeLayout_zero_size` };

      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // 单次双击：两次 click 间隔 55-85ms，比 dblclick 更可控
      const doubleTap = async () => {
        const x = Math.round(randNormal(cx, 8));
        const y = Math.round(randNormal(cy, 8));
        await page.mouse.click(x, y);
        await sleep(55 + Math.floor(Math.random() * 31));
        await page.mouse.click(x + Math.round((Math.random() - 0.5) * 4), y + Math.round((Math.random() - 0.5) * 4));
      };

      let done = 0;
      while (done < 50 && !page.isClosed()) {
        // 随机决定本次连击几下（1-4下），模拟手指爆发性连击
        const burst = Math.random() < 0.4
          ? 1                                      // 40% 单次
          : Math.random() < 0.5
            ? 2                                    // 30% 连2
            : Math.random() < 0.6
              ? 3                                  // 18% 连3
              : 4;                                 // 12% 连4
        const count = Math.min(burst, 50 - done);

        for (let b = 0; b < count; b++) {
          await doubleTap();
          done++;
          if (b < count - 1) {
            // 连击内间隔：很短，120-220ms
            await sleep(120 + Math.floor(Math.random() * 101));
          }
        }

        if (done < 50) {
          // 连击后停顿：正常 250-500ms，偶尔稍长
          const r = Math.random();
          const gap = r < 0.7  ? 250 + Math.floor(Math.random() * 251)
                    : r < 0.92 ? 500 + Math.floor(Math.random() * 401)
                    :            900 + Math.floor(Math.random() * 601);
          await sleep(gap);
        }
      }

      return { ok: true, clicks: 50 };
    },
  },
};
