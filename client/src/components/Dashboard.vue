<template>
  <div style="display:flex; flex-direction:column; height:calc(100vh - 96px); gap:6px">

    <!-- Worker 列表 -->
    <div class="bg-white border border-gray-200 rounded-xl" style="flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column">
      <!-- 标题栏 -->
      <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between" style="flex-shrink:0">
        <h2 class="text-sm font-semibold">Worker 节点</h2>
        <div class="flex items-center gap-3 text-xs text-gray-600">
          <span>在线 <b style="color:var(--success)">{{ onlineWorkers }}</b></span>
          <span>运行 <b style="color:var(--warning)">{{ busyNodes }}</b></span>
          <span>空闲 <b>{{ idleNodes }}</b></span>
          <span style="color:#d1d5db">|</span>
          <span class="text-gray-400">每次</span>
          <input v-model.number="perWorkerBatch" @change="savePerWorkerBatch" type="number" min="1"
            class="bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400 text-center"
            style="width:36px" />
          <span class="text-gray-400">个/Worker</span>
          <span style="color:#d1d5db">|</span>
          <button @click="setMode('sequential')"
            :class="['text-xs px-2 py-0.5 rounded transition-colors', dispatchMode==='sequential' ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200']"
            :style="dispatchMode==='sequential' ? 'background:var(--primary)' : ''">顺序</button>
          <button @click="setMode('random')"
            :class="['text-xs px-2 py-0.5 rounded transition-colors', dispatchMode==='random' ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200']"
            :style="dispatchMode==='random' ? 'background:var(--primary)' : ''">随机</button>
        </div>
      </div>
      <!-- Worker 内容 -->
      <div style="flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column">
        <div v-if="!workers.length" class="text-xs text-gray-600 text-center py-4">无 Worker 连接</div>
        <div v-else style="flex:1; min-height:0; overflow-y:auto">
          <!-- 列标题行 -->
          <div class="grid items-center border-b border-gray-200 px-4 py-2 text-xs text-gray-600 select-none"
            style="grid-template-columns:16px 16px 90px 52px 1fr 56px 1fr minmax(210px,auto); position:sticky; top:0; z-index:10; background:#fff">
            <span></span>
            <span></span>
            <span>节点</span>
            <span>登录</span>
            <span>用户名</span>
            <span class="text-center">排名</span>
            <span>进度</span>
            <span class="text-right">操作</span>
          </div>
          <template v-for="w in workers" :key="w.workerId">
            <!-- Worker 标题行 -->
            <div @click="toggleWorker(w.workerId)"
              style="display:flex; align-items:center; gap:6px; padding:5px 10px; background:var(--bg-page); border-bottom:1px solid var(--bd-color); position:sticky; top:25px; z-index:9; cursor:pointer; user-select:none">
              <span class="text-xs text-gray-400 flex-shrink-0" style="width:10px">{{ collapsedWorkers.has(w.workerId) ? '▶' : '▼' }}</span>
              <input type="checkbox" :checked="selectedWorkers.has(w.workerId)"
                @click.stop="handleWorkerSelect($event, w.workerId)"
                style="cursor:pointer; flex-shrink:0" />
              <span :class="w.connected ? 'bg-emerald-400' : 'bg-red-400'" class="rounded-full flex-shrink-0" style="width:6px; height:6px"></span>
              <span class="font-mono text-xs font-semibold text-gray-800 flex-shrink-0">{{ w.workerId }}</span>
              <span class="text-xs text-gray-400 flex-shrink-0 bg-gray-100 border border-gray-200 rounded font-mono" style="padding:0 5px; line-height:18px">{{ w.slots.busy }}/{{ w.slots.total }}</span>
              <span style="flex:1"></span>
              <div style="display:flex; gap:4px; flex-shrink:0">
                <button @click.stop="()=>{ const dw=w.profiles.filter(p=>p.state==='busy'&&p.currentAction==='dwell'); if(!dw.length){toast('暂无节点处于挂机阶段','warn');return;} checkRanklist(dw.map(p=>({workerId:w.workerId,profileName:p.profileName,rank:p.rank,nickname:p.nickname,isLoggedIn:p.isLoggedIn}))) }"
                  class="text-xs bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 rounded transition-colors" style="padding:1px 7px">获取榜单</button>
                <button @click.stop="stopUnloggedWorker(w)"
                  class="text-xs bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded transition-colors" style="padding:1px 7px">停未登陆</button>
                <button @click.stop="stopUnrankedWorker(w)"
                  class="text-xs bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-500 rounded transition-colors" style="padding:1px 7px">停未上榜</button>
                <button @click.stop="douyinReload(w.profiles.filter(p=>p.state==='busy' && p.isLoggedIn && (p.rank===null||p.rank<=0)).map(p=>({workerId:w.workerId,profileName:p.profileName})))"
                  class="text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded transition-colors" style="padding:1px 7px">刷新未上榜</button>
                <button @click.stop="stopWorker(w.workerId)"
                  class="text-xs bg-pink-50 hover:bg-pink-100 border border-pink-200 text-pink-500 rounded transition-colors" style="padding:1px 7px">全停</button>
              </div>
            </div>
            <!-- 该 Worker 下各 Profile 行 -->
            <template v-if="!collapsedWorkers.has(w.workerId)">
              <div v-for="p in w.profiles" :key="p.profileName"
                class="hover:bg-gray-50 transition-colors"
                style="display:grid; grid-template-columns:16px 16px 90px 52px 1fr 56px 1fr minmax(210px,auto); align-items:center; padding:5px 10px; border-bottom:1px solid var(--bd-color)">
                <!-- 状态点 -->
                <span style="padding-left:4px">
                  <span :class="p.state==='busy' ? 'bg-emerald-500' : p.state==='error' ? 'bg-red-400' : 'bg-gray-300'"
                    class="w-1.5 h-1.5 rounded-full inline-block"></span>
                </span>
                <!-- 勾选占位 -->
                <span></span>
                <!-- Profile 名 -->
                <span class="text-xs font-mono text-gray-500 truncate" :title="p.profileName">{{ p.profileName }}</span>
                <!-- 登录态 -->
                <span>
                  <span v-if="p.isLoggedIn === false"
                    class="text-xs border rounded bg-red-50 border-red-200 text-red-500" style="padding:0 4px; white-space:nowrap">未登录</span>
                  <span v-else-if="p.isLoggedIn === true"
                    class="text-xs border rounded bg-emerald-50 border-emerald-200 text-emerald-600" style="padding:0 4px; white-space:nowrap">已登录</span>
                  <span v-else class="text-xs text-gray-300">—</span>
                </span>
                <!-- 用户名 -->
                <span class="text-xs text-gray-600 truncate" :title="p.nickname ?? ''">{{ p.nickname || '' }}</span>
                <!-- 排名 -->
                <span class="text-center">
                  <span v-if="p.rank !== null"
                    :class="p.rank > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-orange-50 border-orange-200 text-orange-500'"
                    class="text-xs border rounded font-mono" style="padding:0 4px">
                    {{ p.rank > 0 ? '#' + p.rank : '未上榜' }}
                  </span>
                  <span v-else class="text-xs text-gray-300">—</span>
                </span>
                <!-- 页面标题 + 进度 -->
                <div style="display:flex; align-items:center; gap:4px; overflow:hidden; min-width:0">
                  <span class="text-xs text-gray-400 truncate" :title="p.currentUrl ?? ''">{{ p.currentTitle || p.currentUrl || '' }}</span>
                  <template v-if="getProgress(w.workerId, p.profileName)">
                    <span class="text-xs text-gray-300 flex-shrink-0">·</span>
                    <span class="text-xs text-gray-400 font-mono flex-shrink-0">{{ getProgress(w.workerId, p.profileName).step }}/{{ getProgress(w.workerId, p.profileName).total }}</span>
                    <span class="text-xs text-gray-400 flex-shrink-0">{{ getProgress(w.workerId, p.profileName).action }}</span>
                  </template>
                </div>
                <!-- 操作 -->
                <div style="display:flex; justify-content:flex-end; gap:3px">
                  <button @click="checkRanklist([{ workerId: w.workerId, profileName: p.profileName }])"
                    :disabled="p.currentAction !== 'dwell'"
                    :class="p.currentAction === 'dwell' ? 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-500' : 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'"
                    class="text-xs border rounded transition-colors" style="padding:0 5px">榜单</button>
                  <button @click="douyinReload([{ workerId: w.workerId, profileName: p.profileName }])"
                    class="text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded transition-colors" style="padding:0 5px">刷新</button>
                  <button v-if="p.state === 'busy'" @click="takeScreenshot(w.workerId, p.profileName, p.taskId)"
                    class="text-xs bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-500 rounded transition-colors" style="padding:0 5px">截图</button>
                  <button v-if="p.state === 'busy'" @click="stopNode(w.workerId, p.profileName)"
                    class="text-xs bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded transition-colors" style="padding:0 5px">停止</button>
                </div>
              </div>
            </template>
          </template>
        </div>
      </div><!-- /Worker 内容 -->
    </div><!-- /Worker 列表卡片 -->

    <!-- 发布任务：固定在底部 -->
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
  fetchTemplates, submitTask, triggerScreenshot,
} from '../api.js';

