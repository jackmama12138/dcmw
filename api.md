# DCMW Gateway API 文档

Base URL: `http://<gateway_host>:7777`

---

## 任务管理

### 提交任务

```
POST /task/add
```

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `target_url` | string | ✓ | 目标 URL |
| `task_type` / `template` | string | — | 模板名称，二选一 |
| `pipeline` | array | — | 自定义 Pipeline（与模板互斥） |
| `count` | number | — | 并发节点数，默认 1 |
| `task_time` | number | — | 挂机时长（秒），模板有默认值 |
| `task_id` | string | — | 自定义任务 ID，不填自动生成 |
| `target_worker_id` | string | — | 限定 Worker |
| `target_node` | object | — | 限定单个节点 `{ worker_id, profile }` |

**响应** `201`

```json
{ "ok": true, "task": { "task_id": "...", "status": "pending", ... } }
```

**错误**

| 状态码 | 原因 |
|--------|------|
| 400 | 参数缺失或 pipeline 格式错误 |
| 404 | 模板不存在 |
| 409 | 可用节点数不足 / task_id 重复 |

---

### 获取任务列表

```
GET /api/tasks
```

返回最近 100 条任务，按创建时间倒序。

**响应**

```json
[
  {
    "task_id": "1780089503513_709x",
    "status": "done",
    "target_url": "https://live.douyin.com/xxx",
    "task_type": "ck",
    "count": 3,
    "running": 0,
    "completed": 3,
    "failed": 0,
    "task_time": 3600,
    "created_at": 1780089503513,
    "updated_at": 1780089700000
  }
]
```

---

### 获取任务详情

```
GET /api/tasks/:id
```

---

### 停止任务

```
POST /api/tasks/:id/stop
```

强制将任务标记为完成，并通知所有正在执行该任务的节点停止。

**响应**

```json
{ "ok": true, "task": { ... } }
```

---

### 按 URL 查询任务

```
GET /api/tasks/by-url?url=https://live.douyin.com/xxx
```

返回当前正在执行该 URL 的所有任务及节点信息。

---

### 按 URL 停止所有任务

```
POST /api/tasks/stop-by-url
```

**请求体**

```json
{ "target_url": "https://live.douyin.com/xxx" }
```

**响应**

```json
{ "ok": true, "stopped": 3, "tasks": ["task_id_1", "task_id_2"] }
```

---

### 调整任务时长

```
POST /api/tasks/adjust-time
```

对指定 URL 下所有运行中任务的 `task_time` 实时增减，并推送给对应节点。

**请求体**

```json
{ "target_url": "https://live.douyin.com/xxx", "delta": 600 }
```

`delta` 单位为秒，正数增加，负数减少。

---

## Worker 控制

### 获取 Worker 状态

```
GET /api/workers
```

**响应**

```json
[
  {
    "workerId": "192.168.2.103",
    "connected": true,
    "slots": { "idle": 6, "busy": 1, "total": 7 },
    "profiles": [
      {
        "profileName": "Profile1",
        "state": "busy",
        "taskId": "xxx",
        "targetUrl": "https://live.douyin.com/xxx",
        "currentUrl": "https://live.douyin.com/xxx",
        "currentTitle": "Noomi的直播间"
      }
    ],
    "lastHeartbeat": 1780089700000
  }
]
```

---

### 停止 Worker 所有节点

```
POST /api/workers/:worker_id/stop
```

---

### 停止单个节点

```
POST /api/workers/:worker_id/nodes/:profile/stop
```

---

## 模板管理

### 获取模板列表

```
GET /api/templates
```

---

### 创建 / 更新模板

```
POST /api/templates
```

**请求体**

```json
{
  "name": "抖音挂机",
  "description": "描述文字",
  "task_time": 3600,
  "pipeline": [
    { "type": "navigate", "url": "{target_url}", "waitUntil": "commit" },
    { "type": "dwell" }
  ]
}
```

Pipeline 中 navigate 步骤的 `url` 可用 `{target_url}` 作占位符，提交任务时自动替换。

**Pipeline 可用 Action 类型**

| type | 说明 | 主要参数 |
|------|------|---------|
| `navigate` | 进入 URL | `url`, `waitUntil` |
| `wait` | 随机等待 | `min`, `max`（ms）|
| `dwell` | 挂机（按 task_time）| — |
| `reload` | 刷新页面 | — |
| `antidetect` | 注入防检测脚本 | — |
| `wait-for` | 等待元素出现 | `string`, `timeout`, `stopOnTimeout` |
| `click` | 点击元素 | `string`, `timeout` |
| `dblclick` | 双击 | `string` |
| `hover` | 悬停 | `string` |
| `fill` | 填写输入框 | `string`, `value`, `mode`, `delay` |
| `scroll` | 滚动 | `y`, `selector` |
| `mousemove` | 移动鼠标 | `x`, `y` |
| `pause-video` | 暂停视频 | `selector`, `all` |
| `mute-video` | 静音视频 | `selector`, `mute`, `all` |
| `hover-capture` | Hover 移入移出 | `string`, `dwell`, `exit_x`, `exit_y` |
| `rtcookie` | 采集 Cookie（route 拦截） | `url`（关键词）|
| `intercept` | 捕获响应数据 | `url`（关键词）, `timeout` |
| `screenshot` | 截图上报 | `quality`, `fullPage` |
| `eval` | 执行 JS | `code` |
| `run-code` | Playwright 代码 | `code`（接收 `{ page, context, ctrl }`）|
| `close` | 关闭浏览器 | — |

---

### 删除模板

