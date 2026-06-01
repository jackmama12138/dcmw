<template>
  <div style="display:flex; flex-direction:column; height:calc(100vh - 96px); gap:6px">

    <!-- ① 统计栏 -->
    <div style="display:flex; align-items:center; gap:8px; flex-shrink:0"
      class="bg-white border border-gray-200 rounded-lg px-3 py-1.5">
      <span class="text-xs text-gray-500">在线</span>
      <span class="text-sm font-bold" style="min-width:20px; text-align:center; color:var(--success)">{{ onlineWorkers }}</span>
      <span style="color:var(--tx-4)">·</span>
      <span class="text-xs text-gray-500">运行</span>
      <span class="text-sm font-bold" style="min-width:20px; text-align:center; color:var(--warning)">{{ busyNodes }}</span>
      <span style="color:var(--tx-4)">·</span>
      <span class="text-xs text-gray-500">空闲</span>
      <span class="text-sm font-bold text-gray-600" style="min-width:20px; text-align:center">{{ idleNodes }}</span>
      <span style="flex:1"></span>
      <span class="text-xs text-gray-400">调度</span>
      <button @click="setMode('sequential')"
        :class="['text-xs px-2 py-0.5 rounded transition-colors', dispatchMode==='sequential' ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200']"
        :style="dispatchMode==='sequential' ? 'background:var(--primary)' : ''">顺序</button>
      <button @click="setMode('random')"
        :class="['text-xs px-2 py-0.5 rounded transition-colors', dispatchMode==='random' ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200']"
        :style="dispatchMode==='random' ? 'background:var(--primary)' : ''">随机</button>
    </div>

    <!-- ② 中间区域 (flex-1)：URL + Worker -->
    <div style="flex:1; min-height:0; display:flex; flex-direction:column; gap:6px">

      <!-- 执行中 URL：内容自适应，最多 30vh，超出滚动 -->
      <div class="bg-white border border-gray-200 rounded-lg overflow-y-auto" style="flex-shrink:0; max-height:30vh">
        <div v-if="!urlGroups.length" class="text-xs text-gray-600 text-center py-3">暂无执行中的任务</div>
        <div v-for="group in urlGroups" :key="group.url"
          style="display:flex; align-items:center; gap:8px; padding:6px 12px; border-bottom:1px solid var(--bd-color)"
          class="hover:bg-gray-50 transition-colors">
          <div class="font-mono text-xs" style="width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-shrink:0; color:var(--primary)" :title="group.url">{{ group.url }}</div>
          <span class="text-xs text-gray-400" style="width:24px; text-align:right; flex-shrink:0">{{ group.nodes.length }}</span>
          <div style="flex:1; min-width:0; display:flex; align-items:center; overflow:hidden; gap:4px">
            <template v-for="(nodes, wid) in groupByWorker(group.nodes)" :key="wid">
              <div style="display:flex; gap:1px; flex-shrink:0">
                <button v-for="n in nodes" :key="n.profileName"
                  :title="`${wid} · ${n.profileName}\n点击停止`"
                  @click="stopNode(n.workerId, n.profileName)"
                  style="width:14px; height:12px; border-radius:2px; flex-shrink:0"
                  class="bg-emerald-500 hover:bg-red-500 transition-colors cursor-pointer" />
              </div>
            </template>
          </div>
          <div style="display:flex; align-items:center; gap:2px; flex-shrink:0">
            <button v-for="d in timeAdjusts" :key="d.label" @click="adjust(group.url, d.val)"
              class="text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
              style="font-size:10px; padding:1px 4px">{{ d.label }}</button>
            <button @click="checkRanklist(group.nodes)"
              class="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-500 rounded transition-colors"
              style="font-size:10px; padding:1px 6px; margin-left:4px">榜单</button>
            <button @click="douyinReload(group.nodes)"
              class="bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded transition-colors"
              style="font-size:10px; padding:1px 6px">刷新</button>
            <button @click="stopUrl(group.url)"
              class="bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded transition-colors"
              style="font-size:10px; padding:1px 6px; margin-left:4px">停止</button>
          </div>
        </div>
      </div>

      <!-- Worker 状态：占满中间区域剩余空间，超出内部滚动 -->
      <div class="bg-white border border-gray-200 rounded-lg" style="flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column">
        <div v-if="!workers.length" class="text-xs text-gray-600 text-center py-4">无 Worker 连接</div>
        <div v-else style="flex:1; min-height:0; overflow-y:auto">
          <template v-for="w in workers" :key="w.workerId">
            <!-- Worker 标题行 -->
            <div @click="toggleWorker(w.workerId)" style="display:flex; align-items:center; gap:6px; padding:4px 10px; background:var(--bg-page); border-bottom:1px solid var(--bd-color); position:sticky; top:0; z-index:10; cursor:pointer; user-select:none">
              <span class="text-gray-400 flex-shrink-0" style="font-size:10px; width:10px">{{ collapsedWorkers.has(w.workerId) ? '▶' : '▼' }}</span>
              <span :class="w.connected ? 'bg-emerald-500' : 'bg-red-500'" class="w-1.5 h-1.5 rounded-full flex-shrink-0"></span>
              <span class="font-mono text-xs font-medium" style="color:var(--primary)">{{ w.workerId }}</span>
              <span class="text-xs text-gray-400">{{ w.slots.busy }}/{{ w.slots.total }} 运行</span>
              <span style="flex:1"></span>
              <button @click.stop="checkRanklist(w.profiles.filter(p=>p.state==='busy').map(p=>({workerId:w.workerId,profileName:p.profileName})))"
                class="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-500 rounded transition-colors"
                style="font-size:10px; padding:1px 6px">榜单</button>
              <button @click.stop="douyinReload(w.profiles.filter(p=>p.state==='busy').map(p=>({workerId:w.workerId,profileName:p.profileName})))"
                class="bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded transition-colors"
                style="font-size:10px; padding:1px 6px">刷新所有节点</button>
              <button v-if="w.slots.busy > 0" @click.stop="stopWorker(w.workerId)"
                class="bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded transition-colors"
                style="font-size:10px; padding:1px 8px">停止全部</button>
            </div>
            <!-- 该 Worker 下各 Profile 行 -->
            <div v-if="!collapsedWorkers.has(w.workerId)"
              v-for="p in w.profiles" :key="p.profileName"
              class="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors"
              style="display:flex; align-items:center; gap:6px; padding:4px 10px 4px 24px">
              <!-- 状态点 -->
              <span :class="p.state==='busy' ? 'bg-emerald-500' : p.state==='error' ? 'bg-red-400' : 'bg-gray-300'"
                class="w-1.5 h-1.5 rounded-full flex-shrink-0"></span>
              <!-- Profile 名 -->
              <span class="text-xs text-gray-500 font-mono flex-shrink-0" style="width:72px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" :title="p.profileName">{{ p.profileName }}</span>
              <!-- rank 标签 -->
              <span v-if="p.rank !== null"
                :class="p.rank > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-red-50 border-red-200 text-red-500'"
                class="border rounded flex-shrink-0 font-mono"
                style="font-size:10px; padding:0 4px; min-width:28px; text-align:center">
                {{ p.rank > 0 ? '#' + p.rank : '未上榜' }}
              </span>
              <span v-else class="text-gray-300 flex-shrink-0" style="font-size:10px; min-width:28px">—</span>
              <!-- 页面标题 + 进度（单行） -->
              <div class="flex-shrink-1" style="min-width:0; display:flex; align-items:center; gap:4px; overflow:hidden">
                <span class="text-xs text-gray-400 truncate" :title="p.currentUrl ?? ''">{{ p.currentTitle || p.currentUrl || '' }}</span>
                <template v-if="getProgress(w.workerId, p.profileName)">
                  <span class="text-gray-300 flex-shrink-0" style="font-size:10px">·</span>
                  <span class="text-gray-400 font-mono flex-shrink-0" style="font-size:10px">{{ getProgress(w.workerId, p.profileName).step }}/{{ getProgress(w.workerId, p.profileName).total }}</span>
                  <span class="text-gray-400 flex-shrink-0" style="font-size:10px">{{ getProgress(w.workerId, p.profileName).action }}</span>
                </template>
              </div>
              <!-- 操作 -->
              <div style="display:flex; gap:3px; flex-shrink:0; margin-left:auto">
                <button @click="checkRanklist([{ workerId: w.workerId, profileName: p.profileName }])"
                  class="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-500 rounded transition-colors"
                  style="font-size:10px; padding:0 5px">榜单</button>
                <button @click="douyinReload([{ workerId: w.workerId, profileName: p.profileName }])"
                  class="bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded transition-colors"
                  style="font-size:10px; padding:0 5px">刷新</button>
                <button v-if="p.state === 'busy'" @click="stopNode(w.workerId, p.profileName)"
                  class="bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded transition-colors"
                  style="font-size:10px; padding:0 5px">停止</button>
              </div>
            </div>
          </template>
        </div>
      </div>

    </div><!-- /中间区域 -->

    <!-- ③ 发布任务：固定在底部 -->
    <div class="bg-white border border-gray-200 rounded-lg" style="flex-shrink:0; display:flex; align-items:center; gap:12px; padding:10px 16px">
      <input v-model="form.target_url" placeholder="目标 URL" type="text"
        class="bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-blue-400"
        style="flex:1; min-width:200px" />
      <div style="display:flex; align-items:center; gap:8px; max-width:420px; overflow-x:auto; flex-shrink:1; scrollbar-width:none">
        <label v-for="t in templates" :key="t.name"
          class="text-xs text-gray-400 hover:text-gray-800 cursor-pointer"
          style="display:flex; align-items:center; gap:4px; white-space:nowrap; flex-shrink:0">
          <input type="radio" v-model="form.task_type" :value="t.name" class="accent-indigo-500 cursor-pointer" />
          {{ t.name }}
        </label>
      </div>
      <span class="text-gray-700" style="flex-shrink:0">|</span>
      <div style="display:flex; align-items:center; gap:6px; flex-shrink:0">
        <span class="text-xs text-gray-500">数量</span>
        <input v-model.number="form.count" type="number" min="1"
          class="bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400 text-center"
          style="width:56px" />
      </div>
      <div style="display:flex; align-items:center; gap:6px; flex-shrink:0">
        <span class="text-xs text-gray-500">时长</span>
        <input v-model.number="form.duration_min" type="number" min="1"
          class="bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400 text-center"
          style="width:60px" />
        <span class="text-xs text-gray-600">分钟</span>
      </div>
      <button @click="submit" :disabled="submitting"
        class="bg-primary hover:bg-primary-hover text-white disabled:opacity-50 px-4 py-1.5 rounded text-xs font-medium transition-colors"
        style="flex-shrink:0">
        {{ submitting ? '提交中…' : '发布' }}
      </button>
      <span v-if="submitMsg" :class="submitError ? 'text-red-500' : 'text-emerald-600'" class="text-xs" style="flex-shrink:0">{{ submitMsg }}</span>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, inject } from 'vue';
