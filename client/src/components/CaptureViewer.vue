<template>
  <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
    <div class="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h2 class="text-sm font-semibold">拦截响应数据</h2>
        <span v-if="allItems.length" class="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">
          {{ filtered.length }} 条
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button @click="copyAll"
          class="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-800/50 px-2.5 py-1 rounded transition-colors">
          复制 JSON
        </button>
        <button @click="loadAll" :disabled="loading"
          class="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1 rounded font-medium transition-colors">
          {{ loading ? '加载中…' : '刷新全部' }}
        </button>
      </div>
    </div>

    <!-- filters -->
    <div class="px-5 py-2.5 border-b border-gray-800 flex items-center gap-3">
      <input v-model="filterWorker" placeholder="按 Worker 搜索"
        class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500 w-40" />
      <input v-model="filterTaskId" placeholder="按 task_id 过滤"
        class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-indigo-500 w-44" />
      <input v-model="filterUrl" placeholder="按 URL 关键词过滤"
        class="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500 w-40" />
      <button v-if="filterWorker || filterTaskId || filterUrl"
        @click="filterWorker=''; filterTaskId=''; filterUrl=''"
        class="text-xs text-gray-600 hover:text-gray-300 transition-colors">清除</button>
    </div>

    <div class="overflow-y-auto" style="max-height:calc(100vh - 200px)">
      <div v-if="!allItems.length && !loading" class="text-sm text-gray-600 text-center py-16">
        点击「刷新全部」加载数据
      </div>
      <div v-else-if="!filtered.length && allItems.length" class="text-sm text-gray-600 text-center py-12">
        无匹配记录
      </div>

      <div v-for="(c, i) in filtered" :key="i"
        class="border-b border-gray-800/40 last:border-0">
        <!-- row header -->
        <div class="flex items-center gap-3 px-5 py-2.5 text-xs hover:bg-gray-800/20 transition-colors">
          <span class="font-mono text-gray-500 flex-shrink-0" :title="c.worker_id">{{ c.worker_id || '—' }}</span>
          <span class="font-mono text-indigo-300 font-medium flex-shrink-0">{{ c.profile }}</span>
          <span class="text-violet-300 font-mono bg-violet-950/40 border border-violet-800/40 px-1.5 py-px rounded flex-shrink-0">
            {{ c.pattern }}
          </span>
          <span class="text-gray-700 font-mono truncate flex-1 min-w-0" :title="c.matched_url">{{ c.matched_url }}</span>
          <span class="text-gray-700 flex-shrink-0">{{ formatTime(c.timestamp) }}</span>
          <button @click="toggle(i)"
            class="text-indigo-500 hover:text-indigo-400 transition-colors flex-shrink-0">
            {{ expanded.has(i) ? '收起' : '展开' }}
          </button>
        </div>
        <!-- data -->
        <div v-if="expanded.has(i)" class="px-5 pb-3">
          <pre class="text-xs font-mono text-gray-300 bg-gray-950/70 border border-gray-800 rounded-lg px-4 py-3 overflow-x-auto max-h-64 overflow-y-auto">{{ formatData(c.data) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, watch, onMounted } from 'vue';
import { fetchCaptures, fetchTasks } from '../api.js';

const props = defineProps({ initialTaskId: { type: String, default: '' } });

const allItems   = ref([]);
const loading    = ref(false);
const filterWorker = ref('');
const filterTaskId = ref('');
const filterUrl    = ref('');
const expanded     = reactive(new Set());

const filtered = computed(() => {
  let list = allItems.value;
  if (filterWorker.value) list = list.filter(c => c.worker_id?.includes(filterWorker.value));
  if (filterTaskId.value) list = list.filter(c => c.task_id?.includes(filterTaskId.value));
  if (filterUrl.value)    list = list.filter(c => (c.matched_url || c.pattern || '').includes(filterUrl.value));
  return list;
});

watch(() => props.initialTaskId, v => { if (v) { filterTaskId.value = v; if (!allItems.value.length) loadAll(); } });

onMounted(loadAll);

async function loadAll() {
  loading.value = true;
  expanded.clear();
  try {
    const tasks = await fetchTasks().catch(() => []);
    const results = await Promise.all(
      tasks.map(t => fetchCaptures(t.task_id).then(rows => rows.map(r => ({ ...r, task_id: r.task_id ?? t.task_id }))).catch(() => []))
    );
    allItems.value = results.flat().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } finally {
    loading.value = false;
  }
}

function toggle(i) { expanded.has(i) ? expanded.delete(i) : expanded.add(i); }
function formatData(data) {
  if (data == null) return '';
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}
function copyAll() {
  navigator.clipboard.writeText(JSON.stringify(filtered.value, null, 2)).catch(() => {});
}
function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}
</script>
