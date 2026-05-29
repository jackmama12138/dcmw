<template>
  <div class="space-y-4">

    <!-- stats bar -->
    <div class="grid grid-cols-4 gap-3">
      <div class="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
        <div class="text-2xl font-bold text-green-400">{{ onlineWorkers }}</div>
        <div class="text-xs text-gray-500 mt-0.5">Worker 在线</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
        <div class="text-2xl font-bold text-yellow-400">{{ busyNodes }}</div>
        <div class="text-xs text-gray-500 mt-0.5">节点运行中</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4">
        <div class="text-2xl font-bold text-gray-300">{{ idleNodes }}</div>
        <div class="text-xs text-gray-500 mt-0.5">节点空闲</div>
      </div>
      <!-- scheduler mode toggle -->
      <div class="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex flex-col justify-between">
        <div class="text-xs text-gray-500">调度模式</div>
        <div class="flex gap-1 mt-2">
          <button @click="setMode('sequential')"
            :class="['flex-1 text-xs px-2 py-1 rounded-lg transition-colors',
              dispatchMode === 'sequential'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700']">
            顺序
          </button>
          <button @click="setMode('random')"
            :class="['flex-1 text-xs px-2 py-1 rounded-lg transition-colors',
              dispatchMode === 'random'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700']">
            随机
          </button>
        </div>
      </div>
    </div>

    <!-- by URL -->
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 class="font-semibold mb-3 flex items-center gap-2">
        执行中的 URL
        <span class="text-xs text-gray-600 font-normal">（{{ urlGroups.length }} 个）</span>
      </h3>
      <div v-if="!urlGroups.length" class="text-sm text-gray-600 py-4 text-center">无正在执行的任务</div>
      <div v-for="group in urlGroups" :key="group.url"
        class="mb-3 last:mb-0 border border-gray-800 rounded-xl p-4">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <div class="text-sm text-indigo-300 truncate font-mono" :title="group.url">{{ group.url }}</div>
            <div class="text-xs text-gray-600 mt-0.5">{{ group.nodes.length }} 个节点</div>
          </div>
          <!-- adjust time + stop -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <div class="flex items-center gap-1">
              <span class="text-xs text-gray-600">调整时间</span>
              <button @click="adjust(group.url, -600)"
                class="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-lg transition-colors">-10m</button>
              <button @click="adjust(group.url, -60)"
                class="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-lg transition-colors">-1m</button>
              <button @click="adjust(group.url, 60)"
                class="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-lg transition-colors">+1m</button>
              <button @click="adjust(group.url, 600)"
                class="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-lg transition-colors">+10m</button>
            </div>
            <button @click="stopUrl(group.url)"
              class="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-3 py-1.5 rounded-lg transition-colors">
              停止全部
            </button>
          </div>
        </div>
        <!-- nodes grouped by worker -->
        <div v-for="(nodes, wid) in groupByWorker(group.nodes)" :key="wid" class="mb-2 last:mb-0">
          <div class="text-xs text-gray-600 font-mono mb-1.5">{{ wid }}</div>
          <div class="flex flex-wrap gap-1.5">
            <div v-for="n in nodes" :key="n.profileName"
              class="flex items-center gap-1 bg-yellow-950 border border-yellow-800 rounded-lg px-2 py-1 text-xs">
              <span class="text-yellow-300 font-mono">{{ n.profileName }}</span>
              <button @click="stopNode(n.workerId, n.profileName)"
                class="text-yellow-700 hover:text-red-400 transition-colors ml-1">✕</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- workers -->
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 class="font-semibold mb-3">Worker 状态</h3>
      <div v-if="!workers.length" class="text-sm text-gray-600 py-4 text-center">无 Worker 连接</div>
      <div v-for="w in workers" :key="w.workerId"
        class="mb-3 last:mb-0 border border-gray-800 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span :class="w.connected ? 'bg-green-500' : 'bg-red-500'" class="w-2.5 h-2.5 rounded-full"></span>
            <span class="font-mono text-sm text-indigo-300">{{ w.workerId }}</span>
            <span class="text-xs text-gray-600">
              空闲 <b class="text-green-400">{{ w.slots.idle }}</b> /
              忙碌 <b class="text-yellow-400">{{ w.slots.busy }}</b> /
              总计 <b class="text-gray-400">{{ w.slots.total }}</b>
            </span>
          </div>
          <button v-if="w.slots.busy > 0" @click="stopWorker(w.workerId)"
            class="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-3 py-1.5 rounded-lg transition-colors">
            停止全部节点
          </button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <div v-for="p in w.profiles" :key="p.profileName"
            :class="['flex items-center gap-1 rounded-lg px-2 py-1 text-xs border', profileStyle(p.state)]">
            <span class="font-mono">{{ p.profileName }}</span>
            <span v-if="p.state === 'busy'" class="opacity-40 text-xs max-w-[80px] truncate" :title="p.targetUrl">
              {{ shortUrl(p.targetUrl) }}
            </span>
            <button v-if="p.state === 'busy'" @click="stopNode(w.workerId, p.profileName)"
              class="hover:text-red-400 transition-colors ml-0.5 opacity-60 hover:opacity-100">✕</button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { stopByUrl, stopWorker as apiStopWorker, stopNode as apiStopNode, adjustTime, fetchSchedulerConfig, setSchedulerConfig } from '../api.js';

