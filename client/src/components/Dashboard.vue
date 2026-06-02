<template>
  <div class="db">
    <!-- Worker 列表 -->
    <a-card class="db__card" :bordered="true" :body-style="{ padding: '0', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }">
      <template #title>
        <a-space :size="14" align="center">
          <span class="db__title">Worker 节点</span>
          <a-space :size="10" class="db__legend">
            <span class="db__legend-item"><i class="db__legend-dot db__legend-dot--green"></i>已上榜</span>
            <span class="db__legend-item"><i class="db__legend-dot db__legend-dot--red"></i>未上榜</span>
            <span class="db__legend-item"><i class="db__legend-dot db__legend-dot--orange"></i>未登陆</span>
          </a-space>
        </a-space>
      </template>
      <template #extra>
        <a-space :size="12" align="center" class="db__head-stats">
          <span>在线 <b class="t-success">{{ onlineWorkers }}</b></span>
          <span>运行 <b class="t-warning">{{ busyNodes }}</b></span>
          <span>空闲 <b>{{ idleNodes }}</b></span>
          <a-divider direction="vertical" />
          <span class="t-muted">每次</span>
          <a-input-number v-model="perWorkerBatch" :min="1" size="mini" class="db__batch" @change="savePerWorkerBatch" />
          <span class="t-muted">个/Worker</span>
          <a-divider direction="vertical" />
          <a-radio-group v-model="dispatchMode" type="button" size="mini" @change="setMode">
            <a-radio value="sequential">顺序</a-radio>
            <a-radio value="random">随机</a-radio>
          </a-radio-group>
        </a-space>
      </template>

      <div class="db__content">
        <a-empty v-if="!workers.length" description="无 Worker 连接" class="db__empty" />
        <div v-else class="db__scroll">
          <!-- 列标题行 -->
          <a-row class="db__col-head">
            <a-col flex="16px"></a-col>
            <a-col flex="16px"></a-col>
            <a-col flex="90px">节点</a-col>
            <a-col flex="52px">登录</a-col>
            <a-col flex="1">用户名</a-col>
            <a-col flex="56px" class="db__center">排名</a-col>
            <a-col flex="1">进度</a-col>
            <a-col flex="210px" class="db__right">操作</a-col>
          </a-row>

          <template v-for="w in workers" :key="w.workerId">
            <!-- Worker 标题行 -->
            <div class="db__worker-head" @click="toggleWorker(w.workerId)">
              <span class="db__caret">{{ collapsedWorkers.has(w.workerId) ? '▶' : '▼' }}</span>
              <a-checkbox :model-value="selectedWorkers.has(w.workerId)"
                @click.stop="handleWorkerSelect($event, w.workerId)" />
              <a-badge :status="w.connected ? 'success' : 'danger'" />
              <span class="mono db__worker-id">{{ w.workerId }}</span>
              <span v-if="w.slots.busy > 0" class="db__runcount db__runcount--active">
                <i class="db__runcount-dot"></i>运行中 <b>{{ w.slots.busy }}</b>
              </span>
              <span v-else class="db__runcount">{{ w.slots.total }} 节点</span>
              <span class="db__spacer"></span>
              <a-space :size="2" class="db__worker-actions">
                <a-button size="mini" type="text" @click.stop="checkRanklistDwell(w)">获取榜单</a-button>
                <a-button size="mini" type="text" @click.stop="stopUnloggedWorker(w)">停未登陆</a-button>
                <a-button size="mini" type="text" @click.stop="stopUnrankedWorker(w)">停未上榜</a-button>
                <a-button size="mini" type="text" @click.stop="reloadDwell(w)">刷新未上榜</a-button>
                <a-divider direction="vertical" :margin="4" />
                <a-button size="mini" type="text" status="danger" @click.stop="stopWorker(w.workerId)">全停</a-button>
              </a-space>
            </div>

            <!-- 该 Worker 下各 Profile 行 -->
            <template v-if="!collapsedWorkers.has(w.workerId)">
              <a-row v-for="p in w.profiles" :key="p.profileName" align="center" class="db__row">
                <!-- 状态点 -->
                <a-col flex="16px" class="db__dot-cell">
                  <span :class="['db__dot', p.state === 'busy' ? 'db__dot--busy' : p.state === 'error' ? 'db__dot--err' : 'db__dot--idle']"></span>
                </a-col>
                <!-- 勾选占位 -->
                <a-col flex="16px"></a-col>
                <!-- Profile 名 -->
                <a-col flex="90px" class="db__cell-ellipsis">
                  <span class="mono db__profile" :title="p.profileName">{{ p.profileName }}</span>
                </a-col>
                <!-- 登录态 -->
                <a-col flex="52px">
                  <a-tag v-if="p.isLoggedIn === false" size="small" color="orange">未登录</a-tag>
                  <a-tag v-else-if="p.isLoggedIn === true" size="small" color="green">已登录</a-tag>
                  <span v-else class="t-placeholder">—</span>
                </a-col>
                <!-- 用户名 -->
                <a-col flex="1" class="db__cell-ellipsis">
                  <span class="db__nick" :title="p.nickname ?? ''">{{ p.nickname || '' }}</span>
                </a-col>
                <!-- 排名 -->
                <a-col flex="56px" class="db__center">
                  <a-tag v-if="p.rank !== null" size="small" :color="p.rank > 0 ? 'green' : 'red'" class="mono">
                    {{ p.rank > 0 ? '#' + p.rank : '未上榜' }}
                  </a-tag>
                  <span v-else class="t-placeholder">—</span>
                </a-col>
                <!-- 页面标题 + 进度 -->
                <a-col flex="1">
                  <div class="db__progress">
                    <span class="db__page-title" :title="p.currentUrl ?? ''">{{ p.currentTitle || p.currentUrl || '' }}</span>
                    <template v-if="getProgress(w.workerId, p.profileName)">
                      <span class="t-placeholder db__dot-sep">·</span>
                      <span class="mono db__progress-step">{{ getProgress(w.workerId, p.profileName).step }}/{{ getProgress(w.workerId, p.profileName).total }}</span>
                      <span class="db__progress-action">{{ getProgress(w.workerId, p.profileName).action }}</span>
                    </template>
                  </div>
                </a-col>
                <!-- 操作 -->
                <a-col flex="210px">
                  <a-space :size="2" class="db__right-actions">
                    <a-button size="mini" type="text"
                      :disabled="effectiveAction(w.workerId, p) !== 'dwell'"
                      @click="checkRanklist([{ workerId: w.workerId, profileName: p.profileName }])">榜单</a-button>
                    <a-button size="mini" type="text"
                      :disabled="effectiveAction(w.workerId, p) !== 'dwell'"
                      @click="douyinReload([{ workerId: w.workerId, profileName: p.profileName }])">刷新</a-button>
                    <a-button v-if="p.state === 'busy'" size="mini" type="text"
                      @click="takeScreenshot(w.workerId, p.profileName, p.taskId)">截图</a-button>
                    <a-button v-if="p.state === 'busy'" size="mini" type="text" status="danger"
                      @click="stopNode(w.workerId, p.profileName)">停止</a-button>
                  </a-space>
                </a-col>
              </a-row>
            </template>
          </template>
        </div>
      </div>
    </a-card>

    <!-- 发布任务：固定在底部 -->
    <a-card class="db__publish" :bordered="true" :body-style="{ padding: '10px 16px' }">
      <div class="db__publish-row">
        <a-input v-model="form.target_url" placeholder="目标 URL" size="small" class="db__publish-url" />
        <div class="db__templates">
          <a-radio-group v-model="form.task_type" size="small">
            <a-radio v-for="t in templates" :key="t.name" :value="t.name">{{ t.name }}</a-radio>
          </a-radio-group>
        </div>
        <a-divider direction="vertical" />
        <a-space :size="6" align="center">
          <span class="t-muted">数量</span>
          <a-input-number v-model="form.count" :min="1" size="small" class="db__publish-num" />
        </a-space>
        <a-space :size="6" align="center">
          <span class="t-muted">时长</span>
          <a-input-number v-model="form.duration_min" :min="1" size="small" class="db__publish-num" />
          <span class="t-muted">分钟</span>
        </a-space>
        <a-button type="primary" size="small" :loading="submitting" @click="submit">
          {{ submitting ? '提交中…' : '发布' }}
        </a-button>
        <span v-if="submitMsg" :class="submitError ? 't-danger' : 't-success'" class="db__submit-msg">{{ submitMsg }}</span>
      </div>
    </a-card>
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

