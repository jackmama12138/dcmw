const WebSocket = require('ws');

// Fix ⑧: profiles now store { state, taskId, targetUrl } so we can:
//   - recover in-flight tasks on worker disconnect
//   - query / control by target URL
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

  register(workerId, ws, profileNames) {
    if (!workerId || !ws) return;
    if (this.workers.has(workerId)) {
      this.workers.delete(workerId);
    }
    const profiles = new Map(
      profileNames.map(n => [n, { state: 'idle', taskId: null, targetUrl: null }])
    );
    this.workers.set(workerId, { ws, profiles, lastHeartbeat: Date.now() });
  }

  remove(workerId) {
    this.workers.delete(workerId);
  }

  updateHeartbeat(workerId) {
    const w = this.workers.get(workerId);
    if (w) w.lastHeartbeat = Date.now();
  }

  markBusy(workerId, profileName, taskId = null, targetUrl = null) {
    this.workers.get(workerId)?.profiles.set(profileName, { state: 'busy', taskId, targetUrl });
  }

  markIdle(workerId, profileName) {
    this.workers.get(workerId)?.profiles.set(profileName, { state: 'idle', taskId: null, targetUrl: null });
  }

  // Returns all busy slots whose targetUrl matches. Used for URL-level control APIs.
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

  getIdleSlots() {
    const slots = [];
    for (const [workerId, { ws, profiles }] of this.workers) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      for (const [profileName, { state }] of profiles) {
        if (state === 'idle') slots.push({ workerId, profileName });
      }
    }
    return slots;
  }

  // Fix ⑧: returns all busy profiles for a worker, with their associated taskId
  getBusySlots(workerId) {
    const w = this.workers.get(workerId);
    if (!w) return [];
    const busy = [];
    for (const [profileName, { state, taskId, targetUrl }] of w.profiles) {
      if (state === 'busy') busy.push({ profileName, taskId, targetUrl });
    }
    return busy;
  }

  // Fix ⑦: returns workers whose lastHeartbeat is older than timeoutMs
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

  // Broadcast a message to every connected worker.
  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const { ws } of this.workers.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch {}
      }
    }
  }

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

  summary() {
    return [...this.workers.entries()].map(([workerId, { ws, profiles, lastHeartbeat }]) => {
      const stats = { idle: 0, busy: 0, total: profiles.size };
      const slotList = [];
      for (const [profileName, { state, taskId, targetUrl }] of profiles) {
        stats[state] = (stats[state] ?? 0) + 1;
        slotList.push({ profileName, state, taskId, targetUrl });
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
