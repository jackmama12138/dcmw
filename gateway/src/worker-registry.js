const WebSocket = require('ws');

// profiles 存储结构：{ state, taskId, targetUrl }
// 支持 Worker 断线时恢复进行中任务，以及按 URL 查询和控制
//
// Map<workerId, {
//   ws: WebSocket,
//   profiles: Map<profileName, { state: 'idle'|'busy', taskId: string|null, targetUrl: string|null }>,
//   lastHeartbeat: number
// }>

class WorkerRegistry {
  constructor() {
    this.workers = new Map();
  }

  // 注册 Worker 及其 Profile 列表（已存在则先删除旧记录）
  register(workerId, ws, profileNames, schemas = {}) {
    if (!workerId || !ws) return;
    if (this.workers.has(workerId)) {
      this.workers.delete(workerId);
    }
    const profiles = new Map(
      profileNames.map(n => [n, { state: 'idle', taskId: null, targetUrl: null }])
    );
    this.workers.set(workerId, { ws, profiles, schemas, lastHeartbeat: Date.now() });
  }

  // 合并所有在线 Worker 上报的插件 schemas
  getSchemas() {
    const merged = {};
    for (const { ws, schemas } of this.workers.values()) {
      if (ws.readyState === 1 && schemas) Object.assign(merged, schemas);
    }
    return merged;
  }

  // 从注册表中移除 Worker
  remove(workerId) {
    this.workers.delete(workerId);
  }

  // 更新心跳时间戳，并同步各 Profile 的当前页面 URL 和标题
  updateHeartbeat(workerId, profileInfo = {}) {
    const w = this.workers.get(workerId);
    if (!w) return;
    w.lastHeartbeat = Date.now();
    for (const [profileName, info] of Object.entries(profileInfo)) {
      const slot = w.profiles.get(profileName);
      if (!slot) continue;

      // 更新实时页面状态
      if (info.url   !== undefined) slot.currentUrl   = info.url   || null;
      if (info.title !== undefined) slot.currentTitle = info.title || null;

      // gateway 重启后 slot 被初始化为 idle，但 worker 仍在执行任务
      // 心跳携带 task_id + state=busy 时自动恢复映射
      if (info.state === 'busy' && info.task_id && slot.state === 'idle') {
        slot.state     = 'busy';
        slot.taskId    = info.task_id;
        slot.targetUrl = info.target_url || null;
      }
    }
  }

  // 将指定 Profile 槽位标记为繁忙，并记录关联的 taskId 和 targetUrl
  markBusy(workerId, profileName, taskId = null, targetUrl = null) {
    this.workers.get(workerId)?.profiles.set(profileName, { state: 'busy', taskId, targetUrl });
  }

  // 将指定 Profile 槽位标记为空闲并清除冷却时间
  markIdle(workerId, profileName) {
    this.workers.get(workerId)?.profiles.set(profileName, { state: 'idle', taskId: null, targetUrl: null, cooldownUntil: 0 });
  }

  // 标记为空闲但在 cooldownMs 内暂不调度，用于 slot_busy 拒绝后的冷却恢复
  markIdleWithCooldown(workerId, profileName, cooldownMs) {
    const slot = this.workers.get(workerId)?.profiles.get(profileName);
    if (!slot) return;
    slot.state = 'idle';
    slot.taskId = null;
    slot.targetUrl = null;
    slot.cooldownUntil = Date.now() + cooldownMs;
  }

  // 返回所有正在执行指定 taskId 的槽位列表
  getSlotsByTaskId(taskId) {
    const tid = String(taskId);
    const slots = [];
    for (const [workerId, { profiles }] of this.workers) {
      for (const [profileName, { state, taskId: slotTaskId }] of profiles) {
        if (state === 'busy' && String(slotTaskId) === tid) {
          slots.push({ workerId, profileName });
        }
      }
    }
    return slots;
  }

  // 返回所有正在执行指定 targetUrl 的槽位列表（用于 URL 级别控制接口）
  getSlotsByUrl(targetUrl) {
    const slots = [];
    for (const [workerId, { profiles }] of this.workers) {
      for (const [profileName, { state, taskId, targetUrl: slotUrl }] of profiles) {
        if (state === 'busy' && slotUrl === targetUrl) {
          slots.push({ workerId, profileName, taskId });
        }
      }
    }
    return slots;
  }

  // 返回所有连接正常且冷却期已过的空闲槽位
  getIdleSlots() {
    const now = Date.now();
    const slots = [];
    for (const [workerId, { ws, profiles }] of this.workers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      for (const [profileName, { state, cooldownUntil }] of profiles) {
        if (state === 'idle' && (!cooldownUntil || now >= cooldownUntil)) {
          slots.push({ workerId, profileName });
        }
      }
    }
    return slots;
  }

  // 返回指定 Worker 上所有繁忙槽位及其关联的 taskId
  getBusySlots(workerId) {
    const w = this.workers.get(workerId);
    if (!w) return [];
    const busy = [];
    for (const [profileName, { state, taskId, targetUrl }] of w.profiles) {
      if (state === 'busy') busy.push({ profileName, taskId, targetUrl });
    }
    return busy;
  }

  // 返回心跳超时（lastHeartbeat 超过 timeoutMs）的 Worker 列表
  getStaleWorkers(timeoutMs) {
    const now = Date.now();
    const stale = [];
    for (const [workerId, w] of this.workers) {
      if (now - w.lastHeartbeat > timeoutMs) {
        stale.push({ workerId, ws: w.ws });
      }
    }
    return stale;
  }

  // 向所有已连接 Worker 广播消息
  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const { ws } of this.workers.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch {}
      }
    }
  }

  // 向指定 Worker 发送消息，返回是否发送成功
  sendTo(workerId, data) {
    const w = this.workers.get(workerId);
    if (!w || w.ws.readyState !== WebSocket.OPEN) return false;
    try {
      w.ws.send(JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  // 生成所有 Worker 的状态摘要（供前端展示）
  summary() {
    return [...this.workers.entries()].map(([workerId, { ws, profiles, lastHeartbeat }]) => {
      const stats = { idle: 0, busy: 0, total: profiles.size };
      const slotList = [];
      for (const [profileName, s] of profiles) {
        const { state, taskId, targetUrl, currentUrl, currentTitle } = s;
        stats[state] = (stats[state] ?? 0) + 1;
        slotList.push({ profileName, state, taskId, targetUrl, currentUrl: currentUrl ?? null, currentTitle: currentTitle ?? null });
      }
      return {
        workerId,
        slots: stats,
        profiles: slotList,
        lastHeartbeat,
        connected: ws.readyState === WebSocket.OPEN,
      };
    });
  }
}

module.exports = WorkerRegistry;
