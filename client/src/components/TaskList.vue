<template>
  <a-card class="list-card" :bordered="true">
    <template #title><span class="list-card__title">任务列表</span></template>
    <template #extra>
      <a-space :size="12">
        <span class="list-card__meta">共 {{ tasks.length }} 条</span>
        <span class="list-card__meta">每 10s 自动刷新</span>
      </a-space>
    </template>

    <a-table
      :data="paged"
      :pagination="false"
      :bordered="false"
      row-key="task_id"
      :scroll="{ y: '100%' }"
      class="list-table">
      <template #empty><a-empty description="暂无任务" /></template>
      <template #columns>
        <a-table-column title="" :width="40">
          <template #cell="{ record }">
            <a-badge :status="dotStatus(record.status)" />
          </template>
        </a-table-column>

        <a-table-column title="Task ID" :width="160">
          <template #cell="{ record }">
            <span class="mono cell-id">{{ record.task_id }}</span>
          </template>
        </a-table-column>

        <a-table-column title="目标 URL" ellipsis tooltip>
          <template #cell="{ record }">
            <span class="cell-muted">{{ record.target_url }}</span>
          </template>
        </a-table-column>

        <a-table-column title="模板" :width="110">
          <template #cell="{ record }">
            <a-tag v-if="record.task_type || record.template" size="small" class="mono">
              {{ record.task_type || record.template }}
            </a-tag>
          </template>
        </a-table-column>

        <a-table-column title="进度" :width="200" align="right">
          <template #cell="{ record }">
            <div class="tl__progress">
              <a-progress
                :percent="progressPct(record) / 100"
                :show-text="false"
                size="mini"
                class="tl__progress-bar"
                :status="record.status === 'done' ? 'success' : 'normal'" />
              <div class="tl__progress-nums">
                <span class="cell-accent">{{ record.completed }}</span>
                <span class="cell-muted">/</span>
                <span class="cell-faint">{{ record.count }}</span>
                <span v-if="record.running > 0" class="tl__t-amber">+{{ record.running }}</span>
                <span v-if="record.failed > 0" class="tl__t-red">✕{{ record.failed }}</span>
              </div>
            </div>
          </template>
        </a-table-column>

        <a-table-column title="状态" :width="90" align="center">
          <template #cell="{ record }">
            <a-tag size="small" :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
          </template>
        </a-table-column>

        <a-table-column title="数量" :width="90" align="right">
          <template #cell="{ record }">
            <span class="mono" :class="record.status === 'running' ? 'tl__t-amber' : 'cell-faint'">
              {{ record.completed ?? 0 }}/{{ record.count }}
            </span>
          </template>
        </a-table-column>
      </template>
    </a-table>

    <div v-if="totalPages > 1" class="list-pager">
      <span class="list-card__meta">第 {{ page }} / {{ totalPages }} 页，共 {{ tasks.length }} 条</span>
      <a-pagination v-model:current="page" :total="tasks.length" :page-size="PAGE_SIZE" size="small" simple />
    </div>
  </a-card>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({ tasks: { type: Array, default: () => [] } });

const PAGE_SIZE = 50;
const page = ref(1);

const totalPages = computed(() => Math.max(1, Math.ceil(props.tasks.length / PAGE_SIZE)));
const paged      = computed(() => props.tasks.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

function dotStatus(s) {
  return {
    pending: 'normal',
    running: 'warning',
    done:    'success',
    stopped: 'danger',
    error:   'danger',
  }[s] ?? 'normal';
}
function statusColor(s) {
  return {
    pending: 'gray',
    running: 'orange',
    done:    'green',
    stopped: 'red',
    error:   'red',
  }[s] ?? 'gray';
}
function statusLabel(s) {
  return { pending: '等待', running: '运行中', done: '完成', stopped: '已停止', error: '错误' }[s] ?? s;
}
function progressPct(t) {
  if (!t.count) return 0;
  return Math.min(100, Math.round((t.completed / t.count) * 100));
}
</script>

<style scoped>
.tl__progress {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.tl__progress-bar { flex: 1; min-width: 40px; max-width: 90px; }
.tl__progress-nums {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}
.tl__t-amber { color: var(--warning); }
.tl__t-red   { color: var(--danger); }
</style>
