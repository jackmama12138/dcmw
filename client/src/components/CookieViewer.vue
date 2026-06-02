<template>
  <a-card class="list-card" :bordered="true">
    <template #title>
      <a-space :size="12" align="center">
        <span class="list-card__title">Cookie 采集</span>
        <a-tag v-if="deduped.length" size="small">{{ filtered.length }} 用户</a-tag>
        <span v-if="deduped.length !== allItems.length" class="list-card__meta">
          (原始 {{ allItems.length }} 条)
        </span>
      </a-space>
    </template>
    <template #extra>
      <a-space :size="8">
        <a-button size="small" @click="copyAll">复制 JSON</a-button>
        <a-popconfirm content="确认清空全部 Cookie？此操作不可恢复" type="warning" @ok="doClearAll">
          <a-button size="small" status="danger" :disabled="!deduped.length">清空</a-button>
        </a-popconfirm>
        <a-button type="primary" size="small" :loading="loading" @click="loadAll">
          {{ loading ? '加载中…' : '刷新全部' }}
        </a-button>
      </a-space>
    </template>

    <!-- toolbar -->
    <div class="list-toolbar">
      <a-input v-model="filterWorker" placeholder="按 Worker 搜索" allow-clear class="cv__filter-w" />
      <a-input v-model="filterUid" placeholder="按 user_unique_id 搜索" allow-clear class="cv__filter-uid" />
      <a-select v-model="filterProfile" placeholder="全部 Profile" allow-clear class="cv__filter-p">
        <a-option value="">全部 Profile</a-option>
        <a-option v-for="p in profiles" :key="p" :value="p">{{ p }}</a-option>
      </a-select>
      <a-button v-if="filterWorker || filterUid || filterProfile" size="small"
        @click="filterWorker=''; filterUid=''; filterProfile=''">清除</a-button>
      <a-spin v-if="loading" :size="14" class="list-toolbar__spacer" />
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
        <a-empty :description="allItems.length ? '无匹配记录' : '点击「刷新全部」加载数据'" />
      </template>
      <template #columns>
        <a-table-column title="Worker" :width="120" ellipsis tooltip>
          <template #cell="{ record }"><span class="mono cell-faint">{{ record.worker_id || '—' }}</span></template>
        </a-table-column>
        <a-table-column title="Profile" :width="100">
          <template #cell="{ record }"><span class="mono cell-primary">{{ record.profile }}</span></template>
        </a-table-column>
        <a-table-column title="user_unique_id" :width="180" ellipsis tooltip>
          <template #cell="{ record }"><span class="mono cell-accent">{{ record.user_unique_id || '—' }}</span></template>
        </a-table-column>
        <a-table-column title="UA" :width="160" ellipsis tooltip>
          <template #cell="{ record }"><span class="mono cell-faint">{{ record.ua || '—' }}</span></template>
        </a-table-column>
        <a-table-column title="Cookie" ellipsis tooltip>
          <template #cell="{ record }"><span class="mono cell-strong cv__cookie">{{ record.cookie || '—' }}</span></template>
        </a-table-column>
        <a-table-column title="时间" :width="170">
          <template #cell="{ record }"><span class="cell-muted">{{ formatTime(record.timestamp) }}</span></template>
        </a-table-column>
        <a-table-column title="操作" :width="110" align="right">
          <template #cell="{ record }">
            <a-button type="text" size="mini" @click="copyItem(record)">复制</a-button>
            <a-popconfirm content="确认删除该条 Cookie？" type="warning" @ok="doDelete(record)">
              <a-button type="text" size="mini" status="danger">删除</a-button>
            </a-popconfirm>
          </template>
        </a-table-column>
      </template>
    </a-table>

    <!-- pager -->
    <div v-if="totalPages > 1" class="list-pager">
      <span class="list-card__meta">第 {{ page }} / {{ totalPages }} 页，共 {{ filtered.length }} 用户</span>
      <a-pagination v-model:current="page" :total="filtered.length" :page-size="PAGE_SIZE" size="small" simple />
    </div>
  </a-card>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Message } from '@arco-design/web-vue';
import { fetchCookies, deleteCookie, clearCookies } from '../api.js';

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

async function doDelete(c) {
  const uid = c.user_unique_id || `_nuid_${c.profile}`;
  try {
    await deleteCookie(uid);
    allItems.value = allItems.value.filter(x => x !== c && (x.user_unique_id || `_nuid_${x.profile}`) !== uid);
    Message.success('已删除');
  } catch (err) {
    Message.error(err.response?.data?.error ?? err.message);
  }
}

async function doClearAll() {
  try {
    const { removed } = await clearCookies();
    allItems.value = [];
    Message.success(`已清空 ${removed ?? 0} 条`);
  } catch (err) {
    Message.error(err.response?.data?.error ?? err.message);
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

<style scoped>
.cv__filter-w   { width: 160px; }
.cv__filter-uid { width: 200px; }
.cv__filter-p   { width: 150px; }
.cv__cookie     { user-select: all; }
</style>
