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
          <div class="font-mono text-xs" style="width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-shrink:0; color:var(--primary)" :title="group.url">{{ extractDomain(group.url) }}</div>
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
          <table class="w-full text-xs" style="table-layout:fixed">
            <colgroup>
              <col style="width:28px" />
              <col style="width:130px" />
              <col style="width:158px" />
              <col />
              <col />
              <col style="width:120px" />
            </colgroup>
            <thead style="position:sticky; top:0; z-index:10; background:var(--bg-card)">
              <tr class="border-b border-gray-200 text-gray-600 text-left select-none">
                <th class="pl-3 py-1.5 font-normal"></th>
                <th class="px-2 py-1.5 font-normal">Worker</th>
                <th class="px-2 py-1.5 font-normal">节点</th>
                <th class="px-2 py-1.5 font-normal">标题</th>
                <th class="px-2 py-1.5 font-normal">域名</th>
                <th class="px-2 py-1.5 font-normal text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="w in workers" :key="w.workerId"
                class="border-b border-gray-200 last:border-0 hover:bg-gray-50 transition-colors">
                <td class="pl-3 py-1.5">
                  <span :class="w.connected ? 'bg-emerald-500' : 'bg-red-500'" class="w-1.5 h-1.5 rounded-full block"></span>
                </td>
                <td class="px-2 py-1.5 font-mono" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--primary)">{{ w.workerId }}</td>
                <td class="px-2 py-1.5">
                  <div style="display:flex; gap:2px; flex-wrap:nowrap">
                    <button v-for="p in w.profiles" :key="p.profileName"
                      :title="`${p.profileName}｜${p.state}${p.currentTitle ? '｜' + p.currentTitle : ''}${p.currentUrl ? '\n' + p.currentUrl : ''}`"
                      @click="p.state === 'busy' && stopNode(w.workerId, p.profileName)"
                      :class="['rounded-sm flex-shrink-0 transition-colors',
                        p.state==='busy'  ? 'bg-emerald-500 hover:bg-red-400 cursor-pointer' :
                        p.state==='error' ? 'bg-red-400 cursor-default' : 'bg-gray-300 cursor-default']"
                      style="width:18px; height:14px" />
                  </div>
                </td>
                <td class="px-2 py-1.5" style="overflow:hidden">
                  <div class="truncate text-gray-500" :title="workerTitleFull(w)">{{ workerTitleShort(w) }}</div>
                </td>
                <td class="px-2 py-1.5" style="overflow:hidden">
                  <div class="truncate font-mono text-gray-500" style="font-size:11px" :title="workerDomainFull(w)">{{ workerDomains(w) }}</div>
                </td>
                <td class="px-2 py-1.5">
                  <div style="display:flex; gap:4px; justify-content:flex-end">
                    <button v-if="w.slots.busy > 0" @click="stopWorker(w.workerId)"
                      class="bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded transition-colors"
                      style="width:36px; font-size:11px; padding:1px 0; text-align:center">停止</button>
                    <span style="width:36px; display:inline-block"></span>
                    <span style="width:36px; display:inline-block"></span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
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
import { ref, computed, onMounted, watch } from 'vue';
import {
  stopByUrl, stopWorker as apiStopWorker, stopNode as apiStopNode,
  adjustTime, fetchSchedulerConfig, setSchedulerConfig,
  fetchTemplates, submitTask,
} from '../api.js';

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
function extractDomain(url) {
  if (!url) return '';
  try {
    const parts = new URL(url).hostname.split('.');
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  } catch { return url; }
}

function workerTitleShort(w) {
  const titles = w.profiles.filter(p => p.state === 'busy' && p.currentTitle).map(p => p.currentTitle.slice(0, 2));
  return [...new Set(titles)].join(',') || '';
}

function workerTitleFull(w) {
  return w.profiles.filter(p => p.state === 'busy' && p.currentTitle).map(p => `${p.profileName}: ${p.currentTitle}`).join('\n');
}

function workerDomains(w) {
  const domains = w.profiles.filter(p => p.state === 'busy' && (p.currentUrl || p.targetUrl)).map(p => extractDomain(p.currentUrl || p.targetUrl));
  return [...new Set(domains)].join(',') || '';
}

function workerDomainFull(w) {
  return w.profiles.filter(p => p.state === 'busy' && (p.currentUrl || p.targetUrl)).map(p => p.currentUrl || p.targetUrl).join('\n');
}

// ── 操作 ──────────────────────────────────────────────
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
