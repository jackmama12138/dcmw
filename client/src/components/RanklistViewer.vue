<template>
  <a-card class="list-card" :bordered="true">
    <template #title>
      <a-space :size="12" align="center">
        <span class="list-card__title">榜单检查</span>
        <a-tag v-if="deduped.length" size="small">{{ filtered.length }} 个 Profile</a-tag>
        <span v-if="deduped.length !== allItems.length" class="list-card__meta">
          (原始 {{ allItems.length }} 条)
        </span>
      </a-space>
    </template>
    <template #extra>
      <a-space :size="8">
        <a-button size="small" @click="copyAll">复制 JSON</a-button>
        <a-button type="primary" size="small" :loading="loading" @click="load">
          {{ loading ? '加载中…' : '刷新' }}
        </a-button>
      </a-space>
    </template>

    <!-- toolbar -->
    <div class="list-toolbar">
      <a-input v-model="filterWorker" placeholder="按 Worker 搜索" allow-clear class="rv__filter-w" />
      <a-input v-model="filterNickname" placeholder="按昵称搜索" allow-clear class="rv__filter-n" />
      <a-checkbox v-model="onlyRanked">仅在榜</a-checkbox>
      <a-checkbox v-model="onlyLoggedIn">仅已登录</a-checkbox>
      <a-button v-if="filterWorker || filterNickname || onlyRanked || onlyLoggedIn" size="small"
        @click="filterWorker=''; filterNickname=''; onlyRanked=false; onlyLoggedIn=false">清除</a-button>
    </div>

    <!-- table -->
    <a-table
      :data="paged"
      :pagination="false"
      :bordered="false"
      row-key="_key"
      :scroll="{ y: '100%' }"
      class="list-table">
      <template #empty>
        <a-empty :description="allItems.length ? '无匹配记录' : '点击「刷新」或在任务列表点「榜单」触发检查'" />
      </template>
      <template #columns>
        <a-table-column title="Worker" :width="130" ellipsis tooltip>
          <template #cell="{ record }"><span class="mono cell-faint">{{ record.worker_id || '—' }}</span></template>
        </a-table-column>
        <a-table-column title="Profile" :width="80" ellipsis tooltip>
          <template #cell="{ record }"><span class="mono cell-primary">{{ record.profile }}</span></template>
        </a-table-column>
        <a-table-column title="直播间" ellipsis tooltip>
          <template #cell="{ record }">
            <a :href="record.live_url" target="_blank" class="cell-link">{{ shortUrl(record.live_url) }}</a>
          </template>
        </a-table-column>
        <a-table-column title="昵称" :width="130" ellipsis tooltip>
          <template #cell="{ record }">
            <span :class="record.is_logged_in ? 'cell-muted' : 'cell-faint'">
              {{ record.nickname || (record.is_logged_in ? '—' : '未登录') }}
            </span>
          </template>
        </a-table-column>
        <a-table-column title="名次" :width="70" align="center">
          <template #cell="{ record }">
            <a-tag v-if="record.is_ranked" size="small" color="orange" class="mono">{{ record.rank }}</a-tag>
            <span v-else class="cell-faint">—</span>
          </template>
        </a-table-column>
        <a-table-column title="时间" :width="160">
          <template #cell="{ record }"><span class="cell-time">{{ formatTime(record.timestamp) }}</span></template>
        </a-table-column>
        <a-table-column title="操作" :width="70" align="right">
          <template #cell="{ record }"><a-button type="text" size="mini" @click="copy(record)">复制</a-button></template>
        </a-table-column>
      </template>
    </a-table>

    <!-- pager -->
    <div v-if="totalPages > 1" class="list-pager">
      <span class="list-card__meta">第 {{ page }} / {{ totalPages }} 页</span>
      <a-pagination v-model:current="page" :total="filtered.length" :page-size="PAGE_SIZE" size="small" simple />
    </div>
  </a-card>
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

<style scoped>
.rv__filter-w { width: 176px; }
.rv__filter-n { width: 144px; }
</style>
