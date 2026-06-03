<template>
  <a-card :bordered="true">
    <template #title><span class="ws__title">Worker 状态</span></template>
    <template #extra><span class="ws__meta">每 10s 自动刷新</span></template>

    <a-empty v-if="!workers.length" description="暂无连接的 Worker" />

    <a-space v-else direction="vertical" :size="16" fill>
      <a-card v-for="w in workers" :key="w.workerId" :bordered="true" size="small" class="ws__worker">
        <div class="ws__worker-head">
          <a-badge :status="w.connected ? 'success' : 'danger'" />
          <span class="mono ws__worker-id">{{ w.workerId }}</span>
          <a-button size="mini" type="outline" @click="onRadmin(w.workerId)" style="margin-left:8px">Radmin</a-button>
          <a-space :size="12" class="ws__worker-stats">
            <span class="ws__stat">空闲 <b class="t-green">{{ w.slots.idle }}</b></span>
            <span class="ws__stat">忙碌 <b class="t-amber">{{ w.slots.busy }}</b></span>
            <span class="ws__stat">总计 <b class="t-gray">{{ w.slots.total }}</b></span>
          </a-space>
        </div>

        <a-space wrap :size="8" class="ws__profiles">
          <a-tag v-for="p in w.profiles" :key="p.profileName" :color="profileColor(p.state)">
            <span class="mono">{{ p.profileName }}</span>
            <span v-if="p.taskId" class="mono ws__profile-task">{{ p.taskId }}</span>
          </a-tag>
        </a-space>

        <div class="ws__heartbeat">最近心跳 {{ formatAge(w.lastHeartbeat) }}</div>
      </a-card>
    </a-space>
  </a-card>
</template>

<script setup>
import { connectRadmin } from '../api.js';

const props = defineProps({ workers: { type: Array, default: () => [] } });

async function onRadmin(workerId) {
  try {
    await connectRadmin(workerId);
  } catch (e) {
    console.error('Radmin 连接失败', e);
  }
}

function profileColor(state) {
  return {
    idle:  'gray',
    busy:  'orange',
    error: 'red',
  }[state] ?? 'gray';
}

function formatAge(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s 前`;
  return `${Math.floor(s / 60)}m 前`;
}
</script>

<style scoped>
.ws__title { font-size: 16px; font-weight: 600; }
.ws__meta  { font-size: 12px; color: var(--tx-3); }

.ws__worker-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.ws__worker-id { font-size: 13px; color: var(--primary); font-weight: 500; }
.ws__worker-stats { margin-left: auto; font-size: 12px; }
.ws__stat { color: var(--tx-4); }
.t-green { color: var(--success); }
.t-amber { color: var(--warning); }
.t-gray  { color: var(--tx-2); }

.ws__profile-task { margin-left: 6px; opacity: 0.5; }
.ws__heartbeat { font-size: 12px; color: var(--tx-2); margin-top: 8px; }
</style>
