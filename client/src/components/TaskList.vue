<template>
  <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">任务列表</h2>
      <span class="text-xs text-gray-600">每 10s 自动刷新</span>
    </div>

    <div v-if="!tasks.length" class="text-sm text-gray-500 text-center py-8">暂无任务</div>

    <div class="space-y-2">
      <div v-for="t in tasks" :key="t.task_id"
        class="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3 text-sm">
        <!-- status dot -->
        <span :class="dotColor(t.status)" class="w-2 h-2 rounded-full flex-shrink-0"></span>

        <!-- id -->
        <span class="font-mono text-xs text-gray-500 w-28 truncate flex-shrink-0">{{ t.task_id }}</span>

        <!-- url -->
        <span class="truncate text-gray-300 flex-1 min-w-0">{{ t.target_url }}</span>

        <!-- type badge -->
        <span v-if="t.task_type" class="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded flex-shrink-0">{{ t.task_type }}</span>

        <!-- progress -->
        <div class="flex-shrink-0 text-right w-24">
          <div class="text-xs">
            <span class="text-green-400">{{ t.completed }}</span>
            <span class="text-gray-600">/</span>
            <span class="text-gray-300">{{ t.count }}</span>
            <span v-if="t.running > 0" class="text-yellow-400 ml-1">+{{ t.running }}</span>
            <span v-if="t.failed > 0" class="text-red-400 ml-1">✕{{ t.failed }}</span>
          </div>
          <div class="h-1 bg-gray-700 rounded mt-1">
            <div :style="{ width: progressPct(t) + '%' }"
              :class="['h-full rounded transition-all', t.status === 'done' ? 'bg-green-500' : 'bg-indigo-500']"></div>
          </div>
        </div>

        <!-- status label -->
        <span :class="labelColor(t.status)" class="text-xs w-14 text-right flex-shrink-0">{{ t.status }}</span>

        <!-- actions -->
        <div class="flex gap-2 flex-shrink-0">
          <button v-if="t.status !== 'done'" @click="$emit('stop', t.task_id)"
            class="text-xs text-red-400 hover:text-red-300 transition-colors">停止</button>
          <button @click="$emit('view-cookies', t.task_id)"
            class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">Cookie</button>
          <button @click="$emit('view-screenshots', t.task_id)"
            class="text-xs text-gray-400 hover:text-gray-200 transition-colors">截图</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({ tasks: { type: Array, default: () => [] } });
defineEmits(['stop', 'view-cookies', 'view-screenshots']);

function dotColor(s) {
  return { pending: 'bg-gray-500', running: 'bg-yellow-400 animate-pulse', done: 'bg-green-500' }[s] ?? 'bg-gray-500';
}
function labelColor(s) {
  return { pending: 'text-gray-500', running: 'text-yellow-400', done: 'text-green-400' }[s] ?? 'text-gray-500';
}
function progressPct(t) {
  if (!t.count) return 0;
  return Math.min(100, Math.round((t.completed / t.count) * 100));
}
</script>