import {
  adjustTime, fetchSchedulerConfig, setSchedulerConfig,
  fetchTemplates, submitTask,
} from '../api.js';

const wsSend       = inject('wsSend', () => {});
const progressMap  = inject('progressMap', ref({}));

const props = defineProps({ workers: { type: Array, default: () => [] } });
const emit  = defineEmits(['refresh']);

// ── 调度模式 ──────────────────────────────────────────
const dispatchMode = ref('sequential');
const timeAdjusts  = [
  { label: '-10m', val: -600 },
  { label: '-1m',  val: -60  },
  { label: '+1m',  val: 60   },
  { label: '+10m', val: 600  },
];

// ── 发布任务表单（localStorage 缓存）─────────────────
const CACHE_KEY = 'dcmw_submit_form';
const templates   = ref([]);
const submitting  = ref(false);
const submitMsg   = ref('');
const submitError = ref(false);

const defaultForm = () => ({ target_url: '', task_type: '', count: 5, duration_min: 60 });

function loadCache() {
  try { return { ...defaultForm(), ...JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') }; }
  catch { return defaultForm(); }
}

const form = ref(loadCache());

watch(form, v => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(v));
}, { deep: true });

// ── 统计 ──────────────────────────────────────────────
const collapsedWorkers = ref(new Set());
function toggleWorker(id) {
  const s = new Set(collapsedWorkers.value);
  s.has(id) ? s.delete(id) : s.add(id);
  collapsedWorkers.value = s;
}

