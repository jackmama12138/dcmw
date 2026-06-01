<template>
  <div class="bg-white border border-gray-200 rounded-xl overflow-hidden" style="height:calc(100vh - 96px); display:flex; flex-direction:column">
    <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
      <h2 class="text-sm font-semibold">任务列表</h2>
      <div class="flex items-center gap-3 text-xs text-gray-600">
        <span>共 {{ tasks.length }} 条</span>
        <span>每 10s 自动刷新</span>
      </div>
    </div>

    <div v-if="!tasks.length" class="text-sm text-gray-600 text-center py-12">暂无任务</div>

    <div v-else style="flex:1; min-height:0; display:flex; flex-direction:column">
      <!-- header -->
      <div class="grid items-center border-b border-gray-200 px-4 py-2 text-xs text-gray-600 select-none flex-shrink-0"
        style="grid-template-columns:10px 150px minmax(0,1fr) 90px 100px 56px 220px">
        <div></div>
        <div class="px-2">Task ID</div>
        <div class="px-2">目标 URL</div>
        <div class="px-2">模板</div>
        <div class="px-2 text-right">进度</div>
        <div class="px-2 text-center">状态</div>
        <div class="px-2 text-right">操作</div>
      </div>

      <!-- rows -->
      <div class="overflow-y-auto" style="flex:1; min-height:0">
        <div v-for="t in paged" :key="t.task_id"
          class="grid items-center border-b border-gray-200 last:border-0 px-4 hover:bg-gray-50 transition-colors"
          style="grid-template-columns:10px 150px minmax(0,1fr) 90px 100px 56px 220px; min-height:40px">

          <div>
            <span :class="dotColor(t.status)" class="w-2 h-2 rounded-full block"></span>
          </div>

          <div class="px-2 min-w-0">
            <span class="font-mono text-xs text-gray-500 select-all block truncate">{{ t.task_id }}</span>
          </div>

          <div class="px-2 min-w-0">
            <span class="block truncate text-gray-600 text-xs" :title="t.target_url">{{ t.target_url }}</span>
          </div>

          <div class="px-2 min-w-0">
            <span v-if="t.task_type || t.template"
              class="inline-block max-w-full truncate text-xs bg-gray-100 border border-gray-200 text-gray-600 px-1.5 py-px rounded font-mono"
              :title="t.task_type || t.template">
              {{ t.task_type || t.template }}
            </span>
          </div>

          <div class="px-2">
            <div class="flex items-center justify-end gap-1 text-xs tabular-nums mb-1">
              <span class="text-emerald-600 font-medium">{{ t.completed }}</span>
              <span class="text-gray-700">/</span>
              <span class="text-gray-400">{{ t.count }}</span>
              <span v-if="t.running > 0" class="text-amber-600">+{{ t.running }}</span>
              <span v-if="t.failed > 0" class="text-red-500">✕{{ t.failed }}</span>
            </div>
            <div class="h-0.5 bg-gray-200 rounded-full overflow-hidden">
              <div :style="{ width: progressPct(t) + '%' }"
                :class="['h-full rounded-full transition-all duration-500',
                  t.status === 'done' ? 'bg-emerald-500' : 'bg-indigo-500']"></div>
            </div>
          </div>

          <div class="px-2 flex justify-center">
            <span :class="['text-xs px-1.5 py-px rounded font-medium whitespace-nowrap', statusBadge(t.status)]">
              {{ statusLabel(t.status) }}
            </span>
          </div>

          <div class="px-2 flex items-center justify-end gap-1 flex-nowrap">
            <span :class="['text-xs px-1.5 py-px rounded font-mono', t.status==='running'?'text-amber-600':'text-gray-400']">
              {{ t.completed ?? 0 }}/{{ t.count }}
            </span>
          </div>
        </div>
      </div>

      <!-- pagination -->
      <div v-if="totalPages > 1"
        class="flex items-center justify-between px-5 py-2.5 border-t border-gray-200 text-xs text-gray-600">
        <span>第 {{ page }} / {{ totalPages }} 页，共 {{ tasks.length }} 条</span>
        <div class="flex items-center gap-1">
          <button @click="page = 1" :disabled="page === 1"
            class="px-2 py-1 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-30 transition-colors">
            «
          </button>
          <button @click="page--" :disabled="page === 1"
            class="px-2 py-1 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-30 transition-colors">
            ‹
          </button>
          <button v-for="p in pageRange" :key="p" @click="page = p"
            :class="['px-2.5 py-1 rounded border transition-colors',
              p === page
                ? 'border-indigo-600 bg-blue-50 text-blue-600'
                : 'border-gray-200 hover:border-gray-200 hover:text-gray-800']">
            {{ p }}
          </button>
          <button @click="page++" :disabled="page === totalPages"
            class="px-2 py-1 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-30 transition-colors">
            ›
          </button>
          <button @click="page = totalPages" :disabled="page === totalPages"
            class="px-2 py-1 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-30 transition-colors">
            »
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({ tasks: { type: Array, default: () => [] } });

const PAGE_SIZE = 50;
const page = ref(1);

const totalPages = computed(() => Math.max(1, Math.ceil(props.tasks.length / PAGE_SIZE)));
const paged      = computed(() => props.tasks.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const pageRange  = computed(() => {
  const total = totalPages.value;
  const cur   = page.value;
  const range = [];
  const start = Math.max(1, Math.min(cur - 2, total - 4));
  const end   = Math.min(total, start + 4);
  for (let i = start; i <= end; i++) range.push(i);
  return range;
});

function dotColor(s) {
  return {
    pending: 'bg-gray-400',
    running: 'bg-amber-400 animate-pulse',
    done:    'bg-emerald-500',
    stopped: 'bg-red-500',
    error:   'bg-red-500',
  }[s] ?? 'bg-gray-600';
}
function statusBadge(s) {
  return {
    pending: 'bg-gray-100 text-gray-500 border border-gray-200',
    running: 'bg-amber-50 text-amber-600 border border-amber-200',
    done:    'bg-emerald-950 text-emerald-600 border border-green-200',
    stopped: 'bg-red-50 text-red-500 border border-red-200',
    error:   'bg-red-50 text-red-500 border border-red-200',
  }[s] ?? 'bg-gray-100 text-gray-500';
}
function statusLabel(s) {
  return { pending: '等待', running: '运行中', done: '完成', stopped: '已停止', error: '错误' }[s] ?? s;
}
function isDouyin(url) {
  return typeof url === 'string' && /douyin\.com/i.test(url);
}

function progressPct(t) {
  if (!t.count) return 0;
  return Math.min(100, Math.round((t.completed / t.count) * 100));
}
</script>