const props = defineProps({ workers: { type: Array, default: () => [] } });
const emit  = defineEmits(['refresh']);

const wsSend       = inject('wsSend', () => {});
const progressMap  = inject('progressMap', ref({}));
const setTab       = inject('setTab', () => {});
const toast        = inject('toast', () => {});

// ── 榜单回流追踪 ──────────────────────────────────────
const pendingRankKeys = ref(new Set());
const rankSentTotal   = ref(0);

watch(() => props.workers, (newWorkers) => {
  if (!newWorkers?.length || !pendingRankKeys.value.size) return;
  const pending = new Set(pendingRankKeys.value);
  let changed = false;
  for (const w of newWorkers) {
    for (const p of w.profiles) {
      if (pending.has(`${w.workerId}:${p.profileName}`) && p.rank !== null) {
        pending.delete(`${w.workerId}:${p.profileName}`);
        changed = true;
      }
    }
  }
  if (!changed) return;
  pendingRankKeys.value = pending;
  if (!pending.size) {
    toast(`榜单已全部返回（${rankSentTotal.value} 个节点）`, 'success');
    rankSentTotal.value = 0;
  }
}, { deep: true });

// ── 调度模式 & 每次启动数 ──────────────────────────────
const dispatchMode   = ref('sequential');
const perWorkerBatch = ref(1);
const selectedWorkers = ref(new Set());
const lastSelectedWorkerId = ref(null);
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
        map.get(p.targetUrl).push({ workerId: w.workerId, profileName: p.profileName, isLoggedIn: p.isLoggedIn, rank: p.rank });
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

