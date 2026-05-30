<template>
  <div class="flex min-h-screen bg-gray-950 text-gray-100">

    <!-- sidebar -->
    <aside class="w-56 flex-shrink-0 border-r border-gray-800 flex flex-col">
      <!-- logo -->
      <div class="h-14 flex items-center px-5 border-b border-gray-800">
        <span class="text-indigo-400 font-bold text-base tracking-widest">DCMW</span>
        <span class="ml-2 text-gray-600 text-xs font-mono">v2</span>
      </div>

      <!-- nav -->
      <nav class="flex-1 py-3 space-y-0.5 px-2">
        <button v-for="tab in TABS" :key="tab.id" @click="activeTab = tab.id"
          :class="['w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
            activeTab === tab.id
              ? 'bg-indigo-600/20 text-indigo-300 font-medium'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60']">
          <span class="text-base leading-none w-5 text-center select-none">{{ tab.icon }}</span>
          {{ tab.label }}
        </button>
      </nav>

      <!-- footer -->
      <div class="px-5 py-3 border-t border-gray-800">
        <div class="flex items-center gap-2">
          <span :class="wsOnline ? 'bg-emerald-500' : 'bg-red-500'"
            class="w-1.5 h-1.5 rounded-full flex-shrink-0"></span>
          <span class="text-xs text-gray-600">{{ wsOnline ? `${onlineWorkers} worker online` : 'offline' }}</span>
        </div>
      </div>
    </aside>

    <!-- main -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- topbar -->
      <header class="h-14 border-b border-gray-800 flex items-center justify-between px-6 flex-shrink-0">
        <div>
          <span class="font-semibold text-sm">{{ currentTab?.label }}</span>
          <span class="text-gray-600 text-xs ml-2">{{ currentTab?.desc }}</span>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-600">
          <span>{{ busyNodes }} running · {{ idleNodes }} idle</span>
          <button @click="refresh"
            class="flex items-center gap-1 text-gray-500 hover:text-gray-300 transition-colors border border-gray-800 rounded-lg px-2.5 py-1">
            ↺ 刷新
          </button>
        </div>
      </header>

      <!-- content -->
      <main class="flex-1 overflow-y-auto p-6">
        <Dashboard       v-if="activeTab === 'dashboard'"   :workers="workers" @refresh="refresh" />
        <TaskSubmit      v-if="activeTab === 'submit'"      :workers="workers" @submitted="refresh" />
        <TemplateManager v-if="activeTab === 'templates'" />
        <TaskList        v-if="activeTab === 'tasks'"
          :tasks="tasks"
          :workers="workers"
          @stop="stopTask"
          @ranklist-check="doRanklistCheck"
          @screenshot-take="doScreenshotTake" />
        <CookieViewer    v-if="activeTab === 'cookies'" />
        <ScreenshotViewer v-if="activeTab === 'screenshots'" />
        <CaptureViewer   v-if="activeTab === 'captures'"  :initial-task-id="captureTaskId" />
        <RanklistViewer  v-if="activeTab === 'ranklist'" />
        <ActionsEditor   v-if="activeTab === 'actions'" />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Dashboard       from './components/Dashboard.vue';
import TaskSubmit      from './components/TaskSubmit.vue';
import TemplateManager from './components/TemplateManager.vue';
import TaskList        from './components/TaskList.vue';
import CookieViewer    from './components/CookieViewer.vue';
import ScreenshotViewer from './components/ScreenshotViewer.vue';
import CaptureViewer   from './components/CaptureViewer.vue';
import RanklistViewer  from './components/RanklistViewer.vue';
import ActionsEditor   from './components/ActionsEditor.vue';
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
  { id: 'actions',     label: 'Actions',  icon: '⌥', desc: '自定义 Worker 脚本' },
];

const activeTab        = ref('dashboard');
const tasks            = ref([]);
const workers          = ref([]);
const captureTaskId    = ref('');

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

function openCaptures(taskId) {
  captureTaskId.value = taskId;
  activeTab.value = 'captures';
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

let timer;
onMounted(() => { refresh(); timer = setInterval(refresh, 10_000); });
onUnmounted(() => clearInterval(timer));
</script>
