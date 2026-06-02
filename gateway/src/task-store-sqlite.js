const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../../data/dcmw.db');

class TaskStoreSQLite {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id    TEXT    PRIMARY KEY,
        data       TEXT    NOT NULL,
        status     TEXT    NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        is_active  INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS templates (
        name       TEXT    PRIMARY KEY,
        data       TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS actions_code (
        id   INTEGER PRIMARY KEY CHECK (id = 1),
        code TEXT
      );
      CREATE TABLE IF NOT EXISTS cookies (
        uid       TEXT    PRIMARY KEY,
        data      TEXT    NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS captures (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    TEXT    NOT NULL,
        data       TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS screenshots_meta (
        filename TEXT PRIMARY KEY,
        data     TEXT NOT NULL
      );
    `);
  }

  // ─── tasks ────────────────────────────────────────────────────────────────

  async add(raw) {
    const taskId = String(raw.task_id);
    const exists = this.db.prepare('SELECT 1 FROM tasks WHERE task_id = ?').get(taskId);
    if (exists) throw new Error(`Task ${taskId} already exists`);

    const now = Date.now();
    const task = {
      task_id: taskId,
      target_url: raw.target_url ?? '',
      task_type: raw.task_type ?? '',
      pipeline: Array.isArray(raw.pipeline) ? raw.pipeline : [],
      task_time: Math.min(Math.max(1, Number(raw.task_time) || 3600), 86400),
      count: Math.max(1, Number(raw.count) || 1),
      running: 0, completed: 0, failed: 0,
      status: 'pending',
      target_worker_id:  raw.target_worker_id ?? null,
      target_worker_ids: Array.isArray(raw.target_worker_ids) && raw.target_worker_ids.length ? raw.target_worker_ids : null,
      target_node:       raw.target_node ?? null,
      created_at: now,
      updated_at: now,
    };
    this.db.prepare(
      'INSERT INTO tasks (task_id, data, status, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(taskId, JSON.stringify(task), task.status, now, now);
    return task;
  }

  async get(taskId) {
    const row = this.db.prepare('SELECT data FROM tasks WHERE task_id = ?').get(String(taskId));
    if (!row) return null;
    try { return JSON.parse(row.data); } catch { return null; }
  }

  async update(taskId, patch) {
    const task = await this.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const updated = { ...task, ...patch, updated_at: Date.now() };
    this.db.prepare('UPDATE tasks SET data = ?, status = ?, updated_at = ? WHERE task_id = ?')
      .run(JSON.stringify(updated), updated.status, updated.updated_at, String(taskId));
    return updated;
  }

  // ─── atomic operations（SQLite 事务替代 Lua 脚本）────────────────────────

  async atomicTaskResult(taskId, isSuccess) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT data FROM tasks WHERE task_id = ?').get(String(taskId));
      if (!row) return null;
      const t = JSON.parse(row.data);
      t.running = Math.max(0, t.running - 1);
      if (isSuccess) t.completed++; else t.failed++;
      if (t.status !== 'done') {
        if (t.completed + t.failed >= t.count) {
          t.status = 'done';
          this.db.prepare('UPDATE tasks SET is_active = 0 WHERE task_id = ?').run(String(taskId));
        } else {
          t.status = 'running';
        }
      }
      t.updated_at = Date.now();
      this.db.prepare('UPDATE tasks SET data = ?, status = ?, updated_at = ? WHERE task_id = ?')
        .run(JSON.stringify(t), t.status, t.updated_at, String(taskId));
      return t;
    })();
  }

  async atomicDecrementRunning(taskId) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT data FROM tasks WHERE task_id = ?').get(String(taskId));
      if (!row) return null;
      const t = JSON.parse(row.data);
      t.running = Math.max(0, t.running - 1);
      t.updated_at = Date.now();
      this.db.prepare('UPDATE tasks SET data = ?, updated_at = ? WHERE task_id = ?')
        .run(JSON.stringify(t), t.updated_at, String(taskId));
      return t;
    })();
  }

  async atomicIncrementRunning(taskId, count) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT data FROM tasks WHERE task_id = ?').get(String(taskId));
      if (!row) return null;
      const t = JSON.parse(row.data);
      t.running += count;
      t.status = 'running';
      t.updated_at = Date.now();
      this.db.prepare('UPDATE tasks SET data = ?, status = ?, updated_at = ? WHERE task_id = ?')
        .run(JSON.stringify(t), t.status, t.updated_at, String(taskId));
      return t;
    })();
  }

  async atomicAdjustTaskTime(taskId, delta) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT data FROM tasks WHERE task_id = ?').get(String(taskId));
      if (!row) return null;
      const t = JSON.parse(row.data);
      t.task_time = Math.min(Math.max(1, t.task_time + delta), 86400);
      t.updated_at = Date.now();
      this.db.prepare('UPDATE tasks SET data = ?, updated_at = ? WHERE task_id = ?')
        .run(JSON.stringify(t), t.updated_at, String(taskId));
      return t;
    })();
  }

  async atomicForceComplete(taskId) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT data FROM tasks WHERE task_id = ?').get(String(taskId));
      if (!row) return null;
      const t = JSON.parse(row.data);
      t.status = 'done';
      t.updated_at = Date.now();
      this.db.prepare('UPDATE tasks SET data = ?, status = ?, updated_at = ?, is_active = 0 WHERE task_id = ?')
        .run(JSON.stringify(t), t.status, t.updated_at, String(taskId));
      return t;
    })();
  }

  // ─── templates ────────────────────────────────────────────────────────────

  async getTemplate(name) {
    const row = this.db.prepare('SELECT data FROM templates WHERE name = ?').get(name);
    if (!row) return null;
    try { return JSON.parse(row.data); } catch { return null; }
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
    this.db.prepare(
      'INSERT INTO templates (name, data, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data'
    ).run(name, JSON.stringify(tpl), tpl.created_at);
    return tpl;
  }

  async deleteTemplate(name) {
    this.db.prepare('DELETE FROM templates WHERE name = ?').run(name);
  }

  async getAllTemplates() {
    const rows = this.db.prepare('SELECT data FROM templates ORDER BY created_at DESC').all();
    return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
  }

  // ─── actions code ─────────────────────────────────────────────────────────

  async getActionsCode() {
    const row = this.db.prepare('SELECT code FROM actions_code WHERE id = 1').get();
    return row?.code ?? null;
  }

  async setActionsCode(code) {
    if (code === null || code === undefined) {
      this.db.prepare('DELETE FROM actions_code WHERE id = 1').run();
    } else {
      this.db.prepare('INSERT INTO actions_code (id, code) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET code = excluded.code').run(code);
    }
  }

  // ─── cookies ──────────────────────────────────────────────────────────────

  async addCookie(taskId, data) {
    const uid = data.user_unique_id || `_nuid_${data.profile}`;
    const payload = { ...data, task_id: taskId };
    this.db.prepare(
      'INSERT INTO cookies (uid, data, timestamp) VALUES (?, ?, ?) ON CONFLICT(uid) DO UPDATE SET data = excluded.data, timestamp = excluded.timestamp'
    ).run(uid, JSON.stringify(payload), data.timestamp || Date.now());
  }

  async getAllCookies() {
    const rows = this.db.prepare('SELECT data FROM cookies ORDER BY timestamp DESC').all();
    return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
  }

  // ─── captures ─────────────────────────────────────────────────────────────

  async addCapture(taskId, data) {
    this.db.prepare('INSERT INTO captures (task_id, data, created_at) VALUES (?, ?, ?)').run(taskId, JSON.stringify(data), Date.now());
  }

  async getCaptures(taskId) {
    const rows = this.db.prepare('SELECT data FROM captures WHERE task_id = ? ORDER BY created_at DESC').all(taskId);
    return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
  }

  // ─── screenshots meta ─────────────────────────────────────────────────────

  async addScreenshotMeta(filename, data) {
    this.db.prepare('INSERT INTO screenshots_meta (filename, data) VALUES (?, ?) ON CONFLICT(filename) DO UPDATE SET data = excluded.data').run(filename, JSON.stringify(data));
  }

  async getScreenshotsMeta(filenames) {
    if (!filenames.length) return {};
    const placeholders = filenames.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT filename, data FROM screenshots_meta WHERE filename IN (${placeholders})`).all(...filenames);
    const out = {};
    for (const row of rows) {
      try { out[row.filename] = JSON.parse(row.data); } catch {}
    }
    return out;
  }

  // ─── queries ──────────────────────────────────────────────────────────────

  async getDispatchable() {
    const rows = this.db.prepare("SELECT data FROM tasks WHERE is_active = 1 AND status != 'done'").all();
    return rows
      .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
      .filter(t => t && t.count - t.running - t.completed - t.failed > 0);
  }

  async getAll(limit = 50) {
    const rows = this.db.prepare('SELECT data FROM tasks ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
  }

  async resetRunning() {
    const rows = this.db.prepare("SELECT task_id, data FROM tasks WHERE status != 'done'").all();
    for (const row of rows) {
      const task = JSON.parse(row.data);
      if (task.running === 0) continue;
      task.running = 0;
      task.status = task.completed + task.failed > 0 ? 'running' : 'pending';
      task.updated_at = Date.now();
      this.db.prepare('UPDATE tasks SET data = ?, status = ?, updated_at = ? WHERE task_id = ?')
        .run(JSON.stringify(task), task.status, task.updated_at, row.task_id);
    }
  }

  async pruneCompleted(maxAgeSec = 86400) {
    const cutoff = Date.now() - maxAgeSec * 1000;
    const result = this.db.prepare("DELETE FROM tasks WHERE status = 'done' AND created_at < ?").run(cutoff);
    return result.changes;
  }
}

module.exports = TaskStoreSQLite;
