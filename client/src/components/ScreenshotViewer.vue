<template>
  <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h2 class="text-sm font-semibold">截图查看</h2>
        <span v-if="allShots.length" class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          {{ filtered.length }} 张
        </span>
      </div>
      <button @click="load" :disabled="loading"
        class="text-xs bg-primary hover:bg-primary-hover text-white disabled:opacity-50 px-3 py-1 rounded font-medium transition-colors">
        {{ loading ? '加载中…' : '刷新' }}
      </button>
    </div>

    <!-- filters -->
    <div class="px-5 py-2.5 border-b border-gray-200 flex items-center gap-3">
      <input v-model="filterWorker" placeholder="按 Worker 搜索"
        class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-400 w-44" />
      <select v-model="filterProfile"
        class="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400">
        <option value="">全部 Profile</option>
        <option v-for="p in profiles" :key="p" :value="p">{{ p }}</option>
      </select>
      <button v-if="filterWorker || filterProfile" @click="filterWorker=''; filterProfile=''"
        class="text-xs text-gray-600 hover:text-gray-800 transition-colors">清除</button>
    </div>

    <!-- grid -->
    <div class="overflow-y-auto p-4" style="max-height:calc(100vh - 260px)">
      <div v-if="!allShots.length && !loading" class="text-sm text-gray-600 text-center py-16">
        点击「刷新」或在任务列表点「截图」触发
      </div>
      <div v-else-if="!filtered.length" class="text-sm text-gray-600 text-center py-12">无匹配截图</div>
      <div v-else class="grid gap-3" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
        <div v-for="s in paged" :key="s.worker_id + ':' + s.profile"
          class="bg-white border border-gray-200 rounded-xl overflow-hidden cursor-pointer group hover:border-indigo-600/50 transition-colors"
          @click="preview = s">
          <div class="relative overflow-hidden bg-gray-100" style="height:100px">
            <img :src="s.url" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
          </div>
          <div class="px-2.5 py-2 text-xs">
            <div class="text-gray-500 font-mono truncate" :title="s.worker_id">{{ s.worker_id || '—' }}</div>
            <div class="text-blue-600 font-mono truncate mt-0.5">{{ s.profile }}</div>
            <div class="text-gray-600 mt-0.5">{{ formatTime(s.timestamp) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- pagination -->
    <div v-if="totalPages > 1"
      class="flex items-center justify-between px-5 py-2 border-t border-gray-200 text-xs text-gray-600">
      <span>第 {{ page }} / {{ totalPages }} 页，共 {{ filtered.length }} 张</span>
      <div class="flex gap-1">
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

    <!-- lightbox -->
    <div v-if="preview" class="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-6"
      @click.self="preview = null">
      <div class="relative max-w-4xl w-full">
        <button @click="preview = null"
          class="absolute -top-9 right-0 text-gray-400 hover:text-white text-sm transition-colors">✕ 关闭</button>
        <img :src="preview.url" class="w-full rounded-xl shadow-2xl" />
        <div class="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span class="font-mono text-gray-500">{{ preview.worker_id }}</span>
          <span class="font-mono text-blue-600 mx-3">{{ preview.profile }}</span>
          <div class="flex items-center gap-3 flex-shrink-0">
            <span>{{ formatTime(preview.timestamp) }}</span>
            <a :href="preview.url" target="_blank" class="text-blue-600 hover:text-blue-600 transition-colors">↗ 新标签</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { fetchScreenshots } from '../api.js';

const PAGE_SIZE = 50;

const allShots     = ref([]);
const loading      = ref(false);
const preview      = ref(null);
const filterWorker  = ref('');
const filterProfile = ref('');
const page          = ref(1);

const profiles = computed(() => [...new Set(allShots.value.map(s => s.profile))].sort());

const filtered = computed(() => {
  let list = allShots.value;
  if (filterWorker.value)  list = list.filter(s => s.worker_id?.includes(filterWorker.value));
  if (filterProfile.value) list = list.filter(s => s.profile === filterProfile.value);
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

let abortCtrl;
onMounted(load);
onUnmounted(() => abortCtrl?.abort());

async function load() {
  abortCtrl?.abort();
  abortCtrl = new AbortController();
  const { signal } = abortCtrl;
  loading.value = true;
  try {
    const data = await fetchScreenshots(signal);
    if (!signal.aborted) allShots.value = data;
  } catch {
    if (!signal.aborted) allShots.value = [];
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}
</script>
