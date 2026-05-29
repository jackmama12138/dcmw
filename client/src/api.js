import axios from 'axios';

const BASE_URL = import.meta.env.VITE_SERVER_PUBLISH_URL ?? 'http://192.168.110.111:7777';

const http = axios.create({ baseURL: BASE_URL });

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

// ─── cookies ──────────────────────────────────────────────────────────────────

export async function fetchCookies(taskId) {
  const { data } = await http.get(`/api/cookies/${taskId}`);
  return data;
}
