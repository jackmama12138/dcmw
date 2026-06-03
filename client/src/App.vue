<template>
  <a-layout class="app-shell">
    <!-- sidebar -->
    <a-layout-sider :width="200" class="app-sider">
      <div class="app-logo">
        <span class="app-logo__name">DCMW</span>
        <span class="app-logo__ver">v2</span>
      </div>

      <a-menu
        :selected-keys="[activeTab]"
        class="app-menu"
        @menu-item-click="key => (activeTab = key)">
        <a-menu-item v-for="tab in TABS" :key="tab.id">
          <template #icon><span class="app-menu__icon">{{ tab.icon }}</span></template>
          {{ tab.label }}
        </a-menu-item>
      </a-menu>

      <div class="app-sider__footer">
        <a-badge :status="wsOnline ? 'success' : 'danger'" />
        <span class="app-sider__footer-text">
          {{ wsOnline ? `${onlineWorkers} worker 在线` : '离线' }}
        </span>
      </div>
    </a-layout-sider>

    <!-- main -->
    <a-layout class="app-main">
      <a-layout-header class="app-header">
        <a-space :size="8" align="baseline">
          <span class="app-header__title">{{ currentTab?.label }}</span>
          <span class="app-header__desc">{{ currentTab?.desc }}</span>
        </a-space>
        <a-space :size="12">
          <span class="app-header__stat">{{ busyNodes }} running · {{ idleNodes }} idle</span>
          <a-button size="small" @click="refresh">
            <template #icon><icon-refresh /></template>
            刷新
          </a-button>
        </a-space>
      </a-layout-header>

      <a-layout-content class="app-content">
        <Dashboard        v-if="activeTab === 'dashboard'"   :workers="workers" @refresh="refresh" />
        <ActiveTasks      v-if="activeTab === 'active'"      :workers="workers" />
        <TemplateManager  v-if="activeTab === 'templates'" />
        <TaskList         v-if="activeTab === 'tasks'"       :tasks="tasks" />
        <CookieViewer     v-if="activeTab === 'cookies'" />
        <ScreenshotViewer v-if="activeTab === 'screenshots'" />
        <CaptureViewer    v-if="activeTab === 'captures'"    :initial-task-id="captureTaskId" />
        <RanklistViewer   v-if="activeTab === 'ranklist'" />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, provide } from 'vue';
import { Message } from '@arco-design/web-vue';
import Dashboard       from './components/Dashboard.vue';
import ActiveTasks     from './components/ActiveTasks.vue';
import TemplateManager from './components/TemplateManager.vue';
import TaskList        from './components/TaskList.vue';
import CookieViewer    from './components/CookieViewer.vue';
import ScreenshotViewer from './components/ScreenshotViewer.vue';
import CaptureViewer   from './components/CaptureViewer.vue';
import RanklistViewer  from './components/RanklistViewer.vue';
import { fetchTasks, fetchWorkers, stopTask as apiStop, triggerRanklistCheck, triggerScreenshot } from './api.js';

// ── 全局 Toast（用 Arco Message 实现，保留原 (msg, type) 签名供子组件 inject 调用）──
function toast(msg, type = 'info') {
  const fn = { success: Message.success, warn: Message.warning, info: Message.info }[type] ?? Message.info;
  fn({ content: msg, duration: 3000 });
}

