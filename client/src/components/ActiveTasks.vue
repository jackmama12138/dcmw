<template>
  <div class="bg-white border border-gray-200 rounded-xl" style="height:calc(100vh - 96px); display:flex; flex-direction:column; overflow:hidden">

    <!-- 标题栏 -->
    <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between" style="flex-shrink:0">
      <h2 class="text-sm font-semibold">执行中</h2>
      <div class="flex items-center gap-3 text-xs text-gray-600">
        <span>运行中 <b style="color:var(--warning)">{{ totalRunning }}</b> 个节点</span>
        <span>共 <b>{{ urlGroups.length }}</b> 个 URL</span>
      </div>
    </div>

    <!-- 执行中 URL 列表 -->
    <div style="flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column">
      <!-- 列标题行 -->
      <div class="grid items-center border-b border-gray-200 px-4 py-2 text-xs text-gray-600 select-none flex-shrink-0"
        style="grid-template-columns:minmax(120px,300px) 1fr 48px max-content; min-width:max-content; width:100%">
        <span>目标 URL</span>
        <span></span>
        <span class="text-center">节点数</span>
        <span class="text-right px-1">操作</span>
      </div>
      <div v-if="!urlGroups.length" class="text-xs text-gray-600 text-center py-12">暂无执行中的任务</div>
      <div v-for="group in urlGroups" :key="group.url"
        class="grid items-center hover:bg-gray-50 transition-colors"
        style="grid-template-columns:minmax(120px,300px) 1fr 48px max-content; padding:4px 16px; border-bottom:1px solid var(--bd-color); min-height:36px; min-width:max-content; width:100%">
        <!-- URL -->
        <div class="font-mono text-xs text-gray-600" :title="group.url"
          style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; direction:rtl; text-align:left">{{ group.url }}</div>
        <!-- 节点色块：填满剩余空间，单行裁切 -->
        <div style="display:flex; align-items:center; gap:2px; overflow:hidden; min-width:0; padding:0 4px">
          <button v-for="n in group.nodes" :key="`${n.workerId}:${n.profileName}`"
            :title="`${n.workerId} · ${n.profileName}\n${n.isLoggedIn===false?'未登陆':n.isLoggedIn===true?'已登陆':'未知'} · ${n.rank>0?'#'+n.rank:n.rank===null?'—':'未上榜'}\n点击停止`"
            @click="stopNode(n.workerId, n.profileName)"
            :class="n.isLoggedIn===false ? 'bg-red-400 hover:bg-red-600' : n.rank>0 ? 'bg-emerald-500 hover:bg-emerald-700' : 'bg-orange-400 hover:bg-orange-600'"
            class="transition-colors flex-shrink-0"
            style="width:14px; height:16px; border-radius:3px; cursor:pointer; border:none" />
        </div>
        <!-- 节点数 -->
        <span class="font-mono text-xs text-emerald-500 text-center font-semibold">{{ group.nodes.length }}</span>
        <!-- 操作按钮 -->
        <div style="display:flex; gap:3px; align-items:center; justify-content:flex-end">
          <button @click="adjustUrl(group.url, 1800)" class="text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-100 border border-gray-200 rounded transition-colors" style="padding:1px 5px">+30m</button>
          <button @click="screenshotGroup(group.nodes)" class="text-xs bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-500 rounded transition-colors" style="padding:1px 6px">截图</button>
          <button @click="checkRanklistUrl(group.nodes)" class="text-xs bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-500 rounded transition-colors" style="padding:1px 6px">获取榜单</button>
          <button @click="stopGroupUnlogged(group.nodes)" class="text-xs bg-red-50 hover:bg-red-100 border border-red-200 text-red-500 rounded transition-colors" style="padding:1px 6px">停未登陆</button>
          <button @click="stopGroupUnranked(group.nodes)" class="text-xs bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-500 rounded transition-colors" style="padding:1px 6px">停未上榜</button>
          <button @click="reloadUnrankedUrl(group.nodes)" class="text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-500 rounded transition-colors" style="padding:1px 6px">刷新未上榜</button>
          <button @click="stopUrl(group.url)" class="text-xs bg-pink-50 hover:bg-pink-100 border border-pink-200 text-pink-500 rounded transition-colors" style="padding:1px 6px">全停</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { adjustTime, triggerScreenshot } from '../api.js';

const props  = defineProps({ workers: { type: Array, default: () => [] } });
const wsSend = inject('wsSend', () => {});
const setTab = inject('setTab', () => {});
const toast  = inject('toast', () => {});

const urlGroups = computed(() => {
  const map = new Map();
  for (const w of props.workers) {
    for (const p of w.profiles) {
      if (p.state === 'busy' && p.targetUrl) {
        if (!map.has(p.targetUrl)) map.set(p.targetUrl, []);
        map.get(p.targetUrl).push({
          workerId: w.workerId, profileName: p.profileName,
          isLoggedIn: p.isLoggedIn, rank: p.rank, taskId: p.taskId, currentAction: p.currentAction,
        });
      }
    }
  }
  return [...map.entries()].map(([url, nodes]) => ({ url, nodes }));
});

const totalRunning = computed(() => urlGroups.value.reduce((s, g) => s + g.nodes.length, 0));

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
  toast(`已触发 ${nodes.length} 个节点截图`);
  setTab('screenshots');
}
</script>
