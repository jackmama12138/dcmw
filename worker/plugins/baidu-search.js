const { getOrCreatePage, resolveElement, humanClick } = require('../src/actions');

module.exports = {
  schemas: {
    'baidu-search': {
      label: '百度搜索',
      badge: 'bg-blue-50 text-blue-600',
      desc:  '填写百度搜索框并点击搜索按钮',
      fields: [
        { key: 'keyword', label: '搜索词', type: 'text', placeholder: '输入搜索词' },
      ],
    },
  },
  actions: {
    // 百度搜索：填写关键词并点击搜索按钮
    // 参数: keyword（搜索词）
    'baidu-search': async (context, params, ctrl) => {
      const { keyword } = params;
      if (!keyword || typeof keyword !== 'string') {
        return { ok: false, reason: 'no_keyword' };
      }

      const page = await getOrCreatePage(context);

      // 填写搜索框
      const { locator, error } = await resolveElement(
        page,
        { selector: '.chat-textarea', timeout: 8000 },
        'baidu-search',
      );
      if (error) return { ok: false, reason: error };

      await locator.fill('');
      await locator.pressSequentially(keyword, { delay: 80 });

      // 点击搜索按钮
      const { locator: btn, error: btnErr } = await resolveElement(
        page,
        { selector: '#su', timeout: 5000 },
        'baidu-search',
      );
      if (btnErr) return { ok: false, reason: btnErr };

      await humanClick(page, btn);

      return { ok: true, keyword };
    },
  },
};