const onlineWorkers = computed(() => props.workers.filter(w => w.connected).length);
const busyNodes     = computed(() => props.workers.reduce((s, w) => s + w.slots.busy, 0));
const idleNodes     = computed(() => props.workers.reduce((s, w) => s + w.slots.idle, 0));

// ── 执行中 URL ────────────────────────────────────────
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

// ── 辅助函数 ──────────────────────────────────────────

// ── 操作 ──────────────────────────────────────────────
async function setMode(mode) {
  try { await setSchedulerConfig(mode); dispatchMode.value = mode; } catch (err) { alert(err.message); }
}
async function adjust(url, delta) {
  try { await adjustTime(url, delta); emit('refresh'); } catch (err) { alert(err.message); }
}
function stopUrl(url) {
  if (!confirm(`停止所有执行 "${url}" 的节点？`)) return;
  wsSend({ type: 'stop_url', target_url: url });
}
function getProgress(workerId, profileName) {
  return progressMap.value[`${workerId}:${profileName}`] ?? null;
}
function progressPct(workerId, profileName) {
  const p = getProgress(workerId, profileName);
  if (!p || !p.total) return 0;
  return Math.round((p.step / p.total) * 100);
}

function getProfileRank(workerId, profileName) {
  return props.workers.find(w => w.workerId === workerId)
    ?.profiles.find(p => p.profileName === profileName)?.rank ?? null;
}

