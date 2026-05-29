/**
 * Task schema:
 * {
 *   task_id:   string,
 *   status:    'pending' | 'running' | 'done',
 *   target_url: string,
 *   task_type: string,
 *   pipeline:  [...],
 *   task_time: number,
 *   count:     number,   // total executions required
 *   running:   number,   // in-flight
 *   completed: number,   // successful
 *   failed:    number,   // error / timeout
 *   created_at: number,
 *   updated_at: number,
 * }
 */
class TaskStore {
  constructor(redis) {
    this.redis = redis;
  }

  async add(raw) {
    const taskId = String(raw.task_id);

    const exists = await this.redis.exists(`task:${taskId}`);
    if (exists) throw new Error(`Task ${taskId} already exists`);

    const now = Date.now();
    const task = {
      task_id: taskId,
      target_url: raw.target_url ?? '',
      task_type: raw.task_type ?? '',
      pipeline: Array.isArray(raw.pipeline) ? raw.pipeline : [],
      task_time: Math.min(Math.max(1, Number(raw.task_time) || 3600), 86400),
      count: Math.max(1, Number(raw.count) || 1),
      running: 0,
      completed: 0,
      failed: 0,
      status: 'pending',
      target_worker_id: raw.target_worker_id ?? null,
      target_node: raw.target_node ?? null,
      created_at: now,
      updated_at: now,
    };

    await this.redis.set(`task:${taskId}`, JSON.stringify(task));
    await this.redis.zadd('tasks:index', now, taskId);
    return task;
  }