const TABS = [
  { id: 'dashboard',   label: '运维面板',  icon: '◈', desc: '实时节点与任务概览' },
  { id: 'active',      label: '执行中',    icon: '▶', desc: '执行中任务与节点状态' },
  { id: 'templates',   label: '任务编排',  icon: '⊞', desc: '管理 Pipeline 模板' },
  { id: 'tasks',       label: '任务列表',  icon: '≣', desc: '历史任务记录' },
  { id: 'cookies',     label: 'Cookie',   icon: '○', desc: 'rtcookie 采集记录' },
  { id: 'screenshots', label: '截图',      icon: '▣', desc: 'screenshot 截图记录' },
  { id: 'captures',    label: '拦截数据',  icon: '◎', desc: 'intercept 响应数据' },
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
  try { await apiStop(taskId); await refresh(); } catch (err) { Message.error(err.message); }
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
    if (msg.type === 'workers_update') {
      workers.value = msg.workers;
      const busyKeys = new Set(msg.workers.flatMap(w =>
        w.profiles.filter(p => p.state === 'busy').map(p => `${w.workerId}:${p.profileName}`)
      ));
      for (const key of Object.keys(progressMap.value)) {
        if (!busyKeys.has(key)) delete progressMap.value[key];
      }
    }
    if (msg.type === 'worker_patch') {
      const idx = workers.value.findIndex(w => w.workerId === msg.worker.workerId);
      if (idx !== -1) workers.value[idx] = msg.worker;
      else workers.value = [...workers.value, msg.worker];
      msg.worker.profiles.filter(p => p.state !== 'busy').forEach(p => {
        delete progressMap.value[`${msg.worker.workerId}:${p.profileName}`];
      });
    }
    if (msg.type === 'tasks_update')   tasks.value   = msg.tasks;
    if (msg.type === 'task_progress')  handleProgress(msg);
    if (msg.type === 'screenshot_done') handleScreenshotDone(msg);
    if (msg.type === 'ranklist_result') handleRanklistResult(msg);
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
  activeTab.value = 'screenshots';
}

// 榜单检查结果：成功提示排名，失败提示原因
const RANKLIST_REASONS = {
  live_ended   : '直播已结束',
  tab_not_found: '贡献用户 tab 未出现',
  timeout      : '榜单响应超时',
  no_page      : '无活跃页面',
};
function handleRanklistResult(msg) {
  const node = `${msg.worker_id}:${msg.profile}`;
  if (msg.ok) {
    const who = msg.nickname ? ` ${msg.nickname}` : '';
    toast(`${node} 榜单排名 #${msg.rank}${who}`, 'success');
  } else {
    const why = RANKLIST_REASONS[msg.reason] ?? msg.reason ?? '未知原因';
    toast(`${node} 榜单检查跳过：${why}`, 'warn');
  }
}

provide('wsSend', wsSend);
provide('progressMap', progressMap);
provide('screenshotNotifications', screenshotNotifications);
provide('setTab', (tab) => { activeTab.value = tab; });
provide('toast', toast);

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

<style scoped>
.app-shell { min-height: 100vh; background: var(--bg-page); }

.app-sider {
  border-right: 1px solid var(--bd-color);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
}

.app-logo {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid var(--bd-color);
}
.app-logo__name { color: var(--primary); font-weight: 700; font-size: 15px; letter-spacing: 2px; }
.app-logo__ver  { margin-left: 6px; font-size: 11px; color: var(--tx-4); font-family: monospace; }

.app-menu { flex: 1; border: none; }
.app-menu__icon { font-size: 13px; display: inline-block; width: 18px; text-align: center; }

.app-sider__footer {
  padding: 10px 16px;
  border-top: 1px solid var(--bd-color);
  display: flex;
  align-items: center;
  gap: 6px;
}
.app-sider__footer-text { font-size: 11px; color: var(--tx-3); }

.app-main { min-width: 0; }

.app-header {
  height: 56px;
  border-bottom: 1px solid var(--bd-color);
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}
.app-header__title { font-weight: 600; font-size: 14px; color: var(--tx-1); }
.app-header__desc  { font-size: 12px; color: var(--tx-3); }
.app-header__stat  { font-size: 12px; color: var(--tx-3); }

.app-content {
  overflow-y: auto;
  padding: 20px;
  background: var(--bg-page);
  height: calc(100vh - 56px);
}

/* Arco sider 内部 children 垂直排布 */
.app-sider :deep(.arco-layout-sider-children) {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
