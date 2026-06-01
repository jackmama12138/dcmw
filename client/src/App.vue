<template>
  <div style="display:flex; min-height:100vh; background:var(--bg-page); color:var(--tx-1)">

    <!-- sidebar -->
    <aside style="width:200px; flex-shrink:0; border-right:1px solid var(--bd-color); background:var(--bg-card); display:flex; flex-direction:column">
      <div style="height:56px; display:flex; align-items:center; padding:0 20px; border-bottom:1px solid var(--bd-color)">
        <span style="color:var(--primary); font-weight:700; font-size:15px; letter-spacing:2px">DCMW</span>
        <span style="margin-left:6px; font-size:11px; color:var(--tx-4); font-family:monospace">v2</span>
      </div>

      <nav style="flex:1; padding:8px 6px; display:flex; flex-direction:column; gap:2px">
        <button v-for="tab in TABS" :key="tab.id" @click="activeTab = tab.id"
          :style="[
            'width:100%; display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:6px; font-size:13px; transition:all .15s; text-align:left; border:none; cursor:pointer',
            activeTab === tab.id
              ? 'background:#e8f0fe; color:var(--primary); font-weight:500'
              : 'background:transparent; color:var(--tx-2)'
          ]"
          @mouseover="e => { if(activeTab !== tab.id) e.currentTarget.style.background='#f2f3f5' }"
          @mouseleave="e => { if(activeTab !== tab.id) e.currentTarget.style.background='transparent' }">
          <span style="font-size:13px; width:18px; text-align:center; flex-shrink:0">{{ tab.icon }}</span>
          {{ tab.label }}
        </button>
      </nav>

      <div style="padding:10px 16px; border-top:1px solid var(--bd-color); display:flex; align-items:center; gap:6px">
        <span :style="wsOnline ? 'background:var(--success)' : 'background:var(--danger)'"
          style="width:6px; height:6px; border-radius:50%; flex-shrink:0"></span>
        <span style="font-size:11px; color:var(--tx-3)">{{ wsOnline ? `${onlineWorkers} worker 在线` : '离线' }}</span>
      </div>
    </aside>

    <!-- main -->
    <div style="flex:1; display:flex; flex-direction:column; min-width:0">
      <header style="height:56px; border-bottom:1px solid var(--bd-color); background:var(--bg-card); display:flex; align-items:center; justify-content:space-between; padding:0 24px; flex-shrink:0">
        <div>
          <span style="font-weight:600; font-size:14px">{{ currentTab?.label }}</span>
          <span style="margin-left:8px; font-size:12px; color:var(--tx-3)">{{ currentTab?.desc }}</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px; font-size:12px; color:var(--tx-3)">
          <span>{{ busyNodes }} running · {{ idleNodes }} idle</span>
          <button @click="refresh"
            style="display:flex; align-items:center; gap:4px; color:var(--tx-3); border:1px solid var(--bd-color); border-radius:6px; padding:3px 10px; font-size:12px; background:transparent; cursor:pointer; transition:all .15s"
            @mouseover="e => e.currentTarget.style.borderColor='var(--primary)'"
            @mouseleave="e => e.currentTarget.style.borderColor='var(--bd-color)'">
            ↺ 刷新
          </button>
        </div>
      </header>

      <main style="flex:1; overflow-y:auto; padding:20px; background:var(--bg-page)">
        <Dashboard       v-if="activeTab === 'dashboard'"   :workers="workers" @refresh="refresh" />
        <TaskSubmit      v-if="activeTab === 'submit'"      :workers="workers" @submitted="refresh" />
        <TemplateManager v-if="activeTab === 'templates'" />
        <TaskList        v-if="activeTab === 'tasks'"
          :tasks="tasks" :workers="workers"
          @stop="stopTask"
          @ranklist-check="doRanklistCheck"
          @screenshot-take="doScreenshotTake" />
        <CookieViewer    v-if="activeTab === 'cookies'" />
        <ScreenshotViewer v-if="activeTab === 'screenshots'" />
        <CaptureViewer   v-if="activeTab === 'captures'"  :initial-task-id="captureTaskId" />
        <RanklistViewer  v-if="activeTab === 'ranklist'" />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, provide } from 'vue';
import Dashboard       from './components/Dashboard.vue';
import TaskSubmit      from './components/TaskSubmit.vue';
import TemplateManager from './components/TemplateManager.vue';
import TaskList        from './components/TaskList.vue';
import CookieViewer    from './components/CookieViewer.vue';
import ScreenshotViewer from './components/ScreenshotViewer.vue';
import CaptureViewer   from './components/CaptureViewer.vue';
import RanklistViewer  from './components/RanklistViewer.vue';
import { fetchTasks, fetchWorkers, stopTask as apiStop, triggerRanklistCheck, triggerScreenshot } from './api.js';