function checkRanklist(nodes) {
  // 已有排名（rank > 0）的节点跳过
  const targets = nodes
    .filter(n => (getProfileRank(n.workerId, n.profileName) ?? 0) <= 0)
    .map(n => ({ worker_id: n.workerId, profile: n.profileName }));
  if (targets.length) wsSend({ type: 'ranklist_check', targets });
}
function douyinReload(nodes) {
  for (const n of nodes) {
    wsSend({ type: 'run_action', worker_id: n.workerId, profile: n.profileName, action: 'douyin-reload' });
  }
}
function stopWorker(workerId) {
  if (!confirm(`停止 Worker ${workerId} 上所有节点？`)) return;
  wsSend({ type: 'stop_worker', worker_id: workerId });
}
function stopNode(workerId, profile) {
  wsSend({ type: 'stop_node', worker_id: workerId, profile });
}

async function submit() {
  submitMsg.value = '';
  submitError.value = false;
  if (!form.value.target_url) { submitMsg.value = '请填写目标 URL'; submitError.value = true; return; }
  if (!form.value.task_type) { submitMsg.value = '请选择任务类型'; submitError.value = true; return; }
  submitting.value = true;
  try {
    await submitTask({
      target_url: form.value.target_url,
      task_type:  form.value.task_type,
      count:      form.value.count,
      task_time:  form.value.duration_min * 60,
    });
    submitMsg.value = '已发布';
    emit('refresh');
    setTimeout(() => { submitMsg.value = ''; }, 3000);
  } catch (err) {
    const d = err.response?.data;
    submitMsg.value = d?.error ?? err.message;
    submitError.value = true;
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  try { const cfg = await fetchSchedulerConfig(); dispatchMode.value = cfg.dispatch_mode; } catch {}
  templates.value = await fetchTemplates().catch(() => []);
  if (!form.value.task_type && templates.value.length) {
    form.value.task_type = templates.value[0].name;
  }
});
</script>
