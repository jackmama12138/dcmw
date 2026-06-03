const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const logger = require('./logger');

const SCREENSHOTS_DIR = path.resolve(__dirname, '../data/screenshots');
const MAX_SHOTS_PER_PROFILE = Number(process.env.MAX_SCREENSHOTS_PER_PROFILE) || 5;

// 对路径敏感字段做安全处理，防止目录穿越攻击
function safeName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = path.basename(raw).replace(/[^a-zA-Z0-9_\-]/g, '_');
  return cleaned.length > 0 ? cleaned : null;
}

// 校验 pipeline 数组格式及每个步骤的合法性
// 内置类型做格式校验，插件类型由 Worker 执行时报错，gateway 不拦截
function validatePipeline(pipeline) {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return 'pipeline 必须是非空数组';
  }
  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      return `step[${i}]: 必须是普通对象`;
    }
    if (!step.type || typeof step.type !== 'string' || !step.type.trim()) {
      return `step[${i}]: 缺少 "type" 字段`;
    }
  }
  return null;
}

const sseBus        = require('./sse-bus');
const captureQueue  = require('./capture-queue');
const clientBus     = require('./client-bus');

// 创建并返回 Express Router，注册所有 API 路由
function createRouter({ taskStore, sqliteStore, registry, scheduler }) {
  captureQueue.init(sqliteStore);
  const router = Router();

  // 返回合法 pipeline 动作类型列表，前端用于构建编辑器选项
  router.get('/api/action-types', (_req, res) => {
    res.json([...VALID_ACTION_TYPES]);
  });

  // ─── SSE 推送端点 ─────────────────────────────────────────────────────────
  // Client 连接后立即收到全量快照，后续靠 sseBus 推送增量通知
  router.get('/api/events', (req, res) => {
    sseBus.addClient(req, res);
    // 连接建立后立即推一次全量，让刚打开或重连的页面立刻同步数据
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'all' })}\n\n`);
    }
  });

  // ─── 提交任务 ─────────────────────────────────────────────────────────────

  router.post('/task/add', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: '请求体必须是 JSON' });
    }

    const { target_url } = body;
    // task_type 和 template 均可用于查找模板
    const templateName = body.template ?? body.task_type ?? null;
    if (!target_url) return res.status(400).json({ error: 'target_url 是必填项' });

    // 未提供 task_id 时自动生成，防止重复提交报错
    const task_id = body.task_id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    let pipeline = body.pipeline;
    let task_time = body.task_time;

    // 解析命名模板，获取 pipeline 和默认 task_time
    // pipeline 中的 navigate 步骤可用 "{target_url}" 作占位符
    if (templateName) {
      const tpl = await sqliteStore.getTemplate(templateName);
      if (!tpl) return res.status(404).json({ error: `模板 "${templateName}" 不存在` });
      if (!pipeline) {
        pipeline = tpl.pipeline.map(step =>
          step.type === 'navigate' && step.url === '{target_url}'
            ? { ...step, url: target_url }
            : step
        );
      }
      if (task_time == null) task_time = tpl.task_time;
    }

    const pipelineError = validatePipeline(pipeline);
    if (pipelineError) {
      return res.status(400).json({ error: pipelineError });
    }

    // 检查请求数量是否超过当前可用空闲槽位数
    const count = Math.max(1, Number(body.count) || 1);
    const idleSlots = registry.getIdleSlots();
    let available;
    if (body.target_node) {
      const { worker_id, profile } = body.target_node;
      available = idleSlots.filter(s => s.workerId === worker_id && s.profileName === profile).length;
    } else if (Array.isArray(body.target_worker_ids) && body.target_worker_ids.length) {
      available = idleSlots.filter(s => body.target_worker_ids.includes(s.workerId)).length;
    } else if (body.target_worker_id) {
      available = idleSlots.filter(s => s.workerId === body.target_worker_id).length;
    } else {
      available = idleSlots.length;
    }
    if (count > available) {
      return res.status(409).json({
        error: `count (${count}) 超过当前可用节点数 (${available})`,
        available,
      });
    }

    let task;
    try {
      task = await taskStore.add({ ...body, task_id, pipeline, task_time });
    } catch (err) {
      if (err.message.includes('already exists')) {
        return res.status(409).json({ error: err.message });
      }
      logger.error(`/task/add 错误: ${err.message}`);
      return res.status(500).json({ error: '内部错误' });
    }

    logger.info(`任务已添加: ${task.task_id} 模板=${templateName ?? '—'} 数量=${task.count} url=${task.target_url} target_worker_ids=${JSON.stringify(task.target_worker_ids ?? null)}`);
    scheduler.dispatch();
    sseBus.notifyTasks();
    return res.status(201).json({ ok: true, task });
  });

  // ─── Worker / 节点级别控制 ────────────────────────────────────────────────

  // 停止指定 Worker 上的所有繁忙节点
  router.post('/api/workers/:worker_id/stop', async (req, res) => {
    const { worker_id } = req.params;
    if (!registry.workers.has(worker_id)) {
      return res.status(404).json({ error: 'Worker 不存在' });
    }
    const busySlots = registry.getBusySlots(worker_id);
    const taskIds = [...new Set(busySlots.map(s => s.taskId).filter(Boolean))];
    const rA = await Promise.all(taskIds.map(id => taskStore.atomicForceComplete(String(id))));
    rA.filter(Boolean).forEach(t => sqliteStore.archiveTask(t));
    for (const { profileName, taskId } of busySlots) {
      registry.sendTo(worker_id, { type: 'stop_task', task_id: taskId, profile: profileName });
      registry.markIdle(worker_id, profileName); // 立即释放，允许接受下一个任务
    }
    logger.info(`停止 Worker [${worker_id}]: 共停止 ${busySlots.length} 个节点`);
    sseBus.notifyAll();
    return res.json({ ok: true, stopped: busySlots.length });
  });

  // 停止指定 Worker 上的单个节点
  router.post('/api/workers/:worker_id/nodes/:profile/stop', async (req, res) => {
    const { worker_id, profile } = req.params;
    const w = registry.workers.get(worker_id);
    if (!w) return res.status(404).json({ error: 'Worker 不存在' });
    const slot = w.profiles.get(profile);
    if (!slot) return res.status(404).json({ error: 'Profile 不存在' });
    if (slot.state !== 'busy') return res.status(400).json({ error: '节点当前不忙' });
    if (slot.taskId) {
      const rB = await taskStore.atomicForceComplete(String(slot.taskId));
      if (rB) sqliteStore.archiveTask(rB);
    }
    registry.sendTo(worker_id, { type: 'stop_task', task_id: slot.taskId, profile });
    registry.markIdle(worker_id, profile); // 立即释放
    logger.info(`停止节点 [${worker_id}:${profile}]`);
    sseBus.notifyAll();
    return res.json({ ok: true });
  });

  // ─── URL 级别控制接口 ─────────────────────────────────────────────────────

  // 获取指定 target_url 下所有正在运行的槽位和任务数据
  router.get('/api/tasks/by-url', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'url 查询参数是必填项' });

    const slots = registry.getSlotsByUrl(targetUrl);
    const taskIds = [...new Set(slots.map(s => s.taskId).filter(Boolean))];
    const tasks = (await Promise.all(taskIds.map(id => taskStore.get(id)))).filter(Boolean);

    const taskMap = new Map(tasks.map(t => [t.task_id, t]));
    const result = tasks.map(task => ({
      ...task,
      nodes: slots
        .filter(s => s.taskId === task.task_id)
        .map(s => ({ workerId: s.workerId, profile: s.profileName })),
    }));

    return res.json({ target_url: targetUrl, tasks: result });
  });

  // 强制完成指定 ID 的任务，并通知所有正在执行该任务的节点停止
  router.post('/api/tasks/:id/stop', async (req, res) => {
    const taskId = req.params.id;
    const task = await taskStore.atomicForceComplete(taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    sqliteStore.archiveTask(task);

    const allBusy = registry.getSlotsByTaskId(taskId);
    for (const { workerId, profileName } of allBusy) {
      registry.sendTo(workerId, { type: 'stop_task', task_id: taskId, profile: profileName });
    }

    logger.info(`强制停止任务 ${taskId}`);
    sseBus.notifyAll();
    return res.json({ ok: true, task });
  });

  // 停止所有正在执行指定 target_url 的节点，并将相关任务标记为完成
  router.post('/api/tasks/stop-by-url', async (req, res) => {
    const { target_url } = req.body ?? {};
    if (!target_url) return res.status(400).json({ error: 'target_url 是必填项' });

    const slots = registry.getSlotsByUrl(target_url);
    const taskIds = [...new Set(slots.map(s => s.taskId).filter(Boolean))];
    const rC = await Promise.all(taskIds.map(id => taskStore.atomicForceComplete(id)));
    rC.filter(Boolean).forEach(t => sqliteStore.archiveTask(t));

    for (const { workerId, profileName, taskId } of slots) {
      registry.sendTo(workerId, { type: 'stop_task', task_id: taskId, profile: profileName });
    }

    logger.info(`按 URL 停止 [${target_url}]: 停止 ${slots.length} 个节点，涉及 ${taskIds.length} 个任务`);
    sseBus.notifyAll();
    return res.json({ ok: true, stopped: slots.length, tasks: taskIds });
  });

  // 调整指定 URL 下所有运行中任务的时长，delta>0 增加，delta<0 减少（单位：秒）
  router.post('/api/tasks/adjust-time', async (req, res) => {
    const { target_url, delta } = req.body ?? {};
    if (!target_url) return res.status(400).json({ error: 'target_url 是必填项' });
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      return res.status(400).json({ error: 'delta 必须是有限数值（单位：秒）' });
    }

    const slots = registry.getSlotsByUrl(target_url);
    if (slots.length === 0) return res.json({ ok: true, updated: 0 });

    const taskIds = [...new Set(slots.map(s => s.taskId).filter(Boolean))];
    const updatedTasks = (
      await Promise.all(taskIds.map(id => taskStore.atomicAdjustTaskTime(id, delta)))
    ).filter(Boolean);

    const timeMap = new Map(updatedTasks.map(t => [t.task_id, t.task_time]));

    for (const { workerId, profileName, taskId } of slots) {
      const newTime = timeMap.get(taskId);
      if (newTime === undefined) continue;
      registry.sendTo(workerId, {
        type: 'update_task_time',
        task_id: taskId,
        profile: profileName,
        task_time: newTime,
      });
    }

    logger.info(`调整时长 [${target_url}] delta=${delta}s: 已通知 ${slots.length} 个节点`);
    return res.json({ ok: true, updated: slots.length, tasks: updatedTasks });
  });

  // ─── pipeline 模板管理 ────────────────────────────────────────────────────

  // 获取所有模板列表
  router.get('/api/templates', async (_req, res) => {
    try { res.json(await sqliteStore.getAllTemplates()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // 创建或更新模板
  router.post('/api/templates', async (req, res) => {
    const { name, description, pipeline, task_time } = req.body ?? {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name 是必填项' });
    const pipelineError = validatePipeline(pipeline);
    if (pipelineError) {
      return res.status(400).json({ error: pipelineError });
    }
    try {
      const tpl = await sqliteStore.setTemplate(name, { description, pipeline, task_time });
      res.json({ ok: true, template: tpl });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // 删除指定模板
  router.delete('/api/templates/:name', async (req, res) => {
    try { await sqliteStore.deleteTemplate(req.params.name); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });


  // ─── 调度器配置 ───────────────────────────────────────────────────────────

  // 获取当前调度模式
  router.get('/api/scheduler/config', (_req, res) => {
    res.json({ dispatch_mode: scheduler.getMode(), per_worker_batch: scheduler.getPerWorkerBatch() });
  });

  router.post('/api/scheduler/config', (req, res) => {
    const { dispatch_mode, per_worker_batch } = req.body ?? {};
    try {
      if (dispatch_mode) scheduler.setMode(dispatch_mode);
      if (per_worker_batch != null) scheduler.setPerWorkerBatch(per_worker_batch);
      return res.json({ ok: true, dispatch_mode: scheduler.getMode(), per_worker_batch: scheduler.getPerWorkerBatch() });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });


  // 接收 Worker 上报的 Cookie 数据并存储
  router.post('/api/cookies', async (req, res) => {
    const { task_id, profile, cookie } = req.body ?? {};
    if (!profile) {
      return res.status(400).json({ error: 'profile 是必填项' });
    }
    if (!cookie) {
      logger.warn(`/api/cookies: cookie 为空，仍存储 profile=${profile} uid=${req.body.user_unique_id ?? '—'}`);
    }
    try {
      await sqliteStore.addCookie(String(task_id ?? ''), req.body);
      logger.info(`Cookie 已收集 profile=${profile} uid=${req.body.user_unique_id ?? '—'} cookie=${cookie ? '有' : '空'}`);
      return res.json({ ok: true });
    } catch (err) {
      logger.error(`/api/cookies 错误: ${err.message}`);
      return res.status(500).json({ error: '内部错误' });
    }
  });

  // 接收 Worker 上报的响应拦截数据
  router.post('/api/captures', (req, res) => {
    const { task_id, profile, data } = req.body ?? {};
    if (!task_id || !profile || data == null) {
      return res.status(400).json({ error: 'task_id、profile、data 均为必填项' });
    }
    captureQueue.push(String(task_id), req.body);
    return res.json({ ok: true });
  });

  // 获取全部捕获数据（最新 500 条）
  router.get('/api/captures', async (_req, res) => {
    try {
      return res.json(await sqliteStore.getAllCaptures(500));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 获取指定任务的所有捕获数据
  router.get('/api/captures/:task_id', async (req, res) => {
    try {
      const captures = await sqliteStore.getCaptures(req.params.task_id);
      return res.json(captures);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 获取全局 Cookie 列表（按 user_unique_id 去重，最新覆盖）
  router.get('/api/cookies', async (_req, res) => {
    try {
      return res.json(await sqliteStore.getAllCookies());
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 清空所有 Cookie
  router.delete('/api/cookies', async (_req, res) => {
    try {
      const removed = await sqliteStore.clearCookies();
      logger.info(`已清空 Cookie：${removed} 条`);
      return res.json({ ok: true, removed });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 删除单条 Cookie（按 uid，即 user_unique_id）
  router.delete('/api/cookies/:uid', async (req, res) => {
    try {
      const removed = await sqliteStore.deleteCookie(req.params.uid);
      logger.info(`删除 Cookie uid=${req.params.uid}：${removed} 条`);
      return res.json({ ok: true, removed });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ─── 截图管理 ─────────────────────────────────────────────────────────────

  // 接收 Worker 上报的 JPEG 截图（二进制上传，按 Profile 限量保存）
  router.post('/api/screenshots', async (req, res) => {
    const profile  = safeName(req.headers['x-profile']);
    const workerId = req.headers['x-worker-id'] || '';
    const ts       = parseInt(req.headers['x-timestamp']) || Date.now();

    if (!profile) {
      return res.status(400).json({ error: 'X-Profile 请求头是必填项' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: '请求体必须是 JPEG 二进制数据' });
    }

    try { fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true }); } catch {}

    // 每个 worker+profile 固定一个文件，直接覆盖，不膨胀
    const filename = `${safeName(workerId || 'unknown')}_${profile}.jpg`;
    try {
      fs.writeFileSync(path.join(SCREENSHOTS_DIR, filename), req.body);
    } catch (err) {
      logger.error(`截图写入失败: ${err.message}`);
      return res.status(500).json({ error: '内部错误' });
    }

    await sqliteStore.addScreenshotMeta(filename, { worker_id: workerId, profile, timestamp: ts });
    logger.info(`截图已保存: ${filename} Worker=${workerId}`);

    // 实时通知前端有新截图
    clientBus.broadcast({
      type     : 'screenshot_done',
      worker_id: workerId,
      profile,
      timestamp: ts,
      path     : `/data/screenshots/${filename}`,
    });

    return res.json({ ok: true, path: `/data/screenshots/${filename}` });
  });

  // 获取全局截图列表（含 worker_id 元数据）
  router.get('/api/screenshots', async (_req, res) => {
    try { fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true }); } catch {}
    try {
      const files = fs.readdirSync(SCREENSHOTS_DIR)
        .filter(f => f.endsWith('.jpg'))
        .sort()
        .reverse();
      const meta = await sqliteStore.getScreenshotsMeta(files);
      const raw = files.map(f => {
        const m = meta[f] ?? {};
        const stat = fs.statSync(path.join(SCREENSHOTS_DIR, f));
        const ts = m.timestamp ?? stat.mtimeMs;
        return {
          worker_id: m.worker_id ?? '',
          profile  : m.profile   ?? f.replace('.jpg', ''),
          timestamp: ts,
          filename : f,
          url      : `/data/screenshots/${f}?t=${ts}`,
        };
      });
      // 同一 worker+profile 只保留最新一张
      const dedup = new Map();
      for (const s of raw) {
        const key = `${s.worker_id}:${s.profile}`;
        if (!dedup.has(key) || s.timestamp > dedup.get(key).timestamp) dedup.set(key, s);
      }
      return res.json([...dedup.values()]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 删除单张截图（删除文件 + 元数据）
  router.delete('/api/screenshots/:filename', async (req, res) => {
    const filename = safeName(req.params.filename.replace(/\.jpg$/i, '')) + '.jpg';
    if (!filename || filename === '.jpg') {
      return res.status(400).json({ error: '非法文件名' });
    }
    try {
      try { fs.unlinkSync(path.join(SCREENSHOTS_DIR, filename)); } catch {}
      await sqliteStore.deleteScreenshotMeta(filename);
      logger.info(`删除截图: ${filename}`);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 全部删除截图
  router.delete('/api/screenshots', async (_req, res) => {
    try {
      const files = fs.readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.jpg'));
      for (const f of files) {
        try { fs.unlinkSync(path.join(SCREENSHOTS_DIR, f)); } catch {}
      }
      await sqliteStore.deleteAllScreenshotMeta();
      logger.info(`全部删除截图: ${files.length} 张`);
      return res.json({ ok: true, deleted: files.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 触发指定节点立即截图（fire-and-forget）
  router.post('/api/screenshot/take', (req, res) => {
    const { worker_id, profile, task_id } = req.body ?? {};
    if (!worker_id || !profile) {
      return res.status(400).json({ error: 'worker_id 和 profile 是必填项' });
    }
    const sent = registry.sendTo(worker_id, { type: 'run_screenshot', profile, task_id });
    if (!sent) return res.status(404).json({ error: 'Worker 未连接' });
    logger.info(`触发截图 → ${worker_id}:${profile}`);
    return res.json({ ok: true });
  });

  // 触发页面刷新（支持批量）
  router.post('/api/reload', (req, res) => {
    const body = req.body ?? {};
    const targets = Array.isArray(body.targets)
      ? body.targets
      : [{ worker_id: body.worker_id, profile: body.profile }];

    const results = [];
    for (const { worker_id, profile } of targets) {
      if (!worker_id || !profile) {
        results.push({ worker_id, profile, ok: false, error: 'worker_id 和 profile 是必填项' });
        continue;
      }
      const sent = registry.sendTo(worker_id, { type: 'run_reload', profile });
      if (sent) {
        logger.info(`触发刷新 → ${worker_id}:${profile}`);
        results.push({ worker_id, profile, ok: true });
      } else {
        results.push({ worker_id, profile, ok: false, error: 'Worker 未连接' });
      }
    }
    const allFailed = results.every(r => !r.ok);
    return res.status(allFailed ? 404 : 200).json({ results });
  });

  // ─── 榜单管理 ─────────────────────────────────────────────────────────────

  // 接收 Worker 上报的榜单检查结果

  // 触发榜单检查（支持单个或批量）
  // 单个：{ worker_id, profile, task_id }
  // 批量：{ targets: [{ worker_id, profile, task_id }, ...] }
  router.post('/api/ranklist/check', (req, res) => {
    const body = req.body ?? {};
    const targets = Array.isArray(body.targets)
      ? body.targets
      : [{ worker_id: body.worker_id, profile: body.profile, task_id: body.task_id }];

    const results = [];
    for (const { worker_id, profile, task_id } of targets) {
      if (!worker_id || !profile) {
        results.push({ worker_id, profile, ok: false, error: 'worker_id 和 profile 是必填项' });
        continue;
      }
      const sent = registry.sendTo(worker_id, { type: 'run_ranklist', profile, task_id });
      if (sent) {
        logger.info(`触发榜单检查 → ${worker_id}:${profile}`);
        results.push({ worker_id, profile, ok: true });
      } else {
        results.push({ worker_id, profile, ok: false, error: 'Worker 未连接' });
      }
    }

    const allFailed = results.every(r => !r.ok);
    return res.status(allFailed ? 404 : 200).json({ results });
  });

  // ─── 状态查询接口 ─────────────────────────────────────────────────────────

  // 获取所有已连接 Worker 的状态摘要
  router.get('/api/schemas', (_req, res) => {
    res.json(registry.getSchemas());
  });

  router.post('/api/workers/:worker_id/radmin', (req, res) => {
    const { worker_id } = req.params;
    if (!registry.workers.has(worker_id)) {
      return res.status(404).json({ error: 'Worker 不存在' });
    }
    // worker_id 即为 IP，只允许合法 IPv4 格式，防止命令注入
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(worker_id)) {
      return res.status(400).json({ error: 'worker_id 格式不合法' });
    }
    const vbsContent = `Set WshShell = WScript.CreateObject("WScript.Shell")
