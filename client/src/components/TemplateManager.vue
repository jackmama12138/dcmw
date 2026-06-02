<template>
  <div class="tm">
    <!-- 任务类型列表：顶部横向排列 -->
    <a-card :bordered="true" :body-style="{ padding: '12px 16px' }">
      <template #title><span class="tm__title">任务类型</span></template>
      <template #extra>
        <a-button type="primary" size="small" @click="startNew">
          <template #icon><icon-plus /></template>新建
        </a-button>
      </template>

      <a-empty v-if="!templates.length" description="暂无任务类型" />

      <div v-else class="tm__list">
        <div
          v-for="tpl in templates" :key="tpl.name"
          :class="['tm__item', editing?.name === tpl.name ? 'tm__item--active' : '']"
          :title="tpl.description || `${tpl.pipeline?.length ?? 0} 步 · task_time ${tpl.task_time ?? '—'}s`"
          @click="editTemplate(tpl)">
          <span class="mono tm__item-name">{{ tpl.name }}</span>
          <a-popconfirm content="确认删除该任务类型？" type="warning" @ok="doDelete(tpl.name)">
            <icon-close class="tm__item-del" @click.stop />
          </a-popconfirm>
        </div>
      </div>
    </a-card>

    <!-- 编排器：底部占满整宽 -->
    <a-card :bordered="true" :body-style="{ padding: '16px' }">
      <template v-if="editing">
        <div class="tm__editor-head">
          <a-input v-model="editing.name" :disabled="!isNew" placeholder="task_type 名称 (如 AFK)" class="mono tm__name-input" />
          <a-input v-model="editing.description" placeholder="描述（可选）" class="tm__desc-input" />
          <span class="tm__label">默认 task_time(s)</span>
          <a-input-number v-model="editing.task_time" class="tm__time-input" />
        </div>

        <div class="tm__pipeline">
          <div class="tm__label tm__pipeline-label">Pipeline 编排（可拖拽排序）</div>
          <PipelineEditor v-model="editing.pipeline" />
        </div>

        <a-space :size="12" align="center">
          <a-button type="primary" :loading="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</a-button>
          <a-button @click="editing = null">取消</a-button>
          <span v-if="saveMsg" :class="saveError ? 'tm__msg-err' : 'tm__msg-ok'">{{ saveMsg }}</span>
        </a-space>
      </template>
      <div v-else class="tm__empty">
        <a-empty description="选择上方任务类型编辑，或点击「新建」" />
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import PipelineEditor from './PipelineEditor.vue';
import { Message } from '@arco-design/web-vue';
import { fetchTemplates, saveTemplate, deleteTemplate } from '../api.js';

const templates = ref([]);
const editing = ref(null);
const isNew = ref(false);
const saving = ref(false);
const saveMsg = ref('');
const saveError = ref(false);

async function load() {
  try { templates.value = await fetchTemplates(); } catch {}
}

function startNew() {
  isNew.value = true;
  editing.value = { name: '', description: '', task_time: 3600, pipeline: [] };
}

function editTemplate(tpl) {
  isNew.value = false;
  editing.value = { ...tpl, pipeline: tpl.pipeline ? JSON.parse(JSON.stringify(tpl.pipeline)) : [] };
}

async function save() {
  saveMsg.value = '';
  saveError.value = false;
  if (!editing.value.name) { saveMsg.value = '请填写名称'; saveError.value = true; return; }
  if (!editing.value.pipeline.length) { saveMsg.value = 'pipeline 不能为空'; saveError.value = true; return; }
  saving.value = true;
  try {
    await saveTemplate(editing.value);
    saveMsg.value = '已保存';
    await load();
    isNew.value = false;
  } catch (err) {
    saveMsg.value = err.response?.data?.error ?? err.message;
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

async function doDelete(name) {
  try {
    await deleteTemplate(name);
    if (editing.value?.name === name) editing.value = null;
    await load();
  } catch (err) {
    Message.error(err.response?.data?.error ?? err.message);
  }
}

onMounted(load);
</script>

<style scoped>
.tm { display: flex; flex-direction: column; gap: 16px; }
.tm__title { font-size: 14px; font-weight: 600; }

/* 任务类型：紧凑标签，仅显示名称，自动换行 */
.tm__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tm__item {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 6px 0 12px;
  border: 1px solid var(--bd-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.tm__item:hover { border-color: var(--primary); }
.tm__item--active { border-color: var(--primary); background: #e8f0fe; }
.tm__item-name { font-size: 13px; color: var(--primary); white-space: nowrap; }
/* 删除叉：与文字拉开间距 + 独立点击区，默认半隐藏，hover 才明显，避免误触 */
.tm__item-del {
  margin-left: 14px;
  padding: 4px;
  font-size: 12px;
  color: var(--tx-4);
  opacity: 0;
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.15s, opacity 0.15s, background 0.15s;
}
.tm__item:hover .tm__item-del { opacity: 1; }
.tm__item-del:hover { color: var(--danger); background: rgba(245, 63, 63, 0.1); }

/* 编辑头部：名称 / 描述 / task_time 一行 */
.tm__editor-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.tm__name-input { width: 180px; flex-shrink: 0; }
.tm__desc-input { flex: 1; min-width: 0; }
.tm__time-input { width: 110px; flex-shrink: 0; }
.tm__label { font-size: 12px; color: var(--tx-3); white-space: nowrap; flex-shrink: 0; }

.tm__pipeline { margin-bottom: 16px; }
.tm__pipeline-label { margin-bottom: 8px; }

.tm__msg-err { font-size: 12px; color: var(--danger); }
.tm__msg-ok  { font-size: 12px; color: var(--success); }
.tm__empty { display: flex; align-items: center; justify-content: center; height: 160px; }
</style>