const TABS = [
  { id: 'dashboard',   label: '运维面板',  icon: '◈', desc: '实时节点与任务概览' },
  { id: 'submit',      label: '发布任务',  icon: '⊕', desc: '创建新任务' },
  { id: 'templates',   label: '任务编排',  icon: '⊞', desc: '管理 Pipeline 模板' },
  { id: 'tasks',       label: '任务列表',  icon: '≣', desc: '历史与进行中任务' },
  { id: 'cookies',     label: 'Cookie',   icon: '○', desc: 'rtcookie 采集记录' },
  { id: 'screenshots', label: '截图',      icon: '▣', desc: 'screenshot 截图记录' },
  { id: 'captures',    label: '拦截数据',  icon: '◎', desc: 'intercept 响应数据' },
  { id: 'ranklist',    label: '榜单检查',  icon: '◉', desc: '直播间榜单检查记录' },
];

const activeTab     = ref('dashboard');
const tasks         = ref([]);
const workers       = ref([]);
// Map<"workerId:profile", { step, total, action, elapsed_ms }> — 实时执行进度
const progressMap   = ref({});
// 最新截图通知列表（环形，最多保留 50 条）
const screenshotNotifications = ref([]);
const captureTaskId = ref('');

const currentTab    = computed(() => TABS.find(t => t.id === activeTab.value));
const onlineWorkers = computed(() => workers.value.filter(w => w.connected).length);
const wsOnline      = computed(() => onlineWorkers.value > 0);
const busyNodes     = computed(() => workers.value.reduce((s, w) => s + w.slots.busy, 0));
const idleNodes     = computed(() => workers.value.reduce((s, w) => s + w.slots.idle, 0));

async function refresh() {
  [tasks.value, workers.value] = await Promise.all([
    fetchTasks().catch(() => []),
    fetchWorkers().catch(() => []),
  ]);
}

async function stopTask(taskId) {
  try { await apiStop(taskId); await refresh(); } catch (err) { alert(err.message); }
}

function getRunningSlots(task) {
  return workers.value.flatMap(w =>
    w.profiles
      .filter(p => p.state === 'busy' && p.taskId === task.task_id)
      .map(p => ({ worker_id: w.workerId, profile: p.profileName, task_id: task.task_id }))
  );
}

async function doRanklistCheck(task) {
  const slots = getRunningSlots(task);
  if (!slots.length) return;
  await Promise.allSettled(slots.map(s => triggerRanklistCheck(s)));
  activeTab.value = 'ranklist';
}

async function doScreenshotTake(task) {
  const slots = getRunningSlots(task);
  if (!slots.length) return;
  await Promise.allSettled(slots.map(s => triggerScreenshot(s)));
  activeTab.value = 'screenshots';
}

let ws = null;
let wsReconnectTimer = null;

function connectWs() {
  const base = (import.meta.env.VITE_SERVER_PUBLISH_URL ?? '').replace(/^http/, 'ws');
  ws = new WebSocket(`${base}/ws/client`);

  ws.onopen = () => {
    // 连接后 gateway 会自动推全量快照，无需额外拉取
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'workers_update') workers.value = msg.workers;
    if (msg.type === 'worker_patch') {
      const idx = workers.value.findIndex(w => w.workerId === msg.worker.workerId);
      if (idx !== -1) workers.value[idx] = msg.worker;
      else workers.value = [...workers.value, msg.worker];
    }
    if (msg.type === 'tasks_update')   tasks.value   = msg.tasks;
    if (msg.type === 'task_progress')  handleProgress(msg);
    if (msg.type === 'screenshot_done') handleScreenshotDone(msg);
  };

  ws.onclose = () => {
    ws = null;
    wsReconnectTimer = setTimeout(connectWs, 3000);
  };

  ws.onerror = () => { ws?.close(); };
}

function wsSend(payload) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function handleProgress(msg) {
  const key = `${msg.worker_id}:${msg.profile}`;
  progressMap.value = { ...progressMap.value, [key]: {
    step: msg.step, total: msg.total, action: msg.action, elapsed_ms: msg.elapsed_ms,
  }};
}

function handleScreenshotDone(msg) {
  screenshotNotifications.value.unshift(msg);
  if (screenshotNotifications.value.length > 50) screenshotNotifications.value.length = 50;
}

provide('wsSend', wsSend);
provide('progressMap', progressMap);
provide('screenshotNotifications', screenshotNotifications);

onMounted(() => {
  refresh(); // 初始全量拉取兜底（WS 未连接前保证有数据）
  connectWs();
});
onUnmounted(() => {
  clearTimeout(wsReconnectTimer);
  ws?.close();
  ws = null;
});
</script>
