<template>
  <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <!-- header -->
    <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h2 class="text-sm font-semibold">Cookie 采集</h2>
        <span v-if="deduped.length" class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          {{ filtered.length }} 用户
        </span>
        <span v-if="deduped.length !== allItems.length" class="text-xs text-gray-600">
          (原始 {{ allItems.length }} 条)
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button @click="copyAll"
          class="text-xs text-blue-600 hover:text-blue-600 border border-blue-200 px-2.5 py-1 rounded transition-colors">
          复制 JSON
        </button>
        <button @click="loadAll" :disabled="loading"
          class="text-xs bg-primary hover:bg-primary-hover text-white disabled:opacity-50 px-3 py-1 rounded font-medium transition-colors">
          {{ loading ? '加载中…' : '刷新全部' }}
        </button>
      </div>
    </div>

    <!-- filters -->
    <div class="px-5 py-2.5 border-b border-gray-200 flex items-center gap-3">
      <input v-model="filterWorker" placeholder="按 Worker 搜索"
        class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-400 w-40" />
      <input v-model="filterUid" placeholder="按 user_unique_id 搜索"
        class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-400 w-48" />
      <select v-model="filterProfile"
        class="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400">
        <option value="">全部 Profile</option>
        <option v-for="p in profiles" :key="p" :value="p">{{ p }}</option>
      </select>
      <button v-if="filterWorker || filterUid || filterProfile"
        @click="filterWorker=''; filterUid=''; filterProfile=''"
        class="text-xs text-gray-600 hover:text-gray-800 transition-colors">清除</button>
      <span v-if="loading" class="text-xs text-gray-600 ml-auto">加载中…</span>
    </div>

    <!-- list -->
    <div class="overflow-y-auto" style="max-height:calc(100vh - 200px)">
      <div v-if="!allItems.length && !loading" class="text-sm text-gray-600 text-center py-16">
        点击「刷新全部」加载数据
      </div>
      <div v-else-if="!filtered.length && allItems.length" class="text-sm text-gray-600 text-center py-12">
        无匹配记录
      </div>

      <div v-for="c in paged" :key="c.user_unique_id || c._key"
        class="flex items-center gap-3 px-5 py-2 border-b border-gray-200 last:border-0 hover:bg-gray-50/80 transition-colors min-w-0">
        <span class="font-mono text-gray-400 text-xs flex-shrink-0 max-w-[100px] truncate"
          :title="c.worker_id">{{ c.worker_id || '—' }}</span>
        <span class="font-mono text-blue-600 text-xs flex-shrink-0">{{ c.profile }}</span>
        <span class="font-mono text-emerald-600 text-xs font-medium flex-shrink-0 max-w-[160px] truncate"
          :title="c.user_unique_id">{{ c.user_unique_id || '—' }}</span>
        <span class="font-mono text-gray-400 text-xs truncate w-32 flex-shrink-0"
          :title="c.ua">{{ c.ua || '—' }}</span>
        <span class="font-mono text-gray-500 text-xs truncate flex-1 select-all min-w-0"
          :title="c.cookie">{{ c.cookie || '—' }}</span>
        <span class="text-gray-700 text-xs flex-shrink-0 whitespace-nowrap">{{ formatTime(c.timestamp) }}</span>
        <button @click="copyItem(c)"
          class="text-gray-600 hover:text-gray-800 transition-colors flex-shrink-0 text-xs">复制</button>
      </div>

      <!-- pagination -->
      <div v-if="totalPages > 1"
        class="flex items-center justify-between px-5 py-2 border-t border-gray-200 text-xs text-gray-600">
        <span>第 {{ page }} / {{ totalPages }} 页，共 {{ filtered.length }} 用户</span>
        <div class="flex items-center gap-1">
          <button @click="page--" :disabled="page === 1"
            class="px-2 py-1 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-30">‹</button>
          <button v-for="p in pageRange" :key="p" @click="page = p"
            :class="['px-2.5 py-1 rounded border transition-colors',
              p === page ? 'border-indigo-600 bg-blue-50 text-blue-600' : 'border-gray-200 hover:border-gray-200']">
            {{ p }}
          </button>
          <button @click="page++" :disabled="page === totalPages"
            class="px-2 py-1 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-30">›</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { fetchCookies } from '../api.js';

const props = defineProps({ initialTaskId: { type: String, default: '' } });

const PAGE_SIZE = 50;
const allItems     = ref([]);
const loading      = ref(false);
const filterWorker  = ref('');
const filterUid     = ref('');
const filterProfile = ref('');
const page         = ref(1);

const profiles = computed(() => [...new Set(allItems.value.map(c => c.profile))].sort());

// Deduplicate by user_unique_id, keep most recent per uid
const deduped = computed(() => {
  const map = new Map();
  for (const c of allItems.value) {
    const key = c.user_unique_id || `_no_uid_${c.profile}_${c.timestamp}`;
    if (!map.has(key) || (c.timestamp || 0) > (map.get(key).timestamp || 0)) {
      map.set(key, { ...c, _key: key });
    }
  }
  return [...map.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
});

const filtered = computed(() => {
  let list = deduped.value;
  if (filterWorker.value)  list = list.filter(c => c.worker_id?.includes(filterWorker.value));
  if (filterUid.value)     list = list.filter(c => c.user_unique_id?.includes(filterUid.value));
  if (filterProfile.value) list = list.filter(c => c.profile === filterProfile.value);
  return list;
});

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const paged      = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const pageRange  = computed(() => {
  const total = totalPages.value, cur = page.value;
  const start = Math.max(1, Math.min(cur - 2, total - 4));
  const end   = Math.min(total, start + 4);
  const r = [];
  for (let i = start; i <= end; i++) r.push(i);
  return r;
});

watch(filtered, () => { page.value = 1; });

// initialTaskId 保留 prop 兼容，但不再过滤（全局列表）

let abortCtrl;
onMounted(loadAll);
onUnmounted(() => abortCtrl?.abort());

async function loadAll() {
  abortCtrl?.abort();
  abortCtrl = new AbortController();
  const { signal } = abortCtrl;
  loading.value = true;
  try {
    const data = await fetchCookies(signal);
    if (!signal.aborted) allItems.value = data;
  } catch {
    if (!signal.aborted) allItems.value = [];
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

function copyItem(c) {
  const payload = JSON.stringify({
    device_id: c.user_unique_id ?? '',
    headers: {
      cookie: c.cookie ?? '',
      'user-agent': c.ua ?? '',
    },
    params: {},
  }, null, 2);
  navigator.clipboard.writeText(payload).catch(() => {});
}
function copyAll() {
  const text = JSON.stringify(filtered.value.map(({ _key, ...rest }) => rest), null, 2);
  navigator.clipboard.writeText(text).catch(() => {});
}
function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}
</script>