WshShell.Run "Radmin.exe /connect:${worker_id}:7899"
WScript.Sleep 1500
WshShell.AppActivate "Radmin " & ChrW(23433) & ChrW(20840) & ChrW(24615)
WScript.Sleep 200
WshShell.SendKeys "+"
WScript.Sleep 300

' 用剪贴板粘贴，避免中文输入法干扰 SendKeys
WshShell.Run "powershell -Command ""Set-Clipboard 'admin'""", 0, True
WshShell.SendKeys "^v"
WScript.Sleep 200
WshShell.SendKeys "{TAB}"
WScript.Sleep 200
WshShell.Run "powershell -Command ""Set-Clipboard 'radmin.7899'""", 0, True
WshShell.SendKeys "^v"
WScript.Sleep 200
WshShell.SendKeys "{ENTER}"
`;
    const vbsPath = path.join(os.tmpdir(), `radmin_${worker_id.replace(/\./g, '_')}.vbs`);
    try {
      fs.writeFileSync(vbsPath, vbsContent, 'utf8');
    } catch (err) {
      logger.error(`写入 VBS 文件失败: ${err.message}`);
      return res.status(500).json({ error: '写入脚本失败' });
    }
    execFile('cscript', ['//nologo', vbsPath], (err) => {
      fs.unlink(vbsPath, () => {});
      if (err) logger.warn(`Radmin 脚本执行异常: ${err.message}`);
    });
    logger.info(`Radmin 连接已触发 → ${worker_id}:7899`);
    return res.json({ ok: true });
  });


  router.get('/api/workers', (_req, res) => {
    res.json(registry.summary());
  });

  // 获取最近 100 条任务记录（活跃任务来自 Redis，历史任务来自 SQLite，合并去重）
  router.get('/api/tasks', async (_req, res) => {
    try {
      const [active, history] = await Promise.all([
        taskStore.getAll(100),
        sqliteStore.getAll(100),
      ]);
      const seen = new Set();
      const merged = [];
      for (const t of [...active, ...history]) {
        if (!seen.has(t.task_id)) { seen.add(t.task_id); merged.push(t); }
      }
      merged.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
      res.json(merged.slice(0, 100));
    } catch (err) {
      logger.error(`/api/tasks 错误: ${err.message}`);
      res.status(500).json({ error: '内部错误' });
    }
  });

  // 获取指定任务详情（先查 Redis 活跃，没有再查 SQLite 历史）
  router.get('/api/tasks/:id', async (req, res) => {
    try {
      const task = await taskStore.get(req.params.id) ?? await sqliteStore.get(req.params.id);
      if (!task) return res.status(404).json({ error: '任务不存在' });
      res.json(task);
    } catch (err) {
      logger.error(`/api/tasks/:id 错误: ${err.message}`);
      res.status(500).json({ error: '内部错误' });
    }
  });

  return router;
}

module.exports = { createRouter };
