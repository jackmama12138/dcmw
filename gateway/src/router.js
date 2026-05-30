const { Router } = require('express');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const SCREENSHOTS_DIR = path.resolve(__dirname, '../data/screenshots');
const MAX_SHOTS_PER_PROFILE = Number(process.env.MAX_SCREENSHOTS_PER_PROFILE) || 5;

// 对路径敏感字段做安全处理，防止目录穿越攻击
function safeName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = path.basename(raw).replace(/[^a-zA-Z0-9_\-]/g, '_');
  return cleaned.length > 0 ? cleaned : null;
}

// 合法的 pipeline 动作类型白名单
const VALID_ACTION_TYPES = new Set([
  'navigate','open','goto','reload',
  'wait','dwell',
  'click','dblclick','hover','fill','scroll','mousemove','mousedown','mouseup',
  'rtcookie','screenshot','antidetect','pause-video','mute-video','wait-for','hover-capture','intercept',
  'eval','run-code',
  'close',
]);

// 校验 pipeline 数组格式及每个步骤的合法性
function validatePipeline(pipeline) {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return 'pipeline 必须是非空数组';
  }
  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      return `step[${i}]: 必须是普通对象`;
    }
    if (!step.type || typeof step.type !== 'string') {
      return `step[${i}]: 缺少 "type" 字段`;
    }
    if (!VALID_ACTION_TYPES.has(step.type)) {
      return `step[${i}]: 未知类型 "${step.type}"`;
    }
  }
  return null;
}

