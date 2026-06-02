<template>
  <a-row :gutter="16">
    <!-- template list -->
    <a-col :xs="24" :lg="8">
      <a-card :bordered="true" :body-style="{ padding: '16px' }">
        <template #title><span class="tm__title">任务类型</span></template>
        <template #extra>
          <a-button type="primary" size="small" @click="startNew">
            <template #icon><icon-plus /></template>新建
          </a-button>
        </template>

        <a-empty v-if="!templates.length" description="暂无任务类型" />

        <a-space v-else direction="vertical" :size="8" fill>
          <a-card
            v-for="tpl in templates" :key="tpl.name"
            hoverable size="small"
            :class="['tm__item', editing?.name === tpl.name ? 'tm__item--active' : '']"
            :body-style="{ padding: '12px' }"
            @click="editTemplate(tpl)">
            <div class="tm__item-head">
              <span class="mono tm__item-name">{{ tpl.name }}</span>
              <a-popconfirm content="确认删除该任务类型？" type="warning" @ok="doDelete(tpl.name)">
                <a-button type="text" status="danger" size="mini" @click.stop>删除</a-button>
              </a-popconfirm>
            </div>
            <div v-if="tpl.description" class="tm__item-desc">{{ tpl.description }}</div>
            <div class="tm__item-meta">{{ tpl.pipeline?.length ?? 0 }} 步 · task_time {{ tpl.task_time ?? '—' }}s</div>
          </a-card>
        </a-space>
      </a-card>
    </a-col>

    <!-- editor -->
    <a-col :xs="24" :lg="16">
      <a-card :bordered="true" :body-style="{ padding: '16px' }">
        <template v-if="editing">
          <a-space :size="12" align="center" class="tm__editor-head" fill>
            <a-input v-model="editing.name" :disabled="!isNew" placeholder="task_type 名称 (如 AFK)" class="mono tm__name-input" />
            <a-input v-model="editing.description" placeholder="描述（可选）" class="tm__desc-input" />
            <a-space :size="4" align="center">
              <span class="tm__label">默认 task_time(s)</span>
              <a-input-number v-model="editing.task_time" :hide-button="false" class="tm__time-input" />
            </a-space>
          </a-space>

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
          <a-empty description="选择左侧任务类型编辑，或点击「新建」" />
        </div>
      </a-card>
    </a-col>
  </a-row>
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
.tm__title { font-size: 14px; font-weight: 600; }

.tm__item { cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.tm__item--active { border-color: var(--primary); background: #e8f0fe; }
.tm__item-head { display: flex; align-items: center; justify-content: space-between; }
.tm__item-name { font-size: 13px; color: var(--primary); }
.tm__item-desc { font-size: 12px; color: var(--tx-3); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm__item-meta { font-size: 12px; color: var(--tx-2); margin-top: 4px; }

.tm__editor-head { margin-bottom: 16px; }
.tm__name-input { width: 160px; flex-shrink: 0; }
.tm__desc-input { flex: 1; }
.tm__time-input { width: 96px; }
.tm__label { font-size: 12px; color: var(--tx-3); white-space: nowrap; }

.tm__pipeline { margin-bottom: 16px; }
.tm__pipeline-label { margin-bottom: 8px; }

.tm__msg-err { font-size: 12px; color: var(--danger); }
.tm__msg-ok  { font-size: 12px; color: var(--success); }
.tm__empty { display: flex; align-items: center; justify-content: center; height: 160px; }
</style>
