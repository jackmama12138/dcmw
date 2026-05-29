<template>
  <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">Worker 状态</h2>
      <span class="text-xs text-gray-600">每 10s 自动刷新</span>
    </div>

    <div v-if="!workers.length" class="text-sm text-gray-500 text-center py-8">暂无连接的 Worker</div>

    <div v-for="w in workers" :key="w.workerId" class="mb-4 last:mb-0 border border-gray-800 rounded-xl p-4">
      <div class="flex items-center gap-3 mb-3">
        <span :class="w.connected ? 'bg-green-500' : 'bg-red-500'" class="w-2.5 h-2.5 rounded-full flex-shrink-0"></span>
        <span class="font-mono text-sm text-indigo-300 font-medium">{{ w.workerId }}</span>
        <div class="ml-auto flex gap-3 text-xs">
          <span class="text-gray-400">空闲 <b class="text-green-400">{{ w.slots.idle }}</b></span>
          <span class="text-gray-400">忙碌 <b class="text-yellow-400">{{ w.slots.busy }}</b></span>
          <span class="text-gray-400">总计 <b class="text-gray-300">{{ w.slots.total }}</b></span>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <div v-for="p in w.profiles" :key="p.profileName"
          :class="['text-xs px-2.5 py-1 rounded-lg border', profileStyle(p.state)]">
          <span class="font-mono">{{ p.profileName }}</span>
          <span v-if="p.taskId" class="ml-1.5 opacity-50 font-mono">{{ p.taskId }}</span>
        </div>
      </div>

      <div class="text-xs text-gray-700 mt-2">
        最近心跳 {{ formatAge(w.lastHeartbeat) }}
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({ workers: { type: Array, default: () => [] } });

function profileStyle(state) {
  return {
    idle: 'bg-gray-800 text-gray-400 border-gray-700',
    busy: 'bg-yellow-950 text-yellow-300 border-yellow-800',
    error: 'bg-red-950 text-red-400 border-red-800',
  }[state] ?? 'bg-gray-800 text-gray-400 border-gray-700';
}

function formatAge(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s 前`;
  return `${Math.floor(s / 60)}m 前`;
}
</script>