```
DELETE /api/templates/:name
```

---

## Cookie 采集

### 获取 Cookie 列表

```
GET /api/cookies
```

全局 Cookie 列表，按 `user_unique_id` 去重，同一账号保留最新一条。

**响应**

```json
[
  {
    "profile": "Profile1",
    "worker_id": "192.168.2.103",
    "task_id": "xxx",
    "cookie": "live_use_vvc=...",
    "user_agent": "Mozilla/5.0 ...",
    "user_unique_id": "7644449239221224966",
    "device_id": "...",
    "timestamp": 1780089628000
  }
]
```

---

### 上报 Cookie（Worker 调用）

```
POST /api/cookies
```

**请求体**

| 字段 | 必填 | 说明 |
|------|------|------|
| `profile` | ✓ | Profile 名称 |
| `cookie` | ✓ | Cookie 字符串 |
| `worker_id` | — | Worker ID |
| `task_id` | — | 任务 ID |
| `user_unique_id` | — | 抖音用户唯一 ID（去重 key）|
| `user_agent` | — | User-Agent |
| `timestamp` | — | 时间戳（ms）|

---

## 截图

### 获取截图列表

```
GET /api/screenshots
```

全局截图列表，每个 Profile 最多保留 `MAX_SHOTS_PER_PROFILE`（默认 5）张。

**响应**

```json
[
  {
    "worker_id": "192.168.2.103",
    "profile": "Profile1",
    "timestamp": 1780089700000,
    "url": "/data/screenshots/Profile1_1780089700000.jpg"
  }
]
```

---

### 触发截图

```
POST /api/screenshot/take
```

向指定节点发送截图指令，Fire-and-forget，结果异步出现在截图列表。

**请求体**

```json
{ "worker_id": "192.168.2.103", "profile": "Profile1", "task_id": "xxx" }
```

---

### 上报截图（Worker 调用）

```
POST /api/screenshots
```

请求体为原始 JPEG 二进制，通过 HTTP Headers 传递元数据。

| Header | 必填 | 说明 |
|--------|------|------|
| `Content-Type` | ✓ | `image/jpeg` |
| `X-Profile` | ✓ | Profile 名称 |
| `X-Worker-Id` | — | Worker ID |
| `X-Task-Id` | — | 任务 ID |
| `X-Timestamp` | — | 时间戳（ms）|

---

## 拦截数据

### 获取捕获数据

```
GET /api/captures/:task_id
```

---

### 上报捕获数据（Worker 调用）

```
POST /api/captures
```

**请求体**

| 字段 | 必填 | 说明 |
|------|------|------|
| `task_id` | ✓ | 任务 ID |
| `profile` | ✓ | Profile 名称 |
| `worker_id` | — | Worker ID |
| `data` | ✓ | 响应体（JSON 或字符串）|
| `pattern` | — | 匹配的 URL 关键词 |
| `matched_url` | — | 实际匹配的完整 URL |
| `timestamp` | — | 时间戳（ms）|

---

## 榜单检查

### 获取榜单记录

```
GET /api/ranklist
```

按 `worker_id:profile` 去重，同一节点保留最新一条。

**响应**

```json
[
  {
    "worker_id": "192.168.2.103",
    "profile": "Profile1",
    "task_id": "xxx",
    "live_url": "https://live.douyin.com/xxx",
    "is_logged_in": true,
    "nickname": "Noomi",
    "rank": 42,
    "is_ranked": true,
    "timestamp": 1780089700000
  }
]
```

---

### 触发榜单检查

```
POST /api/ranklist/check
```

向指定节点发送榜单检查指令，Fire-and-forget。

**请求体**

```json
{ "worker_id": "192.168.2.103", "profile": "Profile1", "task_id": "xxx" }
```

---

### 上报榜单结果（Worker 调用）

```
POST /api/ranklist
```

**请求体**

| 字段 | 必填 | 说明 |
|------|------|------|
| `profile` | ✓ | Profile 名称 |
| `worker_id` | ✓ | Worker ID |
| `live_url` | — | 直播间 URL |
| `is_logged_in` | — | 是否已登录 |
| `nickname` | — | 账号昵称 |
| `rank` | — | 榜单名次（0 表示未上榜）|
| `is_ranked` | — | 是否在榜 |
| `timestamp` | — | 时间戳（ms）|

---

## 调度器

### 获取调度模式

```
GET /api/scheduler/config
```

**响应**

```json
{ "dispatch_mode": "sequential" }
```

---

### 设置调度模式

```
POST /api/scheduler/config
```

**请求体**

```json
{ "dispatch_mode": "sequential" }
```

| 值 | 说明 |
|----|------|
| `sequential` | 顺序分配，优先填满同一 Worker |
| `random` | 随机分配 |

---

## 自定义动作代码

### 获取当前代码

```
GET /api/actions
```

**响应**

```json
{ "code": "...", "has_custom": true }
```

---

### 上传自定义代码

```
POST /api/actions
```

代码经语法检查后广播到所有在线 Worker，正在执行的步骤完成后生效。

**请求体**

```json
{ "code": "module.exports = { runStep: async (context, step, ctrl) => { ... } }" }
```

---

### 重置为内置代码

```
DELETE /api/actions
```

---

## WebSocket

```
ws://<gateway_host>:7777/ws/livetop?worker_id=<worker_id>
```

Worker 连接后发送 `register` 消息，之后通过心跳保活。Gateway 通过此连接下发任务、停止指令、截图/榜单触发等消息。

---

## 错误格式

所有错误响应统一格式：

```json
{ "error": "错误说明" }
```
