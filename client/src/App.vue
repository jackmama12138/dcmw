<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <div class="border-b border-gray-800 px-6 py-3 flex items-center gap-6">
      <span class="text-indigo-400 font-bold text-lg">DCMW</span>
      <nav class="flex gap-1">
        <button v-for="tab in TABS" :key="tab.id" @click="activeTab = tab.id"
          :class="['px-4 py-1.5 rounded-lg text-sm transition-colors',
            activeTab === tab.id
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800']">
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <div class="p-6">
      <Dashboard    v-if="activeTab === 'dashboard'"  :workers="workers" @refresh="refresh" />
      <TaskSubmit   v-if="activeTab === 'submit'"     @submitted="refresh" />
      <TemplateManager v-if="activeTab === 'templates'" />
      <TaskList     v-if="activeTab === 'tasks'"      :tasks="tasks" @stop="stopTask" @view-cookies="openCookies" />
      <CookieViewer   v-if="activeTab === 'cookies'"    :initial-task-id="cookieTaskId" />
      <ActionsEditor  v-if="activeTab === 'actions'" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import Dashboard      from './components/Dashboard.vue';
import TaskSubmit     from './components/TaskSubmit.vue';
import TemplateManager from './components/TemplateManager.vue';
import TaskList       from './components/TaskList.vue';
import CookieViewer   from './components/CookieViewer.vue';
import ActionsEditor  from './components/ActionsEditor.vue';
import { fetchTasks, fetchWorkers, stopTask as apiStop } from './api.js';

const TABS = [
  { id: 'dashboard',  label: '运维面板' },
  { id: 'submit',     label: '发布任务' },
  { id: 'templates',  label: '任务编排' },
  { id: 'tasks',      label: '任务列表' },
  { id: 'cookies',    label: 'Cookie 采集' },
  { id: 'actions',    label: 'Actions 编辑' },
];

const activeTab   = ref('dashboard');
const tasks       = ref([]);
const workers     = ref([]);
const cookieTaskId = ref('');

async function refresh() {
  [tasks.value, workers.value] = await Promise.all([
    fetchTasks().catch(() => []),
    fetchWorkers().catch(() => []),
  ]);
}

async function stopTask(taskId) {
  try { await apiStop(taskId); await refresh(); } catch (err) { alert(err.message); }
}

function openCookies(taskId) {
  cookieTaskId.value = taskId;
  activeTab.value = 'cookies';
}

let timer;
onMounted(() => { refresh(); timer = setInterval(refresh, 10_000); });
onUnmounted(() => clearInterval(timer));
</script>