// ── Worker 多选 ───────────────────────────────────────
function toggleSelectWorker(wid) {
  const s = new Set(selectedWorkers.value);
  s.has(wid) ? s.delete(wid) : s.add(wid);
  selectedWorkers.value = s;
}

function handleWorkerSelect(e, wid) {
  const ids = props.workers.map(w => w.workerId);
  const idx = ids.indexOf(wid);
  if (e.shiftKey && lastSelectedWorkerId.value !== null) {
    const lastIdx = ids.indexOf(lastSelectedWorkerId.value);
    const from = Math.min(idx, lastIdx);
    const to   = Math.max(idx, lastIdx);
    const s = new Set(selectedWorkers.value);
    for (let i = from; i <= to; i++) s.add(ids[i]);
    selectedWorkers.value = s;
  } else {
    toggleSelectWorker(wid);
  }
  lastSelectedWorkerId.value = wid;
}

// ── 操作 ──────────────────────────────────────────────
async function setMode(mode) {
  try { await setSchedulerConfig({ dispatch_mode: mode }); dispatchMode.value = mode; } catch (err) { alert(err.message); }
}

async function savePerWorkerBatch() {
  try { await setSchedulerConfig({ per_worker_batch: perWorkerBatch.value }); } catch (err) { alert(err.message); }
}
async function adjust(url, delta) {
  try { await adjustTime(url, delta); emit('refresh'); } catch (err) { alert(err.message); }
}
function stopUrl(url) {
  wsSend({ type: 'stop_url', target_url: url });
  toast(`已停止 URL: ${url.slice(0, 40)}${url.length > 40 ? '…' : ''}`);
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
  const targets = nodes
    .filter(n => (getProfileRank(n.workerId, n.profileName) ?? 0) <= 0)
    .map(n => ({ worker_id: n.workerId, profile: n.profileName }));
  if (!targets.length) { toast('无需检查（均已上榜）', 'warn'); return; }
  for (const t of targets) pendingRankKeys.value.add(`${t.worker_id}:${t.profile}`);
  rankSentTotal.value += targets.length;
  wsSend({ type: 'ranklist_check', targets });
  toast(`已向 ${targets.length} 个节点发送榜单检查`);
}
function douyinReload(nodes) {
  if (!nodes.length) { toast('无需刷新的节点', 'warn'); return; }
  for (const n of nodes) wsSend({ type: 'run_action', worker_id: n.workerId, profile: n.profileName, action: 'douyin-reload' });
  toast(`已刷新 ${nodes.length} 个节点`);
}
function stopWorker(workerId) {
  wsSend({ type: 'stop_worker', worker_id: workerId });
  toast(`已停止 Worker ${workerId} 所有节点`);
}
function stopNode(workerId, profile) {
  wsSend({ type: 'stop_node', worker_id: workerId, profile });
  toast(`已停止节点 ${profile}`);
}
async function takeScreenshot(workerId, profile, taskId) {
  await triggerScreenshot({ worker_id: workerId, profile, task_id: taskId });
  setTab('screenshots');
}