const props = defineProps({ workers: { type: Array, default: () => [] } });
const emit = defineEmits(['refresh']);

const dispatchMode = ref('sequential');

onMounted(async () => {
  try {
    const cfg = await fetchSchedulerConfig();
    dispatchMode.value = cfg.dispatch_mode;
  } catch {}
});

const onlineWorkers = computed(() => props.workers.filter(w => w.connected).length);
const busyNodes = computed(() => props.workers.reduce((s, w) => s + w.slots.busy, 0));
const idleNodes = computed(() => props.workers.reduce((s, w) => s + w.slots.idle, 0));

const urlGroups = computed(() => {
  const map = new Map();
  for (const w of props.workers) {
    for (const p of w.profiles) {
      if (p.state === 'busy' && p.targetUrl) {
        if (!map.has(p.targetUrl)) map.set(p.targetUrl, []);
        map.get(p.targetUrl).push({ workerId: w.workerId, profileName: p.profileName, taskId: p.taskId });
      }
    }
  }
  return [...map.entries()].map(([url, nodes]) => ({ url, nodes }));
});

function groupByWorker(nodes) {
  const m = {};
  for (const n of nodes) {
    if (!m[n.workerId]) m[n.workerId] = [];
    m[n.workerId].push(n);
  }
  return m;
}

function profileStyle(state) {
  return {
    idle:  'bg-gray-800 text-gray-400 border-gray-700',
    busy:  'bg-yellow-950 text-yellow-300 border-yellow-800',
    error: 'bg-red-950 text-red-400 border-red-800',
  }[state] ?? 'bg-gray-800 text-gray-400 border-gray-700';
}

function shortUrl(url) {
  if (!url) return '';
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() || url; } catch { return url; }
}

async function setMode(mode) {
  try {
    await setSchedulerConfig(mode);
    dispatchMode.value = mode;
  } catch (err) { alert(err.message); }
}

async function adjust(url, delta) {
  try { await adjustTime(url, delta); emit('refresh'); } catch (err) { alert(err.message); }
}

async function stopUrl(url) {
  if (!confirm(`停止所有执行 "${url}" 的节点？`)) return;
  try { await stopByUrl(url); emit('refresh'); } catch (err) { alert(err.message); }
}

async function stopWorker(workerId) {
  if (!confirm(`停止 Worker ${workerId} 上所有节点？`)) return;
  try { await apiStopWorker(workerId); emit('refresh'); } catch (err) { alert(err.message); }
}

async function stopNode(workerId, profile) {
  try { await apiStopNode(workerId, profile); emit('refresh'); } catch (err) { alert(err.message); }
}
</script>
