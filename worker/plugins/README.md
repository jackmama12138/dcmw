# plugins 插件目录

## 规范

**判断标准：这个动作换一个网站还能用吗？**

- 能用 → `src/actions.js`
- 不能用 → `plugins/`

## 插件格式

```javascript
// plugins/{站点}-{功能}.js
const { getOrCreatePage, resolveElement, humanClick, clamp } = require('../src/actions');

module.exports = {
  actions: {
    'action-name': async (context, params, ctrl) => {
      // 返回 { ok: true } 或 { ok: false, reason: '...' }
    },
  },
};
```

## 命名规则

`{站点}-{功能}.js`，例如：
- `douyin-search.js`
- `douyin-live-cookie.js`
- `baidu-tieba.js`

## 可复用的工具函数（来自 src/actions.js）

| 函数 | 用途 |
|------|------|
| `getOrCreatePage(context)` | 获取当前页面 |
| `resolveLocator(page, expr)` | 解析选择器表达式 |
| `resolveElement(page, params, name)` | 定位元素（含超时重试） |
| `humanClick(page, locator, dblClick)` | 人类模拟点击 |
| `clamp(value, min, max)` | 数值范围限制 |
| `getOrCreateHub(page)` | 获取请求监听 Hub |
| `pickSelector(params)` | 从 params 提取 selector |
| `applyPick(body, pick)` | 从响应体提取字段 |

## 热更新

插件文件修改后通过 gateway API 推送，无需重启 Worker：

```
POST /api/workers/{workerId}/plugin
{ "name": "douyin-search", "code": "..." }
```
