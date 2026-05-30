# Pipeline Action 核心文档

每个 Pipeline 步骤是一个 JSON 对象，必须包含 `type` 字段，其余字段为该动作的参数。

```json
{ "type": "动作类型", "参数1": "值", "参数2": "值" }
```

---

## 选择器格式说明

以下动作凡涉及元素定位，`string` 参数均支持两种格式：

**CSS 选择器**
```
"#id"  ".class"  "video"  "input[type=text]"
```

**Playwright getBy* 表达式**
```
getByText('推荐')
getByRole('button', { name: '关注' })
getByPlaceholder('请输入...')
getByLabel('用户名')
getByAltText('头像')
getByTestId('submit-btn')
getByTitle('关闭')
```

> **安全限制**：getBy* 参数中不允许出现 `require`、`import`、`process`、`eval`、`Function`、`constructor`、`__proto__`、`prototype` 等关键词，违反则抛出错误。

---

## navigate — 进入页面

```json
{ "type": "navigate", "url": "https://live.douyin.com/xxx", "waitUntil": "commit" }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `url` | string | 必填 | 目标 URL，可用 `{target_url}` 占位符 |
| `waitUntil` | string | `commit` | 等待策略（见下表）|

**waitUntil 策略**

| 值 | 含义 | 适用场景 |
|----|------|---------|
| `commit` | 收到首字节即返回 | 速度最快，页面尚在加载 |
| `domcontentloaded` | DOM 解析完成 | 页面结构已就绪 |
| `load` | 所有资源加载完毕 | 需要等页面完全渲染 |
| `networkidle` | 网络静默 500ms | 等待所有异步请求完成 |

**边界**
- 超时固定 30s，超时抛出错误终止 pipeline
- 不在白名单内的 `waitUntil` 值自动降级为 `commit`
- 别名：`open`、`goto` 行为完全相同

---

## wait — 随机等待

```json
{ "type": "wait", "min": 10000, "max": 12000 }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `min` | number | 环境变量 `WAIT_TIME` 第1值 或 3000 | 最短等待（ms）|
| `max` | number | 环境变量 `WAIT_TIME` 第2值 或 4000 | 最长等待（ms）|

**行为**
- 实际等待时长为 `[min, max]` 之间的随机整数
- `min > max` 时自动互换
- 每 100ms 检测一次 `ctrl.stopped`，停止信号到达立即退出

**边界**
- min/max 均可为 0
- 无上限，但建议不超过 60000ms

---

## dwell — 挂机

```json
{ "type": "dwell" }
```

无参数。按任务的 `task_time`（秒）持续等待。

**行为**
- 每 500ms 检测 `ctrl.stopped` 和已过时间
- 实际上限为 `min(task_time, DWELL_MAX_SECONDS)`，环境变量 `DWELL_MAX_SECONDS` 默认 72000s（20 小时）
- 收到 stop 信号立即退出
- 通常放在 pipeline 最后一步

**边界**
- task_time 为 0 时立即退出
- 外部可通过 `adjust-time` 接口实时修改剩余时长

---

## reload — 刷新页面

```json
{ "type": "reload" }
```

无参数。等待 `domcontentloaded`，超时 30s。失败只打 warn，不终止 pipeline。

---

## antidetect — 防检测

```json
{ "type": "antidetect" }
```

无参数。注入以下两项欺骗脚本：

1. 覆盖 `document.visibilityState` → 始终返回 `"visible"`
2. 覆盖 `document.hidden` → 始终返回 `false`
3. 启动人类活动模拟循环：每 30–60s 随机派发一次 `mousemove`/`keydown`/`wheel`/`click` 事件

**行为**
- 通过 `context.addInitScript` 注册，后续页面导航后依然生效
- 在当前页面立即执行一次
- 活动循环存储在 `window._antiPauseHumanHook`，重复调用不会重复注册

**边界**
- 当前页面执行失败（如页面上下文异常）只打 warn，不抛错
- 建议放在 navigate 之后尽早执行