// 创建并返回 Express Router，注册所有 API 路由
function createRouter({ taskStore, registry, scheduler }) {
  const router = Router();

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
      const tpl = await taskStore.getTemplate(templateName);
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

    logger.info(`任务已添加: ${task.task_id} 模板=${templateName ?? '—'} 数量=${task.count} url=${task.target_url}`);
    scheduler.dispatch();
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
    await Promise.all(taskIds.map(id => taskStore.atomicForceComplete(String(id))));
    for (const { profileName, taskId } of busySlots) {
      registry.sendTo(worker_id, { type: 'stop_task', task_id: taskId, profile: profileName });
      registry.markIdle(worker_id, profileName); // 立即释放，允许接受下一个任务
    }
    logger.info(`停止 Worker [${worker_id}]: 共停止 ${busySlots.length} 个节点`);
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
      await taskStore.atomicForceComplete(String(slot.taskId));
    }
    registry.sendTo(worker_id, { type: 'stop_task', task_id: slot.taskId, profile });
    registry.markIdle(worker_id, profile); // 立即释放
    logger.info(`停止节点 [${worker_id}:${profile}]`);
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

    const allBusy = registry.getSlotsByTaskId(taskId);
    for (const { workerId, profileName } of allBusy) {
      registry.sendTo(workerId, { type: 'stop_task', task_id: taskId, profile: profileName });
    }

    logger.info(`强制停止任务 ${taskId}`);
    return res.json({ ok: true, task });
  });

  // 停止所有正在执行指定 target_url 的节点，并将相关任务标记为完成
  router.post('/api/tasks/stop-by-url', async (req, res) => {
    const { target_url } = req.body ?? {};
    if (!target_url) return res.status(400).json({ error: 'target_url 是必填项' });

    const slots = registry.getSlotsByUrl(target_url);
    const taskIds = [...new Set(slots.map(s => s.taskId).filter(Boolean))];
    await Promise.all(taskIds.map(id => taskStore.atomicForceComplete(id)));

    for (const { workerId, profileName, taskId } of slots) {
      registry.sendTo(workerId, { type: 'stop_task', task_id: taskId, profile: profileName });
    }

    logger.info(`按 URL 停止 [${target_url}]: 停止 ${slots.length} 个节点，涉及 ${taskIds.length} 个任务`);
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
    try { res.json(await taskStore.getAllTemplates()); }
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
      const tpl = await taskStore.setTemplate(name, { description, pipeline, task_time });
      res.json({ ok: true, template: tpl });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // 删除指定模板
  router.delete('/api/templates/:name', async (req, res) => {
    try { await taskStore.deleteTemplate(req.params.name); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── 动作代码分发 ─────────────────────────────────────────────────────────

  // 获取当前自定义动作代码
  router.get('/api/actions', async (_req, res) => {
    try {
      const code = await taskStore.getActionsCode();
      res.json({ code, has_custom: code !== null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 删除自定义代码，所有 Worker 恢复内置动作
  router.delete('/api/actions', async (_req, res) => {
    try {
      await taskStore.setActionsCode(null);
      registry.broadcast({ type: 'reload_actions', code: null });
      logger.info(`动作已重置为内置 — 已广播到 ${registry.workers.size} 个 Worker`);
      return res.json({ ok: true, notified: registry.workers.size });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 上传新的自定义动作代码，语法校验通过后广播到所有 Worker
  // 正在执行任务的 Worker 完成当前步骤后才使用新代码
  router.post('/api/actions', async (req, res) => {
    const { code } = req.body ?? {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'code（字符串）是必填项' });
    }

    // 存储前先做语法检查，避免将破损代码推送给 Worker
    try {
      new vm.Script(code);
    } catch (err) {
      return res.status(400).json({ error: `语法错误: ${err.message}` });
    }

    await taskStore.setActionsCode(code);
    registry.broadcast({ type: 'reload_actions', code });

    logger.info(`动作代码已更新 — 已广播到 ${registry.workers.size} 个 Worker`);
    return res.json({ ok: true, notified: registry.workers.size });
  });

  // ─── 调度器配置 ───────────────────────────────────────────────────────────

  // 获取当前调度模式
  router.get('/api/scheduler/config', (_req, res) => {
    res.json({ dispatch_mode: scheduler.getMode() });
  });

  // 设置调度模式（sequential / random）
  router.post('/api/scheduler/config', (req, res) => {
    const { dispatch_mode } = req.body ?? {};
    if (!dispatch_mode) return res.status(400).json({ error: 'dispatch_mode 是必填项' });
    try {
      scheduler.setMode(dispatch_mode);
      return res.json({ ok: true, dispatch_mode });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // ─── Worker 任务完成通知 ─────────────────────────────────────────────────
  // POST /notify { node_name, status, target_url, task_id? }
  router.post('/notify', (req, res) => {
    const { node_name, status, target_url, task_id } = req.body ?? {};
    if (!node_name || !status) {
      return res.status(400).json({ error: 'node_name 和 status 是必填项' });
    }
    logger.info(`/notify 节点=${node_name} 状态=${status} 任务=${task_id ?? '?'} url=${target_url ?? '?'}`);
    return res.json({ ok: true });
  });

  // 接收 Worker 上报的 Cookie 数据并存储
  router.post('/api/cookies', async (req, res) => {
    const { task_id, profile, cookie } = req.body ?? {};
    if (!profile || !cookie) {
      return res.status(400).json({ error: 'profile 和 cookie 是必填项' });
    }
    try {
      await taskStore.addCookie(String(task_id ?? ''), req.body);
      logger.info(`Cookie 已收集 profile=${profile} uid=${req.body.user_unique_id ?? '—'}`);
      return res.json({ ok: true });
    } catch (err) {
      logger.error(`/api/cookies 错误: ${err.message}`);
      return res.status(500).json({ error: '内部错误' });
    }
  });

  // 接收 Worker 上报的响应拦截数据
  router.post('/api/captures', async (req, res) => {
    const { task_id, profile, data } = req.body ?? {};
    if (!task_id || !profile || data == null) {
      return res.status(400).json({ error: 'task_id、profile、data 均为必填项' });
    }
    try {
      await taskStore.addCapture(String(task_id), req.body);
      logger.info(`数据已捕获 task=${task_id} profile=${profile}`);
      return res.json({ ok: true });
    } catch (err) {
      logger.error(`/api/captures 错误: ${err.message}`);
      return res.status(500).json({ error: '内部错误' });
    }
  });

  // 获取指定任务的所有捕获数据
  router.get('/api/captures/:task_id', async (req, res) => {
    try {
      const captures = await taskStore.getCaptures(req.params.task_id);
      return res.json(captures);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 获取全局 Cookie 列表（按 user_unique_id 去重，最新覆盖）
  router.get('/api/cookies', async (_req, res) => {
    try {
      return res.json(await taskStore.getAllCookies());
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

    // 保留每个 Profile 最近 MAX_SHOTS_PER_PROFILE 张，超出则删除最旧的
    try {
      const existing = fs.readdirSync(SCREENSHOTS_DIR)
        .filter(f => f.startsWith(`${profile}_`) && f.endsWith('.jpg'))
        .sort();
      if (existing.length >= MAX_SHOTS_PER_PROFILE) {
        existing.slice(0, existing.length - MAX_SHOTS_PER_PROFILE + 1).forEach(f => {
          try { fs.unlinkSync(path.join(SCREENSHOTS_DIR, f)); } catch {}
        });
      }
    } catch {}

    const filename = `${profile}_${ts}.jpg`;
    try {
      fs.writeFileSync(path.join(SCREENSHOTS_DIR, filename), req.body);
    } catch (err) {
      logger.error(`截图写入失败: ${err.message}`);
      return res.status(500).json({ error: '内部错误' });
    }

    await taskStore.addScreenshotMeta(filename, { worker_id: workerId, profile, timestamp: ts });
    logger.info(`截图已保存: ${filename} Worker=${workerId}`);
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
      const meta = await taskStore.getScreenshotsMeta(files);
      const list = files.map(f => {
        const m = meta[f] ?? {};
        const parts = f.replace('.jpg', '').split('_');
        const ts = parts.pop();
        return {
          worker_id: m.worker_id ?? '',
          profile  : m.profile   ?? parts.join('_'),
          timestamp: m.timestamp ?? parseInt(ts) ?? 0,
          url      : `/data/screenshots/${f}`,
        };
      });
      return res.json(list);
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

  // ─── 榜单管理 ─────────────────────────────────────────────────────────────

  // 接收 Worker 上报的榜单检查结果
  router.post('/api/ranklist', async (req, res) => {
    const { profile, worker_id } = req.body ?? {};
    if (!profile || !worker_id) {
      return res.status(400).json({ error: 'profile 和 worker_id 是必填项' });
    }
    try {
      await taskStore.addRanklist(req.body);
      return res.json({ ok: true });
    } catch (err) {
      logger.error(`/api/ranklist POST 错误: ${err.message}`);
      return res.status(500).json({ error: '内部错误' });
    }
  });

  // 获取全部榜单记录（供前端展示）
  router.get('/api/ranklist', async (_req, res) => {
    try {
      return res.json(await taskStore.getAllRanklist());
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 触发指定节点执行榜单检查（fire-and-forget）
  router.post('/api/ranklist/check', (req, res) => {
    const { worker_id, profile, task_id } = req.body ?? {};
    if (!worker_id || !profile) {
      return res.status(400).json({ error: 'worker_id 和 profile 是必填项' });
    }
    const sent = registry.sendTo(worker_id, { type: 'run_ranklist', profile, task_id });
    if (!sent) return res.status(404).json({ error: 'Worker 未连接' });
    logger.info(`触发榜单检查 → ${worker_id}:${profile}`);
    return res.json({ ok: true });
  });

  // ─── 状态查询接口 ─────────────────────────────────────────────────────────

  // 获取所有已连接 Worker 的状态摘要
  router.get('/api/workers', (_req, res) => {
    res.json(registry.summary());
  });

  // 获取最近 100 条任务记录
  router.get('/api/tasks', async (_req, res) => {
    try {
      const tasks = await taskStore.getAll(100);
      res.json(tasks);
    } catch (err) {
      logger.error(`/api/tasks 错误: ${err.message}`);
      res.status(500).json({ error: '内部错误' });
    }
  });

  // 获取指定任务详情
  router.get('/api/tasks/:id', async (req, res) => {
    try {
      const task = await taskStore.get(req.params.id);
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
