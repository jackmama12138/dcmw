import axios from 'axios';

const http = axios.create({ baseURL: import.meta.env.VITE_SERVER_PUBLISH_URL ?? '' });

// ─── action types ─────────────────────────────────────────────────────────────

export async function fetchActionTypes() {
  const { data } = await http.get('/api/action-types');
  return data; // string[]
}

// ─── tasks ────────────────────────────────────────────────────────────────────

export async function submitTask(payload) {
  const { data } = await http.post('/task/add', payload);
  return data;
}

export async function fetchTasks() {
  const { data } = await http.get('/api/tasks');
  return data;
}

export async function stopTask(taskId) {
  const { data } = await http.post(`/api/tasks/${taskId}/stop`);
  return data;
}

// ─── workers ──────────────────────────────────────────────────────────────────

export async function fetchWorkers() {
  const { data } = await http.get('/api/workers');
  return data;
}

// ─── templates ────────────────────────────────────────────────────────────────

export async function fetchTemplates() {
  const { data } = await http.get('/api/templates');
  return data;
}

export async function saveTemplate(payload) {
  const { data } = await http.post('/api/templates', payload);
  return data;
}

export async function deleteTemplate(name) {
  const { data } = await http.delete(`/api/templates/${encodeURIComponent(name)}`);
  return data;
}

export async function stopWorker(workerId) {
  const { data } = await http.post(`/api/workers/${encodeURIComponent(workerId)}/stop`);
  return data;
}

export async function stopNode(workerId, profile) {
  const { data } = await http.post(`/api/workers/${encodeURIComponent(workerId)}/nodes/${encodeURIComponent(profile)}/stop`);
  return data;
}

export async function stopByUrl(targetUrl) {
  const { data } = await http.post('/api/tasks/stop-by-url', { target_url: targetUrl });
  return data;
}

export async function adjustTime(targetUrl, delta) {
  const { data } = await http.post('/api/tasks/adjust-time', { target_url: targetUrl, delta });
  return data;
}

// ─── scheduler ────────────────────────────────────────────────────────────────

export async function fetchSchedulerConfig() {
  const { data } = await http.get('/api/scheduler/config');
  return data;
}

export async function setSchedulerConfig(patch) {
  // 兼容旧调用：setSchedulerConfig('sequential') → { dispatch_mode }
  const body = typeof patch === 'string' ? { dispatch_mode: patch } : patch;
  const { data } = await http.post('/api/scheduler/config', body);
  return data;
}

// ─── cookies ──────────────────────────────────────────────────────────────────

export async function fetchCookies(signal) {
  const { data } = await http.get('/api/cookies', { signal });
  return data;
}

export async function fetchScreenshots(signal) {
  const { data } = await http.get('/api/screenshots', { signal });
  return data;
}

export async function triggerScreenshot({ worker_id, profile, task_id }) {
  const { data } = await http.post('/api/screenshot/take', { worker_id, profile, task_id });
  return data;
}

// ─── captures ─────────────────────────────────────────────────────────────────

export async function fetchCaptures(taskId) {
  const { data } = await http.get(`/api/captures/${taskId}`);
  return data;
}

// ─── ranklist ─────────────────────────────────────────────────────────────────

export async function fetchRanklist(signal) {
  const { data } = await http.get('/api/ranklist', { signal });
  return data;
}

export async function triggerRanklistCheck({ worker_id, profile, task_id }) {
  const { data } = await http.post('/api/ranklist/check', { worker_id, profile, task_id });
  return data;
}

export async function triggerRanklistCheckBatch(targets) {
  const { data } = await http.post('/api/ranklist/check', { targets });
  return data;
}

export async function triggerReloadBatch(targets) {
  const { data } = await http.post('/api/reload', { targets });
  return data;
}