// ── 当前动作（progressMap 实时优先，回退 currentAction）──
function effectiveAction(workerId, p) {
  return getProgress(workerId, p.profileName)?.action ?? p.currentAction;
}

// ── Worker 级 dwell 批量操作 ──────────────────────────
function checkRanklistDwell(w) {
  const dw = w.profiles.filter(p => p.state === 'busy' && effectiveAction(w.workerId, p) === 'dwell');
  if (!dw.length) { toast('暂无节点处于挂机阶段', 'warn'); return; }
  checkRanklist(dw.map(p => ({ workerId: w.workerId, profileName: p.profileName, rank: p.rank, nickname: p.nickname, isLoggedIn: p.isLoggedIn })));
}
function reloadDwell(w) {
  const dw = w.profiles.filter(p => p.state === 'busy' && effectiveAction(w.workerId, p) === 'dwell' && p.isLoggedIn && (p.rank === null || p.rank <= 0));
  if (!dw.length) { toast('暂无节点处于挂机阶段', 'warn'); return; }
  douyinReload(dw.map(p => ({ workerId: w.workerId, profileName: p.profileName })));
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
  try { await setSchedulerConfig({ dispatch_mode: mode }); dispatchMode.value = mode; } catch (err) { toast(err.message, 'warn'); }
}