function stopGroupUnlogged(nodes) {
  const targets = nodes.filter(n => n.isLoggedIn === false);
  if (!targets.length) { toast('无未登录节点', 'warn'); return; }
  for (const n of targets) wsSend({ type: 'stop_node', worker_id: n.workerId, profile: n.profileName });
  toast(`已停止 ${targets.length} 个未登录节点`);
}

function stopGroupUnranked(nodes) {
  const targets = nodes.filter(n => n.isLoggedIn === true && (n.rank === null || n.rank <= 0));
  if (!targets.length) { toast('无未上榜节点', 'warn'); return; }
  for (const n of targets) wsSend({ type: 'stop_node', worker_id: n.workerId, profile: n.profileName });
  toast(`已停止 ${targets.length} 个未上榜节点`);
}

function stopUnloggedWorker(w) {
  const targets = w.profiles.filter(p => p.isLoggedIn === false && p.state === 'busy');
  if (!targets.length) { toast(`${w.workerId} 无未登录节点`, 'warn'); return; }
  for (const p of targets) wsSend({ type: 'stop_node', worker_id: w.workerId, profile: p.profileName });
  toast(`已停止 ${w.workerId} 上 ${targets.length} 个未登录节点`);
}

function stopUnrankedWorker(w) {
  const targets = w.profiles.filter(p => p.isLoggedIn === true && (p.rank === null || p.rank <= 0) && p.state === 'busy');
  if (!targets.length) { toast(`${w.workerId} 无未上榜节点`, 'warn'); return; }
  for (const p of targets) wsSend({ type: 'stop_node', worker_id: w.workerId, profile: p.profileName });
  toast(`已停止 ${w.workerId} 上 ${targets.length} 个未上榜节点`);
}

async function submit() {
  submitMsg.value = '';
  submitError.value = false;
  if (!form.value.target_url) { submitMsg.value = '请填写目标 URL'; submitError.value = true; return; }
  if (!form.value.task_type) { submitMsg.value = '请选择任务类型'; submitError.value = true; return; }
  submitting.value = true;
  try {
    const payload = {
      target_url: form.value.target_url,
      task_type:  form.value.task_type,
      count:      form.value.count,
      task_time:  form.value.duration_min * 60,
    };
    if (selectedWorkers.value.size > 0) {
      payload.target_worker_ids = [...selectedWorkers.value];
    }
    await submitTask(payload);
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
  try { const cfg = await fetchSchedulerConfig(); dispatchMode.value = cfg.dispatch_mode; perWorkerBatch.value = cfg.per_worker_batch ?? 1; } catch {}
  templates.value = await fetchTemplates().catch(() => []);
  if (!form.value.task_type && templates.value.length) {
    form.value.task_type = templates.value[0].name;
  }
});
</script>

