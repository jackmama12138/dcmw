<template>
  <a-card class="at-card" :bordered="true" :body-style="{ padding: '0' }">
    <template #title><span class="at__title">执行中</span></template>
    <template #extra>
      <a-space :size="16">
        <a-space :size="10" class="at__legend">
          <span class="at__legend-item"><i class="at__dot at__node--green"></i>已上榜</span>
          <span class="at__legend-item"><i class="at__dot at__node--red"></i>未上榜</span>
          <span class="at__legend-item"><i class="at__dot at__node--orange"></i>未登陆</span>
        </a-space>
        <a-divider direction="vertical" />
        <span class="at__meta">运行中 <b class="t-amber">{{ totalRunning }}</b> 个节点</span>
        <span class="at__meta">共 <b>{{ urlGroups.length }}</b> 个 URL</span>
      </a-space>
    </template>

    <div class="at__body">
      <!-- 列标题行 -->
      <div class="at__head">
        <span>目标 URL</span>
        <span></span>
        <span class="at__head-center">节点数</span>
        <span class="at__head-right">操作</span>
      </div>

      <a-empty v-if="!urlGroups.length" description="暂无执行中的任务" class="at__empty" />

      <div v-for="group in urlGroups" :key="group.url" class="at__row">
        <!-- URL -->
        <div class="mono at__url" :title="group.url">{{ group.url }}</div>

        <!-- 节点色块 -->
        <div class="at__nodes">
          <a-tooltip v-for="n in group.nodes" :key="`${n.workerId}:${n.profileName}`"
            :content="nodeTip(n)" mini>
            <button
              :class="['at__node', nodeClass(n)]"
              @click="stopNode(n.workerId, n.profileName)" />
          </a-tooltip>
        </div>

        <!-- 节点数 -->
        <span class="mono at__count">{{ group.nodes.length }}</span>

        <!-- 操作按钮 -->
        <a-space :size="2" class="at__actions">
          <a-button size="mini" type="text" @click="adjustUrl(group.url, 1800)">+30m</a-button>
          <a-divider direction="vertical" :margin="4" />
          <a-button size="mini" type="text" @click="screenshotGroup(group.nodes)">截图</a-button>
          <a-button size="mini" type="text" @click="checkRanklistUrl(group.nodes)">获取榜单</a-button>
          <a-divider direction="vertical" :margin="4" />
          <a-button size="mini" type="text" @click="stopGroupUnlogged(group.nodes)">停未登陆</a-button>
          <a-button size="mini" type="text" @click="stopGroupUnranked(group.nodes)">停未上榜</a-button>
          <a-button size="mini" type="text" @click="reloadUnrankedUrl(group.nodes)">刷新未上榜</a-button>
          <a-divider direction="vertical" :margin="4" />
          <a-button size="mini" type="text" status="danger" @click="stopUrl(group.url)">全停</a-button>
        </a-space>
      </div>
    </div>
  </a-card>
</template>

<script setup>
import { computed, inject, ref } from 'vue';
import { adjustTime, triggerScreenshot } from '../api.js';

const props       = defineProps({ workers: { type: Array, default: () => [] } });
const wsSend      = inject('wsSend', () => {});
const toast       = inject('toast', () => {});
const progressMap = inject('progressMap', ref({}));

const urlGroups = computed(() => {
  const map = new Map();
  for (const w of props.workers) {
    for (const p of w.profiles) {
      if (p.state === 'busy' && p.targetUrl) {
        if (!map.has(p.targetUrl)) map.set(p.targetUrl, []);
        map.get(p.targetUrl).push({
          workerId: w.workerId, profileName: p.profileName,
          isLoggedIn: p.isLoggedIn, rank: p.rank, taskId: p.taskId,
          currentAction: progressMap.value[`${w.workerId}:${p.profileName}`]?.action ?? p.currentAction,
        });
      }
    }
  }
  return [...map.entries()].map(([url, nodes]) => ({ url, nodes }));
});

const totalRunning = computed(() => urlGroups.value.reduce((s, g) => s + g.nodes.length, 0));

function nodeClass(n) {
  return n.isLoggedIn === false ? 'at__node--orange'  // 未登陆 → 橙
       : n.rank > 0 ? 'at__node--green'               // 已上榜 → 绿
       : 'at__node--red';                             // 未上榜 → 红
}
function nodeTip(n) {
  const login = n.isLoggedIn === false ? '未登陆' : n.isLoggedIn === true ? '已登陆' : '未知';
  const rank  = n.rank > 0 ? '#' + n.rank : n.rank === null ? '—' : '未上榜';
  return `${n.workerId} · ${n.profileName}\n${login} · ${rank}\n点击停止`;
}

