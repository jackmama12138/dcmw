<template>
  <a-card class="list-card" :bordered="true">
    <template #title>
      <a-space :size="12" align="center">
        <span class="list-card__title">拦截响应数据</span>
        <a-tag v-if="allItems.length" size="small">{{ filtered.length }} 条</a-tag>
      </a-space>
    </template>
    <template #extra>
      <a-space :size="8">
        <a-button size="small" @click="copyAll">复制 JSON</a-button>
        <a-button type="primary" size="small" :loading="loading" @click="loadAll">
          {{ loading ? '加载中…' : '刷新全部' }}
        </a-button>
      </a-space>
    </template>

    <!-- toolbar -->
    <div class="list-toolbar">
      <a-input v-model="filterWorker" placeholder="按 Worker 搜索" allow-clear class="cap__filter-w" />
      <a-input v-model="filterTaskId" placeholder="按 task_id 过滤" allow-clear class="cap__filter-t" />
      <a-input v-model="filterUrl" placeholder="按 URL 关键词过滤" allow-clear class="cap__filter-u" />
      <a-button v-if="filterWorker || filterTaskId || filterUrl" size="small"
        @click="filterWorker=''; filterTaskId=''; filterUrl=''">清除</a-button>
    </div>

    <div class="cap__body">
      <a-empty v-if="!allItems.length && !loading" description="点击「刷新全部」加载数据" />
      <a-empty v-else-if="!filtered.length && allItems.length" description="无匹配记录" />

      <a-collapse v-else v-model:active-key="activeKeys" :bordered="false" accordion>
        <a-collapse-item v-for="(c, i) in filtered" :key="i">
          <template #header>
            <div class="cap__row">
              <span class="mono cell-id cap__row-worker" :title="c.worker_id">{{ c.worker_id || '—' }}</span>
              <span class="mono cell-primary cap__row-fixed">{{ c.profile }}</span>
              <a-tag size="small" color="purple" class="mono">{{ c.pattern }}</a-tag>
              <span class="mono cap__row-url" :title="c.matched_url">{{ c.matched_url }}</span>
              <span class="cell-time">{{ formatTime(c.timestamp) }}</span>
            </div>
          </template>
          <pre class="cap__pre">{{ formatData(c.data) }}</pre>
        </a-collapse-item>
      </a-collapse>
    </div>
  </a-card>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { fetchAllCaptures } from '../api.js';

const props = defineProps({ initialTaskId: { type: String, default: '' } });

const allItems   = ref([]);
const loading    = ref(false);
const filterWorker = ref('');
const filterTaskId = ref('');
const filterUrl    = ref('');
const activeKeys   = ref([]);

const filtered = computed(() => {
  let list = allItems.value;
  if (filterWorker.value) list = list.filter(c => c.worker_id?.includes(filterWorker.value));
  if (filterTaskId.value) list = list.filter(c => c.task_id?.includes(filterTaskId.value));
  if (filterUrl.value)    list = list.filter(c => (c.matched_url || c.pattern || '').includes(filterUrl.value));
  return list;
});

watch(() => props.initialTaskId, v => { if (v) { filterTaskId.value = v; if (!allItems.value.length) loadAll(); } });

let abortCtrl;
onMounted(loadAll);
onUnmounted(() => abortCtrl?.abort());

async function loadAll() {
  abortCtrl?.abort();
  abortCtrl = new AbortController();
  const { signal } = abortCtrl;
  loading.value = true;
  activeKeys.value = [];
  try {
    const rows = await fetchAllCaptures().catch(() => []);
    if (!signal.aborted) allItems.value = rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

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

<style scoped>
.cap__filter-w { width: 160px; }
.cap__filter-t { width: 176px; }
.cap__filter-u { width: 160px; }

.cap__body { flex: 1; min-height: 0; overflow-y: auto; }

.cap__row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  width: 100%;
  min-width: 0;
}
.cap__row-worker { flex-shrink: 0; }
.cap__row-fixed  { font-weight: 500; flex-shrink: 0; }
.cap__row-url    { color: var(--tx-2); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cap__pre {
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--tx-2);
  background: var(--bg-input);
  border: 1px solid var(--bd-color);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  overflow-x: auto;
  max-height: 256px;
  overflow-y: auto;
  margin: 0;
}
</style>
