const { Router } = require('express');
const vm = require('vm');
const logger = require('./logger');

const VALID_ACTION_TYPES = new Set([
  'navigate','open','goto','reload',
  'wait','dwell',
  'click','dblclick','hover','scroll','mousemove','mousedown','mouseup',
  'rtcookie',
  'eval','run-code',
  'close',
]);

function validatePipeline(pipeline) {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return 'pipeline must be a non-empty array';
  }
  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      return `step[${i}]: must be a plain object`;
    }
    if (!step.type || typeof step.type !== 'string') {
      return `step[${i}]: missing "type" field`;
    }
    if (!VALID_ACTION_TYPES.has(step.type)) {
      return `step[${i}]: unknown type "${step.type}"`;
    }
  }
  return null;
}

function createRouter({ taskStore, registry, scheduler }) {
  const router = Router();

  // ─── task submission ──────────────────────────────────────────────────────

  router.post('/task/add', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'request body must be JSON' });
    }

    const { target_url } = body;
    // task_type and template are both valid for template lookup
    const templateName = body.template ?? body.task_type ?? null;
    if (!target_url) return res.status(400).json({ error: 'target_url is required' });

    // Auto-generate task_id if not provided — prevents duplicate errors on repeated submits.
    const task_id = body.task_id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    let pipeline = body.pipeline;
    let task_time = body.task_time;

    // Resolve named template → pipeline + task_time defaults.
    // Use "{target_url}" in pipeline navigate steps as a placeholder.
    if (templateName) {
      const tpl = await taskStore.getTemplate(templateName);
      if (!tpl) return res.status(404).json({ error: `Template "${templateName}" not found` });
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

    // Check count vs available idle slots
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
      logger.error(`/task/add error: ${err.message}`);
      return res.status(500).json({ error: 'internal error' });
    }

    logger.info(`Task added: ${task.task_id} tpl=${templateName ?? '—'} count=${task.count} url=${task.target_url}`);
    scheduler.dispatch();
    return res.status(201).json({ ok: true, task });
  });

  // ─── Worker / Node level control ─────────────────────────────────────────

  // POST /api/workers/:worker_id/stop — stop all busy nodes on a worker
  router.post('/api/workers/:worker_id/stop', async (req, res) => {
    const { worker_id } = req.params;
    if (!registry.workers.has(worker_id)) {
      return res.status(404).json({ error: 'worker not found' });
    }
    const busySlots = registry.getBusySlots(worker_id);
    const taskIds = [...new Set(busySlots.map(s => s.taskId).filter(Boolean))];
    await Promise.all(taskIds.map(id => taskStore.atomicForceComplete(String(id))));
    for (const { profileName, taskId } of busySlots) {
      registry.sendTo(worker_id, { type: 'stop_task', task_id: taskId, profile: profileName });
    }
    logger.info(`stop-worker [${worker_id}]: stopped ${busySlots.length} node(s)`);
    return res.json({ ok: true, stopped: busySlots.length });
  });

  // POST /api/workers/:worker_id/nodes/:profile/stop — stop a single node
  router.post('/api/workers/:worker_id/nodes/:profile/stop', async (req, res) => {
    const { worker_id, profile } = req.params;
    const w = registry.workers.get(worker_id);
    if (!w) return res.status(404).json({ error: 'worker not found' });
    const slot = w.profiles.get(profile);
    if (!slot) return res.status(404).json({ error: 'profile not found' });
    if (slot.state !== 'busy') return res.status(400).json({ error: 'node is not busy' });
    if (slot.taskId) {
      await taskStore.atomicForceComplete(String(slot.taskId));
    }
    registry.sendTo(worker_id, { type: 'stop_task', task_id: slot.taskId, profile });
    logger.info(`stop-node [${worker_id}:${profile}]`);
    return res.json({ ok: true });
  });

  // ─── URL-level control APIs ───────────────────────────────────────────────

  // GET /api/tasks/by-url?url=https://...
  // Returns all running slots and their task data for the given target_url.
  router.get('/api/tasks/by-url', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'url query param is required' });

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

  // POST /api/tasks/:id/stop
  // Force-completes a task by ID regardless of whether any slots are currently running.
  router.post('/api/tasks/:id/stop', async (req, res) => {
    const taskId = req.params.id;
    const task = await taskStore.atomicForceComplete(taskId);
    if (!task) return res.status(404).json({ error: 'task not found' });

    // Also notify any in-flight slots on this task to stop immediately.
    const allBusy = registry.getSlotsByTaskId(taskId);
    for (const { workerId, profileName } of allBusy) {
      registry.sendTo(workerId, { type: 'stop_task', task_id: taskId, profile: profileName });
    }

    logger.info(`force-stop task ${taskId}`);
    return res.json({ ok: true, task });
  });

  // POST /api/tasks/stop-by-url { target_url }
  // Stops all nodes currently executing the given target_url and marks their tasks done.
  router.post('/api/tasks/stop-by-url', async (req, res) => {
    const { target_url } = req.body ?? {};
    if (!target_url) return res.status(400).json({ error: 'target_url is required' });

    const slots = registry.getSlotsByUrl(target_url);
    const taskIds = [...new Set(slots.map(s => s.taskId).filter(Boolean))];
    await Promise.all(taskIds.map(id => taskStore.atomicForceComplete(id)));

    for (const { workerId, profileName, taskId } of slots) {
      registry.sendTo(workerId, { type: 'stop_task', task_id: taskId, profile: profileName });
    }

    logger.info(`stop-by-url [${target_url}]: stopped ${slots.length} node(s) across ${taskIds.length} task(s)`);
    return res.json({ ok: true, stopped: slots.length, tasks: taskIds });
  });

  // POST /api/tasks/adjust-time { target_url, delta }
  // delta > 0 adds seconds, delta < 0 subtracts. Applies to all running tasks for the URL
  // and notifies each worker node in real time.
  router.post('/api/tasks/adjust-time', async (req, res) => {
    const { target_url, delta } = req.body ?? {};
    if (!target_url) return res.status(400).json({ error: 'target_url is required' });
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      return res.status(400).json({ error: 'delta must be a finite number (seconds)' });
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

    logger.info(`adjust-time [${target_url}] delta=${delta}s: notified ${slots.length} node(s)`);
    return res.json({ ok: true, updated: slots.length, tasks: updatedTasks });
  });

  // ─── pipeline templates ───────────────────────────────────────────────────

  router.get('/api/templates', async (_req, res) => {
    try { res.json(await taskStore.getAllTemplates()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/api/templates', async (req, res) => {
    const { name, description, pipeline, task_time } = req.body ?? {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
    const pipelineError = validatePipeline(pipeline);
    if (pipelineError) {
      return res.status(400).json({ error: pipelineError });
    }
    try {
      const tpl = await taskStore.setTemplate(name, { description, pipeline, task_time });
      res.json({ ok: true, template: tpl });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/api/templates/:name', async (req, res) => {
    try { await taskStore.deleteTemplate(req.params.name); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── actions code distribution ────────────────────────────────────────────

  // GET /api/actions → { code: string|null, has_custom: bool }
  router.get('/api/actions', async (_req, res) => {
    try {
      const code = await taskStore.getActionsCode();
      res.json({ code, has_custom: code !== null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/actions — remove custom code, revert all workers to built-in actions.
  router.delete('/api/actions', async (_req, res) => {
    try {
      await taskStore.setActionsCode(null);
      registry.broadcast({ type: 'reload_actions', code: null });
      logger.info(`Actions reset to built-in — broadcast to ${registry.workers.size} worker(s)`);
      return res.json({ ok: true, notified: registry.workers.size });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/actions  body: { code: string }
  // Saves new actions.js code, syntax-checks it, then broadcasts reload to all workers.
  // Workers that are mid-task finish with their current code; new steps use the new code.
  router.post('/api/actions', async (req, res) => {
    const { code } = req.body ?? {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'code (string) is required' });
    }

    // Syntax-check before storing so we don't push broken code to workers.
    try {
      new vm.Script(code);
    } catch (err) {
      return res.status(400).json({ error: `Syntax error: ${err.message}` });
    }

    await taskStore.setActionsCode(code);
    registry.broadcast({ type: 'reload_actions', code });

    logger.info(`Actions code updated — broadcast to ${registry.workers.size} worker(s)`);
    return res.json({ ok: true, notified: registry.workers.size });
  });

  // ─── scheduler config ─────────────────────────────────────────────────────

  // GET /api/scheduler/config → { dispatch_mode: 'sequential'|'random' }
  router.get('/api/scheduler/config', (_req, res) => {
    res.json({ dispatch_mode: scheduler.getMode() });
  });

  // POST /api/scheduler/config { dispatch_mode: 'sequential'|'random' }
  router.post('/api/scheduler/config', (req, res) => {
    const { dispatch_mode } = req.body ?? {};
    if (!dispatch_mode) return res.status(400).json({ error: 'dispatch_mode is required' });
    try {
      scheduler.setMode(dispatch_mode);
      return res.json({ ok: true, dispatch_mode });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // ─── worker task completion notify ───────────────────────────────────────
  // POST /notify { node_name, status, target_url, task_id? }
  router.post('/notify', (req, res) => {
    const { node_name, status, target_url, task_id } = req.body ?? {};
    if (!node_name || !status) {
      return res.status(400).json({ error: 'node_name and status are required' });
    }
    logger.info(`/notify node=${node_name} status=${status} task=${task_id ?? '?'} url=${target_url ?? '?'}`);
    return res.json({ ok: true });
  });

  // POST /api/cookies  { profile, task_id, pattern, matched_url, cookie, timestamp }
  router.post('/api/cookies', async (req, res) => {
    const { task_id, profile, cookie } = req.body ?? {};
    if (!task_id || !profile || !cookie) {
      return res.status(400).json({ error: 'task_id, profile, cookie are required' });
    }
    try {
      await taskStore.addCookie(String(task_id), req.body);
      logger.info(`cookie collected task=${task_id} profile=${profile}`);
      return res.json({ ok: true });
    } catch (err) {
      logger.error(`/api/cookies error: ${err.message}`);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  // GET /api/cookies/:task_id
  router.get('/api/cookies/:task_id', async (req, res) => {
    try {
      const cookies = await taskStore.getCookies(req.params.task_id);
      return res.json(cookies);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ─── status APIs ──────────────────────────────────────────────────────────

  router.get('/api/workers', (_req, res) => {
    res.json(registry.summary());
  });

  router.get('/api/tasks', async (_req, res) => {
    try {
      const tasks = await taskStore.getAll(100);
      res.json(tasks);
    } catch (err) {
      logger.error(`/api/tasks error: ${err.message}`);
      res.status(500).json({ error: 'internal error' });
    }
  });

  router.get('/api/tasks/:id', async (req, res) => {
    try {
      const task = await taskStore.get(req.params.id);
      if (!task) return res.status(404).json({ error: 'not found' });
      res.json(task);
    } catch (err) {
      logger.error(`/api/tasks/:id error: ${err.message}`);
      res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}

module.exports = { createRouter };
