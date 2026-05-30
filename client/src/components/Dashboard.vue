<template>
  <div class="space-y-5">

    <!-- stats row -->
    <div class="grid grid-cols-4 gap-3">
      <div class="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 border-l-2 border-l-emerald-500 flex items-center gap-3">
        <div class="text-xl font-bold text-emerald-400">{{ onlineWorkers }}</div>
        <div class="text-xs text-gray-500">Worker 在线</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 border-l-2 border-l-amber-500 flex items-center gap-3">
        <div class="text-xl font-bold text-amber-400">{{ busyNodes }}</div>
        <div class="text-xs text-gray-500">节点运行中</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 border-l-2 border-l-gray-600 flex items-center gap-3">
        <div class="text-xl font-bold text-gray-300">{{ idleNodes }}</div>
        <div class="text-xs text-gray-500">节点空闲</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 border-l-2 border-l-indigo-500 flex items-center gap-3">
        <div class="text-xs text-gray-500 flex-shrink-0">调度模式</div>
        <div class="flex gap-1 flex-1">
          <button @click="setMode('sequential')"
            :class="['flex-1 text-xs px-2 py-1 rounded transition-colors font-medium',
              dispatchMode === 'sequential'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700']">
            顺序
          </button>
          <button @click="setMode('random')"
            :class="['flex-1 text-xs px-2 py-1 rounded transition-colors font-medium',
              dispatchMode === 'random'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700']">
            随机
          </button>
        </div>
      </div>
    </div>

    <!-- active URLs -->
    <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div class="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 class="text-sm font-semibold">执行中 URL</h3>
        <span class="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">{{ urlGroups.length }}</span>
      </div>
      <div v-if="!urlGroups.length" class="text-sm text-gray-600 text-center py-10">
        暂无执行中的任务
      </div>
      <div v-for="group in urlGroups" :key="group.url"
        class="px-4 py-2.5 border-b border-gray-800/60 last:border-0">
        <div class="flex items-center justify-between gap-3 mb-2">
          <div class="min-w-0 flex-1 flex items-center gap-2">
            <div class="text-xs text-indigo-300 font-mono truncate" :title="group.url">{{ group.url }}</div>
            <span class="text-xs text-gray-600 flex-shrink-0">{{ group.nodes.length }} 节点</span>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <span class="text-xs text-gray-600">时间</span>
            <button v-for="d in timeAdjusts" :key="d.label" @click="adjust(group.url, d.val)"
              class="text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 px-1.5 py-0.5 rounded transition-colors">
              {{ d.label }}
            </button>
            <button @click="stopUrl(group.url)"
              class="text-xs bg-red-950 hover:bg-red-900 border border-red-900 text-red-400 px-2 py-0.5 rounded transition-colors ml-1">
              停止全部
            </button>
          </div>
        </div>
        <div v-for="(nodes, wid) in groupByWorker(group.nodes)" :key="wid" class="mb-1.5 last:mb-0">
          <div class="text-xs text-gray-700 font-mono mb-1">{{ wid }}</div>
          <div class="flex flex-wrap gap-1">
            <div v-for="n in nodes" :key="n.profileName"
              class="flex items-center gap-1 bg-amber-950/50 border border-amber-800/60 rounded px-2 py-0.5 text-xs">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0"></span>
              <span class="text-amber-200 font-mono">{{ n.profileName }}</span>
              <button @click="stopNode(n.workerId, n.profileName)"
                class="text-amber-800 hover:text-red-400 transition-colors ml-0.5 leading-none">✕</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- workers -->
    <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div class="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
        <h3 class="text-sm font-semibold">Worker 状态</h3>
        <span class="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">{{ workers.length }}</span>
      </div>
      <div v-if="!workers.length" class="text-sm text-gray-600 text-center py-10">
        无 Worker 连接
      </div>
      <div v-for="w in workers" :key="w.workerId"
        class="px-4 py-2.5 border-b border-gray-800/60 last:border-0">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span :class="w.connected ? 'bg-emerald-500' : 'bg-red-500'"
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"></span>
            <span class="font-mono text-xs text-indigo-300">{{ w.workerId }}</span>
            <div class="flex gap-2 text-xs text-gray-600">
              <span>空闲 <b class="text-emerald-400">{{ w.slots.idle }}</b></span>
              <span>忙碌 <b class="text-amber-400">{{ w.slots.busy }}</b></span>
              <span>合计 <b class="text-gray-400">{{ w.slots.total }}</b></span>
            </div>
          </div>
          <button v-if="w.slots.busy > 0" @click="stopWorker(w.workerId)"
            class="text-xs bg-red-950 hover:bg-red-900 border border-red-900 text-red-400 px-2 py-0.5 rounded transition-colors">
            停止全部
          </button>
        </div>
        <div class="flex flex-wrap gap-1">
          <div v-for="p in w.profiles" :key="p.profileName"
            :class="['flex items-center gap-1 rounded px-2 py-0.5 text-xs border', profileStyle(p.state)]">
            <span class="font-mono">{{ p.profileName }}</span>
            <span v-if="p.state === 'busy'"
              class="opacity-50 max-w-[80px] truncate"
              :title="(p.currentTitle || p.targetUrl) + '\n' + (p.currentUrl || '')">
              {{ p.currentTitle || shortUrl(p.currentUrl || p.targetUrl) }}
            </span>
            <button v-if="p.state === 'busy'" @click="stopNode(w.workerId, p.profileName)"
              class="hover:text-red-400 transition-colors ml-0.5 opacity-50 hover:opacity-100 leading-none">✕</button>
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
const emit  = defineEmits(['refresh']);

const dispatchMode = ref('sequential');
const timeAdjusts  = [
  { label: '-10m', val: -600 },
  { label: '-1m',  val: -60  },
  { label: '+1m',  val: 60   },
  { label: '+10m', val: 600  },
];

onMounted(async () => {
  try { const cfg = await fetchSchedulerConfig(); dispatchMode.value = cfg.dispatch_mode; } catch {}
});

const onlineWorkers = computed(() => props.workers.filter(w => w.connected).length);
const busyNodes     = computed(() => props.workers.reduce((s, w) => s + w.slots.busy, 0));
const idleNodes     = computed(() => props.workers.reduce((s, w) => s + w.slots.idle, 0));

const urlGroups = computed(() => {
  const map = new Map();
  for (const w of props.workers) {
    for (const p of w.profiles) {
      if (p.state === 'busy' && p.targetUrl) {
        if (!map.has(p.targetUrl)) map.set(p.targetUrl, []);
        map.get(p.targetUrl).push({ workerId: w.workerId, profileName: p.profileName });
      }
    }
  }
  return [...map.entries()].map(([url, nodes]) => ({ url, nodes }));
});

function groupByWorker(nodes) {
  const m = {};
  for (const n of nodes) { (m[n.workerId] ??= []).push(n); }
  return m;
}

function profileStyle(state) {
  return {
    idle:  'bg-gray-800/60 text-gray-500 border-gray-700/60',
    busy:  'bg-amber-950/50 text-amber-300 border-amber-800/60',
    error: 'bg-red-950/50 text-red-400 border-red-800/60',
  }[state] ?? 'bg-gray-800/60 text-gray-500 border-gray-700/60';
}

function shortUrl(url) {
  if (!url) return '';
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() || url; } catch { return url; }
}

async function setMode(mode) {
  try { await setSchedulerConfig(mode); dispatchMode.value = mode; } catch (err) { alert(err.message); }
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