  async get(taskId) {
    const raw = await this.redis.get(`task:${String(taskId)}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // Generic non-atomic update — only use for non-concurrent paths (init, resetRunning)
  async update(taskId, patch) {
    const task = await this.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const updated = { ...task, ...patch, updated_at: Date.now() };
    await this.redis.set(`task:${taskId}`, JSON.stringify(updated));
    return updated;
  }

  // ─── atomic operations (Lua scripts) ─────────────────────────────────────
  // Lua scripts are single-threaded in Redis — safe under concurrent callers.

  // Fix ⑤: decrement running, increment completed/failed, update status atomically.
  // Once status is 'done' (e.g. force-stopped), it is never reverted to 'running'.
  async atomicTaskResult(taskId, isSuccess) {
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return false end
      local t = cjson.decode(raw)
      t.running = math.max(0, t.running - 1)
      if ARGV[1] == '1' then
        t.completed = t.completed + 1
      else
        t.failed = t.failed + 1
      end
      if t.status ~= 'done' then
        local total = t.completed + t.failed
        if total >= t.count then
          t.status = 'done'
        else
          t.status = 'running'
        end
      end
      t.updated_at = tonumber(ARGV[2])
      redis.call('SET', KEYS[1], cjson.encode(t))
      return cjson.encode(t)
    `;
    const result = await this.redis.eval(
      script, 1, `task:${taskId}`,
      isSuccess ? '1' : '0',
      String(Date.now())
    );
    if (!result) return null;
    try { return JSON.parse(result); } catch { return null; }
  }

  // Fix ⑧: decrement running without marking failed — used when worker disconnects
  // so the instance can be re-dispatched rather than counted as a failure
  async atomicDecrementRunning(taskId) {
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return false end
      local t = cjson.decode(raw)
      t.running = math.max(0, t.running - 1)
      t.updated_at = tonumber(ARGV[1])
      redis.call('SET', KEYS[1], cjson.encode(t))
      return cjson.encode(t)
    `;
    const result = await this.redis.eval(
      script, 1, `task:${taskId}`, String(Date.now())
    );
    if (!result) return null;
    try { return JSON.parse(result); } catch { return null; }
  }

  // Fix ⑤: increment running count atomically — used by scheduler on dispatch
  async atomicIncrementRunning(taskId, count) {
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return false end
      local t = cjson.decode(raw)
      t.running = t.running + tonumber(ARGV[1])
      t.status = 'running'
      t.updated_at = tonumber(ARGV[2])
      redis.call('SET', KEYS[1], cjson.encode(t))
      return cjson.encode(t)
    `;
    const result = await this.redis.eval(
      script, 1, `task:${taskId}`,
      String(count), String(Date.now())
    );
    if (!result) return null;
    try { return JSON.parse(result); } catch { return null; }
  }

  // Atomically adjust task_time by delta seconds (clamped to >= 0).
  // Returns the updated task, or null if not found.
  async atomicAdjustTaskTime(taskId, delta) {
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return false end
      local t = cjson.decode(raw)
      t.task_time = math.min(math.max(1, t.task_time + tonumber(ARGV[1])), 86400)
      t.updated_at = tonumber(ARGV[2])
      redis.call('SET', KEYS[1], cjson.encode(t))
      return cjson.encode(t)
    `;
    const result = await this.redis.eval(
      script, 1, `task:${taskId}`,
      String(delta), String(Date.now())
    );
    if (!result) return null;
    try { return JSON.parse(result); } catch { return null; }
  }

  // Mark a task as done immediately (used by stop-by-url).
  // Sets status='done' so the scheduler stops dispatching new slots.
  // In-flight instances will still report back via task_result (which is harmless).
  async atomicForceComplete(taskId) {
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return false end
      local t = cjson.decode(raw)
      t.status = 'done'
      t.updated_at = tonumber(ARGV[1])
      redis.call('SET', KEYS[1], cjson.encode(t))
      return cjson.encode(t)
    `;
    const result = await this.redis.eval(
      script, 1, `task:${taskId}`, String(Date.now())
    );
    if (!result) return null;
    try { return JSON.parse(result); } catch { return null; }
  }

  // ─── pipeline templates ───────────────────────────────────────────────────
  // Templates are stored as: template:{name} (JSON) + templates:index (ZSet)
  // Use "{target_url}" in pipeline steps as a placeholder — resolved at dispatch time.

  async getTemplate(name) {
    const raw = await this.redis.get(`template:${name}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async setTemplate(name, data) {
    const existing = await this.getTemplate(name);
    const now = Date.now();
    const tpl = {
      name,
      description: data.description ?? '',
      pipeline: data.pipeline,
      task_time: data.task_time != null ? Number(data.task_time) : null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.redis.set(`template:${name}`, JSON.stringify(tpl));
    await this.redis.zadd('templates:index', tpl.created_at, name);
    return tpl;
  }

  async deleteTemplate(name) {
    await this.redis.del(`template:${name}`);
    await this.redis.zrem('templates:index', name);
  }

  async getAllTemplates() {
    const names = await this.redis.zrevrange('templates:index', 0, -1);
    if (!names.length) return [];
    const items = await Promise.all(names.map(n => this.getTemplate(n)));
    return items.filter(Boolean);
  }

  // ─── actions code store ───────────────────────────────────────────────────

  async getActionsCode() {
    return this.redis.get('actions:code'); // raw string, null if never set
  }

  async setActionsCode(code) {
    await this.redis.set('actions:code', code);
  }

  // ─── cookie collection ────────────────────────────────────────────────────

  async addCookie(taskId, data) {
    const key = `cookies:task:${taskId}`;
    await this.redis.lpush(key, JSON.stringify(data));
    await this.redis.expire(key, 86400);
  }

  async getCookies(taskId) {
    const items = await this.redis.lrange(`cookies:task:${taskId}`, 0, -1);
    return items.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);
  }

  // ─── queries ──────────────────────────────────────────────────────────────

  async getDispatchable() {
    const ids = await this.redis.zrange('tasks:index', 0, 199);
    if (ids.length === 0) return [];
    const tasks = await Promise.all(ids.map(id => this.get(id)));
    return tasks.filter(t => {
      if (!t || t.status === 'done') return false;
      const remaining = t.count - t.running - t.completed - t.failed;
      return remaining > 0;
    });
  }

  async getAll(limit = 50) {
    const ids = await this.redis.zrevrange('tasks:index', 0, limit - 1);
    if (ids.length === 0) return [];
    const tasks = await Promise.all(ids.map(id => this.get(id)));
    return tasks.filter(Boolean);
  }

  // On gateway restart: reset in-flight counts so tasks can be re-dispatched
  async resetRunning() {
    const ids = await this.redis.zrange('tasks:index', 0, -1);
    for (const id of ids) {
      const task = await this.get(id);
      if (!task || task.running === 0) continue;
      await this.update(id, {
        running: 0,
        status: task.completed + task.failed > 0 ? 'running' : 'pending',
      });
    }
  }

  // Fix ⑨: remove done tasks older than maxAgeSec from the sorted index
  async pruneCompleted(maxAgeSec = 86400) {
    const cutoff = Date.now() - maxAgeSec * 1000;
    const oldIds = await this.redis.zrangebyscore('tasks:index', '-inf', cutoff);
    if (oldIds.length === 0) return 0;

    let pruned = 0;
    for (const id of oldIds) {
      const task = await this.get(id);
      if (!task || task.status !== 'done') continue;
      await this.redis.zrem('tasks:index', id);
      pruned++;
    }
    return pruned;
  }
}

module.exports = TaskStore;
