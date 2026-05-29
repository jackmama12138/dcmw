const logger = require('./logger');

const MODES = ['sequential', 'random'];

// Sequential: interleave slots round-robin across workers.
// For W1(P1,P2,P3), W2(P1,P2), W3(P1) →
//   [W1:P1, W2:P1, W3:P1, W1:P2, W2:P2, W1:P3]
// Ensures tasks spread across machines before filling one machine.
function interleaveByWorker(slots) {
  const byWorker = new Map();
  for (const slot of slots) {
    if (!byWorker.has(slot.workerId)) byWorker.set(slot.workerId, []);
    byWorker.get(slot.workerId).push(slot);
  }
  const result = [];
  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const workerSlots of byWorker.values()) {
      if (workerSlots.length > 0) {
        result.push(workerSlots.shift());
        hasMore = true;
      }
    }
  }
  return result;
}

// Random: Fisher-Yates shuffle — no bias toward any worker.
function shuffleSlots(slots) {
  const arr = [...slots];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class Scheduler {
  constructor({ taskStore, registry }) {
    this._taskStore = taskStore;
    this._registry = registry;
    this._dispatching = false;
    this._pendingDispatch = false; // Fix ⑥
    this._mode = 'sequential';    // 'sequential' | 'random'
  }

  getMode() {
    return this._mode;
  }

  setMode(mode) {
    if (!MODES.includes(mode)) {
      throw new Error(`Invalid dispatch mode "${mode}". Valid: ${MODES.join(', ')}`);
    }
    this._mode = mode;
    logger.info(`Dispatch mode → ${mode}`);
  }

  // Fix ⑥: if a dispatch is already running, mark pending instead of dropping.
  // After the current run finishes, drain the pending flag with one more run.
  async dispatch() {
    if (this._dispatching) {
      this._pendingDispatch = true;
      return;
    }
    this._dispatching = true;
    try {
      await this._run();
      let guard = 0;
      while (this._pendingDispatch) {
        if (++guard > 20) {
          logger.error('Scheduler: dispatch loop exceeded 20 iterations — aborting');
          break;
        }
        this._pendingDispatch = false;
        await this._run();
      }
    } catch (err) {
      logger.error(`Scheduler error: ${err.message}`);
    } finally {
      this._dispatching = false;
      this._pendingDispatch = false;
    }
  }

  async _run() {
    const tasks = await this._taskStore.getDispatchable();
    if (tasks.length === 0) return;

    const rawSlots = this._registry.getIdleSlots();
    if (rawSlots.length === 0) return;

    // Apply dispatch mode to determine slot order.
    const idleSlots = this._mode === 'random'
      ? shuffleSlots(rawSlots)
      : interleaveByWorker(rawSlots);

    const usedSlots = new Set();

    for (const task of tasks) {
      if (usedSlots.size >= idleSlots.length) break;

      const remaining = task.count - task.running - task.completed - task.failed;
      if (remaining <= 0) continue;

      // Filter available (unused) slots, then apply target constraints
      let candidateSlots = idleSlots.filter((_, i) => !usedSlots.has(i));

      if (task.target_node) {
        const { worker_id, profile } = task.target_node;
        candidateSlots = candidateSlots.filter(
          s => s.workerId === worker_id && s.profileName === profile
        );
      } else if (task.target_worker_id) {
        candidateSlots = candidateSlots.filter(s => s.workerId === task.target_worker_id);
      }

      const batch = candidateSlots.slice(0, remaining);
      // Mark used in the original idleSlots index
      for (const slot of batch) {
        usedSlots.add(idleSlots.indexOf(slot));
      }

      let sentCount = 0;

      for (const { workerId, profileName } of batch) {
        // Fix ⑧: pass taskId + targetUrl so disconnect handler and URL-control APIs work
        this._registry.markBusy(workerId, profileName, task.task_id, task.target_url);

        const sent = this._registry.sendTo(workerId, {
          type: 'task',
          task_id: task.task_id,
          profile: profileName,
          target_url: task.target_url,
          pipeline: task.pipeline,
          task_time: task.task_time,
        });

        if (sent) {
          sentCount++;
          logger.info(`[${this._mode}] Dispatched ${task.task_id} → [${workerId}:${profileName}]`);
        } else {
          this._registry.markIdle(workerId, profileName);
          logger.warn(`Send failed ${task.task_id} → [${workerId}:${profileName}]`);
        }
      }

      if (sentCount > 0) {
        // Fix ⑤: atomic increment instead of read-modify-write
        await this._taskStore.atomicIncrementRunning(task.task_id, sentCount);
      }
    }
  }
}

module.exports = Scheduler;