async function savePerWorkerBatch() {
  try { await setSchedulerConfig({ per_worker_batch: perWorkerBatch.value }); } catch (err) { toast(err.message, 'warn'); }
}
async function adjust(url, delta) {
  try { await adjustTime(url, delta); emit('refresh'); } catch (err) { toast(err.message, 'warn'); }
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
  toast('截图已发送，完成后自动跳转');
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

<style scoped>
.db { display: flex; flex-direction: column; height: calc(100vh - 96px); gap: 6px; }
.db__card { flex: 1; min-height: 0; overflow: hidden; }
.db__title { font-size: 14px; font-weight: 600; }
.db__legend-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--tx-3); font-weight: 400; }
.db__legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
.db__legend-dot--green  { background: var(--success); }
.db__legend-dot--red    { background: #f98981; }
.db__legend-dot--orange { background: #ff9a4d; }
.db__head-stats { font-size: 12px; color: var(--tx-3); }
.db__batch { width: 56px; }

.t-success { color: var(--success); }
.t-warning { color: var(--warning); }
.t-danger  { color: var(--danger); }
.t-muted   { color: var(--tx-3); }
.t-placeholder { color: var(--tx-4); font-size: 12px; }

.db__content { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.db__empty   { padding: 16px 0; }
.db__scroll  { flex: 1; min-height: 0; overflow-y: auto; }

/* 列标题行（最轻层级）：白底 + 浅灰小字标签，仅作列说明 */
.db__col-head {
  padding: 0 16px;
  height: 34px;
  align-items: center;
  font-size: var(--fs-xs);
  color: var(--tx-3);
  border-bottom: 1px solid var(--bd-color);
  user-select: none;
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg-card);
}
.db__center { text-align: center; }
.db__right  { text-align: right; }

/* Worker 分组头（中间层级）：灰底分组带 + 左侧主色强调条 + 加粗深色 ID */
.db__worker-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  background: #eef1f6;
  border-bottom: 1px solid var(--bd-color);
  border-left: 3px solid var(--primary);
  position: sticky;
  top: 34px;
  z-index: 9;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.db__worker-head:hover { background: #e6eaf2; }
.db__caret { font-size: var(--fs-xs); color: var(--tx-3); width: 10px; flex-shrink: 0; }
.db__worker-id { font-size: var(--fs-sm); font-weight: 700; color: var(--tx-1); flex-shrink: 0; letter-spacing: 0.3px; }
/* 节点状态：空闲时安静浅灰「N 节点」；有运行时实心绿胶囊「运行中 N」 */
.db__runcount {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  font-size: var(--fs-xs);
  color: var(--tx-3);
  border-radius: 11px;
}
.db__runcount b { font-size: var(--fs-sm); font-weight: 700; }
/* 运行中＝活动状态维度，用主色蓝，避开节点状态的绿(上榜)/红(未上榜)/橙(未登陆) */
.db__runcount--active {
  color: #fff;
  background: var(--primary);
}
.db__runcount-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #fff;
  animation: db-pulse 1.4s ease-in-out infinite;
}
@keyframes db-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.db__spacer { flex: 1; }

/* Profile 数据行（最底层级）：白底，hover 浅灰，左侧缩进与强调条对齐 */
.db__row {
  min-height: var(--table-row-h);
  padding: 4px 10px 4px 13px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--bd-color);
  transition: background 0.15s;
}
.db__row:hover { background: var(--bg-page); }

.db__dot-cell { padding-left: 4px; }
.db__dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.db__dot--busy { background: var(--success); }
.db__dot--err  { background: #f98981; }
.db__dot--idle { background: var(--idle-block); }

.db__cell-ellipsis { overflow: hidden; }
.db__profile { font-size: var(--fs-sm); color: var(--tx-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.db__nick { font-size: var(--fs-sm); color: var(--tx-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }

.db__progress { display: flex; align-items: center; gap: 4px; overflow: hidden; min-width: 0; }
.db__page-title { font-size: var(--fs-xs); color: var(--tx-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db__dot-sep { flex-shrink: 0; }
.db__progress-step { font-size: var(--fs-xs); color: var(--tx-4); flex-shrink: 0; }
.db__progress-action { font-size: var(--fs-xs); color: var(--tx-3); flex-shrink: 0; }

.db__right-actions { justify-content: flex-end; width: 100%; }

.db__publish { flex-shrink: 0; }
.db__publish-row { display: flex; align-items: center; gap: 12px; }
.db__publish-url { flex: 1; min-width: 200px; }
.db__templates { display: flex; align-items: center; max-width: 420px; overflow-x: auto; flex-shrink: 1; }
.db__templates :deep(.arco-radio-group) { white-space: nowrap; }
.db__publish-num { width: 80px; }
.db__submit-msg { font-size: 12px; flex-shrink: 0; }
</style>