function stopNode(workerId, profile) {
  wsSend({ type: 'stop_node', worker_id: workerId, profile });
  toast(`已停止节点 ${profile}`);
}
function stopUrl(url) {
  wsSend({ type: 'stop_url', target_url: url });
  toast(`已停止 URL: ${url.slice(0, 40)}${url.length > 40 ? '…' : ''}`);
}
async function adjustUrl(url, delta) {
  try { await adjustTime(url, delta); } catch (err) { toast(err.message, 'warn'); }
}
function checkRanklistUrl(nodes) {
  const dwell = nodes.filter(n => n.currentAction === 'dwell');
  if (!dwell.length) { toast('暂无节点处于挂机阶段', 'warn'); return; }
  const targets = dwell.filter(n => (n.rank ?? 0) <= 0).map(n => ({ worker_id: n.workerId, profile: n.profileName }));
  if (!targets.length) { toast('无需检查（均已上榜）', 'warn'); return; }
  wsSend({ type: 'ranklist_check', targets });
  toast(`已向 ${targets.length} 个节点发送榜单检查`);
}
function stopGroupUnlogged(nodes) {
  const t = nodes.filter(n => n.isLoggedIn === false);
  if (!t.length) { toast('无未登录节点', 'warn'); return; }
  for (const n of t) wsSend({ type: 'stop_node', worker_id: n.workerId, profile: n.profileName });
  toast(`已停止 ${t.length} 个未登录节点`);
}
function stopGroupUnranked(nodes) {
  const t = nodes.filter(n => n.isLoggedIn === true && (n.rank === null || n.rank <= 0));
  if (!t.length) { toast('无未上榜节点', 'warn'); return; }
  for (const n of t) wsSend({ type: 'stop_node', worker_id: n.workerId, profile: n.profileName });
  toast(`已停止 ${t.length} 个未上榜节点`);
}
function reloadUnrankedUrl(nodes) {
  const dwell = nodes.filter(n => n.currentAction === 'dwell');
  if (!dwell.length) { toast('暂无节点处于挂机阶段', 'warn'); return; }
  const t = dwell.filter(n => n.isLoggedIn === true && (n.rank === null || n.rank <= 0));
  if (!t.length) { toast('无需刷新的节点', 'warn'); return; }
  for (const n of t) wsSend({ type: 'run_action', worker_id: n.workerId, profile: n.profileName, action: 'douyin-reload' });
  toast(`已刷新 ${t.length} 个未上榜节点`);
}
async function screenshotGroup(nodes) {
  await Promise.allSettled(nodes.map(n => triggerScreenshot({ worker_id: n.workerId, profile: n.profileName, task_id: n.taskId })));
  toast(`已触发 ${nodes.length} 个节点截图，完成后自动跳转`);
}
</script>

<style scoped>
.at-card {
  height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
}
.at-card :deep(.arco-card-body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.at__title { font-size: 14px; font-weight: 600; }
.at__meta  { font-size: 12px; color: var(--tx-3); }
.t-amber   { color: var(--warning); }

/* 色块图例 */
.at__legend-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--tx-2); }
.at__dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }

.at__body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }

.at__head, .at__row {
  display: grid;
  grid-template-columns: minmax(120px, 300px) 1fr 48px max-content;
  align-items: center;
  min-width: max-content;
  width: 100%;
}
/* 列标题行：与全局表头 .arco-table-th 同款 */
.at__head {
  height: 36px;
  padding: 0 16px;
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--tx-3);
  background: var(--bg-page);
  border-bottom: 1px solid var(--bd-color);
  user-select: none;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 10;
}
.at__head-center { text-align: center; }
.at__head-right  { text-align: right; padding-right: 4px; }

/* 数据行：对齐全局表格行高 */
.at__row {
  min-height: var(--table-row-h);
  padding: 4px 16px;
  border-bottom: 1px solid var(--bd-color);
  transition: background 0.15s;
}
.at__row:hover { background: var(--bg-page); }

.at__url {
  font-size: var(--fs-sm);
  color: var(--tx-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.at__nodes { display: flex; align-items: center; gap: 2px; overflow: hidden; min-width: 0; padding: 0 4px; }
.at__node {
  width: 14px;
  height: 16px;
  border-radius: 3px;
  cursor: pointer;
  border: none;
  flex-shrink: 0;
  transition: background 0.15s;
}
.at__node--red    { background: #f98981; }
.at__node--red:hover    { background: var(--danger); }
.at__node--green  { background: var(--success); }
.at__node--green:hover  { background: #009a25; }
.at__node--orange { background: #ff9a4d; }
.at__node--orange:hover { background: var(--warning); }

.at__count { font-size: var(--fs-sm); color: var(--success); text-align: center; font-weight: 600; }
.at__actions { justify-content: flex-end; }

.at__empty { padding: 48px 0; }
</style>