---

## wait-for — 等待元素出现

```json
{ "type": "wait-for", "string": "getByText('直播中')", "timeout": 15000, "stopOnTimeout": false }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `string` | string | 必填 | CSS 选择器或 getBy* 表达式 |
| `timeout` | number | 10000 | 等待超时（ms）|
| `stopOnTimeout` | boolean | `false` | 超时后是否结束整个任务 |

**边界**
- `timeout` 限制在 500–120000ms
- `stopOnTimeout: true` 时，超时触发 `ctrl.stop()`，后续步骤不再执行
- `stopOnTimeout: false` 时，超时只打 warn，pipeline 继续

---

## click — 单击

```json
{ "type": "click", "string": "getByText('关注')", "timeout": 5000 }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `string` / `selector` | string | 必填 | 元素定位表达式 |
| `timeout` | number | 5000 | 等待元素可见超时（ms）|

**行为**
- 鼠标从随机位置以贝塞尔曲线移动到目标元素中心附近（±2px 随机偏移）
- 移动后随机停顿 80–200ms 再点击

**边界**
- `timeout` 限制在 500–15000ms
- 元素不可见时跳过，不抛错
- 元素无边界框（隐藏/不在视口）时跳过

---

## dblclick — 双击

```json
{ "type": "dblclick", "string": "#video-area" }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `string` / `selector` | string | 元素定位表达式 |

行为和边界与 `click` 相同，最终调用 `mouse.dblclick`。

---

## hover — 悬停

```json
{ "type": "hover", "string": ".tab-item" }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `string` / `selector` | string | 元素定位表达式 |

等待元素可见（最多 5s），然后调用 Playwright `locator.hover()`，超时 5s。

---

## hover-capture — 悬停后移走

```json
{ "type": "hover-capture", "string": "getByText('贡献用户')", "dwell": 2000, "exit_x": 0, "exit_y": 0 }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `string` | string | 必填 | 元素定位表达式 |
| `dwell` | number | 1000 | 悬停时长（ms）|
| `exit_x` | number | 0 | 移走目标 X 坐标 |
| `exit_y` | number | 0 | 移走目标 Y 坐标 |

**边界**
- `dwell` 限制在 0–30000ms
- 元素不可见时跳过（5s 超时）

---

## fill — 填写输入框

```json
{ "type": "fill", "string": "getByPlaceholder('搜索')", "value": "内容", "mode": "fill", "delay": 50 }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `string` | string | 必填 | 元素定位表达式 |
| `value` | string | 必填 | 要填入的内容 |
| `mode` | string | `fill` | `fill`（直接设值）或 `type`（逐字输入）|
| `delay` | number | 50 | `type` 模式下每个字符间隔（ms）|
| `clear` | boolean | `true` | `type` 模式下是否先清空输入框 |

**边界**
- `value` 最多 2000 字符，超出截断
- `delay` 限制在 0–500ms
- 元素 5s 内不可见则跳过

---

## scroll — 滚动

```json
{ "type": "scroll", "y": 500 }
{ "type": "scroll", "y": 300, "selector": ".chat-list" }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `x` | number | 0 | 水平滚动量（px）|
| `y` | number | 300 | 垂直滚动量（px）|
| `selector` | string | — | 指定滚动容器（不填则滚动页面）|

**边界**
- 指定 `selector` 时元素不存在则跳过（5s 超时）

---

## mousemove — 移动鼠标

```json
{ "type": "mousemove", "x": 100, "y": 200 }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `x` | number | 目标 X 坐标（必填）|
| `y` | number | 目标 Y 坐标（必填）|

直接移动，无贝塞尔曲线。`x` 或 `y` 非数字时抛错。

---

## pause-video — 暂停视频

