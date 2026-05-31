<template>
  <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <!-- header -->
    <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h2 class="text-sm font-semibold">榜单检查</h2>
        <span v-if="deduped.length" class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          {{ filtered.length }} 个 Profile
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
        <button @click="load" :disabled="loading"
          class="text-xs bg-primary hover:bg-primary-hover text-white disabled:opacity-50 px-3 py-1 rounded font-medium transition-colors">
          {{ loading ? '加载中…' : '刷新' }}
        </button>
      </div>
    </div>

    <!-- filters -->
    <div class="px-5 py-2.5 border-b border-gray-200 flex items-center gap-3">
      <input v-model="filterWorker" placeholder="按 Worker 搜索"
        class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-400 w-44" />
      <input v-model="filterNickname" placeholder="按昵称搜索"
        class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-400 w-36" />
      <div class="flex gap-2 text-xs">
        <label class="flex items-center gap-1.5 text-gray-400 cursor-pointer">
          <input type="checkbox" v-model="onlyRanked" class="accent-indigo-500" /> 仅在榜
        </label>
        <label class="flex items-center gap-1.5 text-gray-400 cursor-pointer">
          <input type="checkbox" v-model="onlyLoggedIn" class="accent-indigo-500" /> 仅已登录
        </label>
      </div>
      <button v-if="filterWorker || filterNickname || onlyRanked || onlyLoggedIn"
        @click="filterWorker=''; filterNickname=''; onlyRanked=false; onlyLoggedIn=false"
        class="text-xs text-gray-600 hover:text-gray-800 transition-colors">清除</button>
    </div>

    <!-- list header -->
    <div class="grid px-5 py-1.5 border-b border-gray-200 text-xs text-gray-600 select-none"
      style="grid-template-columns:130px 70px 1fr 120px 50px 150px 50px">
      <div>Worker</div>
      <div>Profile</div>
      <div>直播间</div>
      <div>昵称</div>
      <div class="text-center">名次</div>
      <div>时间</div>
      <div class="text-right">操作</div>
    </div>

    <!-- list -->
    <div class="overflow-y-auto" style="max-height:calc(100vh - 260px)">
      <div v-if="!allItems.length && !loading" class="text-sm text-gray-600 text-center py-16">
        点击「刷新」或在任务列表点「榜单」触发检查
      </div>
      <div v-else-if="!filtered.length" class="text-sm text-gray-600 text-center py-12">无匹配记录</div>

      <div v-for="c in paged" :key="c._key"
        class="grid items-center px-5 py-2 border-b border-gray-200 last:border-0 hover:bg-gray-50/80 transition-colors text-xs"
        style="grid-template-columns:130px 70px 1fr 120px 50px 150px 50px">

        <span class="font-mono text-gray-400 truncate" :title="c.worker_id">{{ c.worker_id || '—' }}</span>
        <span class="font-mono text-blue-600 truncate" :title="c.profile">{{ c.profile }}</span>

        <a :href="c.live_url" target="_blank"
          class="text-gray-400 truncate hover:text-blue-600 transition-colors" :title="c.live_url">
          {{ shortUrl(c.live_url) }}
        </a>

        <span :class="c.is_logged_in ? 'text-gray-700' : 'text-gray-600'" class="truncate" :title="c.nickname">
          {{ c.nickname || (c.is_logged_in ? '—' : '未登录') }}
        </span>

        <div class="text-center">
          <span v-if="c.is_ranked"
            class="bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded font-mono">
            {{ c.rank }}
          </span>
          <span v-else class="text-gray-700">—</span>
        </div>

        <span class="text-gray-600 whitespace-nowrap">{{ formatTime(c.timestamp) }}</span>

        <div class="text-right">
          <button @click="copy(c)"
            class="text-gray-600 hover:text-gray-800 transition-colors">复制</button>
        </div>
      </div>

      <!-- pagination -->
      <div v-if="totalPages > 1"
        class="flex items-center justify-between px-5 py-2 border-t border-gray-200 text-xs text-gray-600">
        <span>第 {{ page }} / {{ totalPages }} 页</span>
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
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { fetchRanklist } from '../api.js';

const PAGE_SIZE = 50;

const allItems     = ref([]);
const loading      = ref(false);
const filterWorker   = ref('');
const filterNickname = ref('');
const onlyRanked     = ref(false);
const onlyLoggedIn   = ref(false);
const page           = ref(1);

// 按 profile 去重，保留最新一条
const deduped = computed(() => {
  const map = new Map();
  for (const c of allItems.value) {
    const key = `${c.worker_id}:${c.profile}`;
    if (!map.has(key) || c.timestamp > map.get(key).timestamp) {
      map.set(key, { ...c, _key: key });
    }
  }
  return [...map.values()].sort((a, b) => b.timestamp - a.timestamp);
});

const filtered = computed(() => {
  let list = deduped.value;
  if (filterWorker.value)   list = list.filter(c => c.worker_id?.includes(filterWorker.value));
  if (filterNickname.value) list = list.filter(c => c.nickname?.includes(filterNickname.value));
  if (onlyRanked.value)     list = list.filter(c => c.is_ranked);
  if (onlyLoggedIn.value)   list = list.filter(c => c.is_logged_in);
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
    const data = await fetchRanklist(signal);
    if (!signal.aborted) allItems.value = data;
  } catch {
    if (!signal.aborted) allItems.value = [];
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

function shortUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname.replace('live.', '') + u.pathname;
  } catch { return url; }
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

function copy(c) {
  const { _key, ...rest } = c;
  navigator.clipboard.writeText(JSON.stringify(rest, null, 2)).catch(() => {});
}

function copyAll() {
  const data = filtered.value.map(({ _key, ...rest }) => rest);
  navigator.clipboard.writeText(JSON.stringify(data, null, 2)).catch(() => {});
}
</script>
