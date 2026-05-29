<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <!-- header -->
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
      <TaskSubmit v-if="activeTab === 'submit'" @submitted="refreshTasks" />

      <TemplateManager v-if="activeTab === 'templates'" />

      <WorkerStatus v-if="activeTab === 'workers'" :workers="workers" />

      <TaskList v-if="activeTab === 'tasks'" :tasks="tasks"
        @stop="stopTask" @view-cookies="openCookies" />

      <CookieViewer v-if="activeTab === 'cookies'" :initial-task-id="cookieTaskId" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import TaskSubmit from './components/TaskSubmit.vue';
import TemplateManager from './components/TemplateManager.vue';
import WorkerStatus from './components/WorkerStatus.vue';
import TaskList from './components/TaskList.vue';
import CookieViewer from './components/CookieViewer.vue';
import { fetchTasks, fetchWorkers, stopTask as apiStop } from './api.js';

const TABS = [
  { id: 'submit',    label: '发布任务' },
  { id: 'templates', label: '任务编排' },
  { id: 'workers',   label: 'Worker 状态' },
  { id: 'tasks',     label: '任务列表' },
  { id: 'cookies',   label: 'Cookie 采集' },
];

const activeTab = ref('submit');
const tasks = ref([]);
const workers = ref([]);
const cookieTaskId = ref('');

async function refreshTasks() {
  try { tasks.value = await fetchTasks(); } catch {}
}

async function refreshWorkers() {
  try { workers.value = await fetchWorkers(); } catch {}
}

async function stopTask(taskId) {
  try { await apiStop(taskId); await refreshTasks(); } catch (err) { alert(err.message); }
}

function openCookies(taskId) {
  cookieTaskId.value = taskId;
  activeTab.value = 'cookies';
}

let timer;
onMounted(() => {
  refreshTasks();
  refreshWorkers();
  timer = setInterval(() => { refreshTasks(); refreshWorkers(); }, 10_000);
});
onUnmounted(() => clearInterval(timer));
</script>