```json
{ "type": "pause-video", "selector": "video", "all": false, "timeout": 10000 }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `selector` | string | `video` | CSS 选择器 |
| `all` | boolean | `false` | `true` 操作所有匹配元素，`false` 只操作第一个 |
| `timeout` | number | 10000 | 等待元素出现超时（ms）|

**边界**
- `timeout` 限制在 1000–30000ms
- 元素已处于暂停状态时不重复操作，日志标注"均已暂停"
- 元素未出现则跳过

---

## mute-video — 静音视频

```json
{ "type": "mute-video", "selector": "video", "mute": true, "all": false, "timeout": 10000 }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `selector` | string | `video` | CSS 选择器 |
| `mute` | boolean | `true` | `true` 静音，`false` 取消静音 |
| `all` | boolean | `false` | 是否操作所有匹配元素 |
| `timeout` | number | 10000 | 等待元素出现超时（ms）|

静音时同时设置 `volume = 0`，取消静音时设置 `volume = 1`。

---

## rtcookie — 采集 Cookie（route 拦截）

```json
{ "type": "rtcookie", "url": "webcast/im/fetch/?resp_content_type" }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string | URL 关键词（glob 匹配：`**keyword**`）|

**行为**
- 使用 `page.route()` 拦截包含关键词的请求（CDP Fetch 协议，能获取完整请求头）
- 第一次匹配后提取 `cookie`、`device_id`、`user_unique_id`、`user-agent` 并上报
- 上报完成后自动注销路由，后续请求不再拦截
- 任务停止时若未触发，也会自动注销

**与 run-code + page.route 的区别**
- `rtcookie`：一次性采集，采到即止
- `run-code + page.route`：持续监听，每次触发都上报（需用 `reported` Set 去重）

**边界**
- 只上报有 `cookie` 头的请求，空 cookie 跳过
- 上报失败（网络错误）只打 warn，不影响 pipeline

---

## intercept — 捕获响应数据

```json
{ "type": "intercept", "url": "webcast/ranklist/audience", "timeout": 15000 }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `url` | string | 必填 | 响应 URL 关键词（字符串包含匹配）|
| `timeout` | number | 15000 | 等待超时（ms）|

**行为**
- 使用 `page.waitForResponse()` 监听响应（非拦截，不影响请求）
- 捕获第一个匹配的响应体，优先解析为 JSON，失败则取文本
- 立即返回（不阻塞 pipeline），响应到达后异步上报

**与 rtcookie 的区别**
- `intercept` 捕获**响应体**（服务端返回的 JSON 数据）
- `rtcookie` 捕获**请求头**（客户端发送的 Cookie）

**边界**
- `timeout` 内无匹配只打 warn，不终止 pipeline
- 一次性：只上报第一个匹配响应

---

## screenshot — 截图上报

```json
{ "type": "screenshot", "quality": 60 }
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `quality` | number | 60 | JPEG 质量（20–90）|
| `fullPage` | boolean | `false` | 是否截取完整页面（当前不生效，CDP 只截视口）|

**行为**
- 通过 CDP `Page.captureScreenshot` 直接截图，**不等待字体加载**，不受页面渲染状态影响
- 截图超时 10s，上报超时 15s
- 上报到 `POST /api/screenshots`（二进制），gateway 按 Profile 限量存储

**边界**
- `quality` 超出范围自动夹紧到 20–90
- 浏览器已关闭时静默退出，不打日志
- 建议通过任务列表"截图"按钮触发，而非加入 pipeline

---

## eval — 执行浏览器 JS

```json
{ "type": "eval", "code": "document.title" }
{ "type": "eval", "code": "() => window.location.href" }
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `code` | string | 在浏览器上下文中执行的 JS 代码 |

**行为**
- 调用 `page.evaluate(code)`，代码在浏览器沙箱中运行
- 返回值打印到日志
- 不可访问 Node.js 全局（`process`、`require` 等）

**边界**
- 执行失败只打 warn，不终止 pipeline
- 返回值无法传回 pipeline 后续步骤

---

## run-code — Playwright Node.js 代码

