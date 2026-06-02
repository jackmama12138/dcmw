<template>
  <a-card class="shot-card" :bordered="true" :body-style="{ padding: '0' }">
    <template #title>
      <a-space :size="12" align="center">
        <span class="shot__title">截图查看</span>
        <a-tag v-if="allShots.length" size="small">{{ filtered.length }} 张</a-tag>
      </a-space>
    </template>
    <template #extra>
      <a-button type="primary" size="small" :loading="loading" @click="load">
        {{ loading ? '加载中…' : '刷新' }}
      </a-button>
    </template>

    <!-- filters -->
    <div class="shot__filters">
      <a-input v-model="filterWorker" placeholder="按 Worker 搜索" allow-clear class="shot__filter-w" />
      <a-select v-model="filterProfile" placeholder="全部 Profile" allow-clear class="shot__filter-p">
        <a-option value="">全部 Profile</a-option>
        <a-option v-for="p in profiles" :key="p" :value="p">{{ p }}</a-option>
      </a-select>
      <a-button v-if="filterWorker || filterProfile" size="small"
        @click="filterWorker=''; filterProfile=''">清除</a-button>
    </div>

    <!-- grid -->
    <div class="shot__body">
      <a-empty v-if="!allShots.length && !loading" description="点击「刷新」或在任务列表点「截图」触发" />
      <a-empty v-else-if="!filtered.length" description="无匹配截图" />
      <a-image-preview-group v-else infinite>
        <div class="shot__grid">
          <a-card v-for="s in paged" :key="s.worker_id + ':' + s.profile" hoverable :bordered="true"
            size="small" :body-style="{ padding: '0' }" class="shot__item">
            <div class="shot__item-img">
              <a-image :src="s.url" width="100%" height="100" fit="cover" show-loader />
              <a-popconfirm content="确认删除该截图？" type="warning" @ok="doDelete(s)">
                <button class="shot__del" title="删除" @click.stop><icon-delete /></button>
              </a-popconfirm>
            </div>
            <div class="shot__item-meta">
              <div class="mono shot__item-worker" :title="s.worker_id">{{ s.worker_id || '—' }}</div>
              <div class="mono shot__item-profile">{{ s.profile }}</div>
              <div class="shot__item-time">{{ formatTime(s.timestamp) }}</div>
            </div>
          </a-card>
        </div>
      </a-image-preview-group>
    </div>

    <!-- pagination -->
    <div v-if="totalPages > 1" class="shot__pager">
      <span class="shot__meta">第 {{ page }} / {{ totalPages }} 页，共 {{ filtered.length }} 张</span>
      <a-pagination v-model:current="page" :total="filtered.length" :page-size="PAGE_SIZE" size="small" simple />
    </div>
  </a-card>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Message } from '@arco-design/web-vue';
import { fetchScreenshots, deleteScreenshot } from '../api.js';

const PAGE_SIZE = 50;

const allShots     = ref([]);
const loading      = ref(false);
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

async function doDelete(s) {
  const filename = s.filename || s.url?.split('/').pop()?.split('?')[0];
  if (!filename) return;
  try {
    await deleteScreenshot(filename);
    allShots.value = allShots.value.filter(x => x !== s);
    Message.success('已删除');
  } catch (err) {
    Message.error(err.response?.data?.error ?? err.message);
  }
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}
</script>

<style scoped>
.shot-card {
  height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
}
.shot-card :deep(.arco-card-body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.shot__title { font-size: 14px; font-weight: 600; }
.shot__meta  { font-size: 12px; color: var(--tx-3); }

.shot__filters {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--bd-color);
  flex-shrink: 0;
}
.shot__filter-w { width: 176px; }
.shot__filter-p { width: 150px; }

.shot__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}
.shot__grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}
.shot__item-img { position: relative; }
.shot__del {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}
.shot__item:hover .shot__del { opacity: 1; }
.shot__del:hover { background: var(--danger); }

.shot__item-meta { padding: 8px 10px; font-size: 12px; }
.shot__item-worker  { color: var(--tx-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shot__item-profile { color: var(--primary); margin-top: 2px; }
.shot__item-time    { color: var(--tx-2); margin-top: 2px; }

.shot__pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  border-top: 1px solid var(--bd-color);
  flex-shrink: 0;
}
</style>