```json
{
  "type": "run-code",
  "code": "async ({ page, context, ctrl }) => { await page.click('button'); }"
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `code` | string | 接收 `{ page, context, ctrl }` 的异步函数表达式 |

**可用变量**

| 变量 | 类型 | 说明 |
|------|------|------|
| `page` | Page | 当前 Playwright Page 对象 |
| `context` | BrowserContext | 当前 Browser Context |
| `ctrl` | object | 任务控制器，包含 `ctrl.profile`、`ctrl.task_id`、`ctrl.stopped`、`ctrl.task_time` |

**行为**
- 在 Node.js 侧执行，可访问 `process.env`、Node.js `fetch`（18+）等全局
- `await fn(...)` 会等待函数完成，但函数内注册的事件监听器（`page.on`/`page.route`）在函数返回后仍然有效
- 执行失败只打 warn，不终止 pipeline

**典型用法：持续采集 Cookie**

```js
async ({ page, context, ctrl }) => {
  const nu = process.env.CENTER_NOTIFY_URL ?? '';
  const base = nu.includes('/notify') ? nu.split('/notify')[0] : nu;
  if (!base) return;
  const reported = new Set();
  await page.route('**webcast/im/fetch/?resp_content_type**', async route => {
    const req = route.request();
    const h = req.headers();
    await route.continue();                          // 先放行
    const cookie = h['cookie'] || '';
    if (!cookie) return;
    let uid = '';
    try { uid = new URL(req.url()).searchParams.get('user_unique_id') || ''; } catch {}
    if (uid && reported.has(uid)) return;
    if (uid) reported.add(uid);
    fetch(base + '/api/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: ctrl.profile, task_id: ctrl.task_id,
        worker_id: process.env.WORKER_ID ?? '',
        cookie, user_unique_id: uid,
        user_agent: h['user-agent'] || '',
        timestamp: Date.now()
      }),
      signal: AbortSignal.timeout(5000)
    }).catch(() => {});
  });
}
```

**边界**
- `page.route()` 在 run-code 中注册后，task 结束 browser 关闭时自动清理
- `page.on('request')` 拿不到 Cookie 头（Chrome 安全限制），需用 `page.route()` 才能获取完整请求头
- 不能在代码内无限循环，会阻塞整个 pipeline

---

## close — 关闭浏览器

```json
{ "type": "close" }
```

无参数。关闭所有页面和 BrowserContext。

**行为**
- 标记 `slot.releasing = true` 防止 chrome-pool 触发意外警告
- 关闭所有页面（`Promise.allSettled`）后关闭 context
- 关闭后 pool.release 不会再次关闭

**边界**
- 通常不需要显式加入 pipeline，任务结束时 pool 自动释放
- 主要用于需要提前关闭浏览器的特殊场景

---

## 执行顺序与错误处理

```
pipeline 顺序执行
  ├─ 步骤抛出错误 → 整个任务标记 error，后续步骤不执行
  ├─ 步骤内部 warn → 打日志，继续下一步（如元素未找到、超时跳过）
  ├─ ctrl.stopped = true → 当前步骤中止，后续步骤跳过
  └─ safety timeout（task_time + 300s）→ 强制结束，标记 timeout
```

**哪些情况会终止任务**
- `navigate` 超时（30s）
- `wait-for` 设置了 `stopOnTimeout: true` 且超时
- `fill` 的 `string` 或 `value` 参数缺失（抛错）
- `mousemove` 的 `x`/`y` 非数字（抛错）
- 收到外部 `stop_task` 信号

**哪些情况只打 warn 继续**
- `click`/`hover`/`dblclick` 元素不可见或无边界框
- `scroll` 指定元素未找到
- `wait-for` 超时且 `stopOnTimeout: false`
- `fill` 元素不可见
- `reload` 超时
- `rtcookie`/`intercept` 上报失败
- `antidetect` 当前页面执行失败
- `screenshot` 截图失败
- `eval`/`run-code` 执行失败
