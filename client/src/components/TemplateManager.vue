<template>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <!-- template list -->
    <div class="bg-white rounded-xl p-4 border border-gray-200">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-sm">任务类型</h3>
        <button @click="startNew" class="text-xs bg-primary hover:bg-primary-hover text-white px-2 py-1 rounded transition-colors">+ 新建</button>
      </div>
      <div v-if="!templates.length" class="text-xs text-gray-600 py-4 text-center">暂无任务类型</div>
      <div v-for="tpl in templates" :key="tpl.name"
        @click="editTemplate(tpl)"
        :class="['cursor-pointer rounded-lg p-3 mb-2 border transition-colors',
          editing?.name === tpl.name
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-200 hover:border-gray-300 bg-gray-50']">
        <div class="flex items-center justify-between">
          <span class="font-mono text-sm text-blue-600">{{ tpl.name }}</span>
          <button @click.stop="confirmDelete(tpl.name)"
            class="text-xs text-red-500 hover:text-red-500 opacity-0 group-hover:opacity-100">删除</button>
        </div>
        <div v-if="tpl.description" class="text-xs text-gray-500 mt-1 truncate">{{ tpl.description }}</div>
        <div class="text-xs text-gray-600 mt-1">{{ tpl.pipeline?.length ?? 0 }} 步 · task_time {{ tpl.task_time ?? '—' }}s</div>
      </div>
    </div>

    <!-- editor -->
    <div class="lg:col-span-2 bg-white rounded-xl p-4 border border-gray-200">
      <template v-if="editing">
        <div class="flex items-center gap-3 mb-4">
          <input v-model="editing.name" :disabled="!isNew"
            placeholder="task_type 名称 (如 AFK)"
            class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-400 disabled:opacity-60 w-40" />
          <input v-model="editing.description" placeholder="描述（可选）"
            class="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
          <div class="flex items-center gap-1">
            <label class="text-xs text-gray-500">默认 task_time(s)</label>
            <input v-model.number="editing.task_time" type="number"
              class="w-20 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
          </div>
        </div>

        <div class="mb-4">
          <div class="text-xs text-gray-500 mb-2">Pipeline 编排（可拖拽排序）</div>
          <PipelineEditor v-model="editing.pipeline" />
        </div>

        <div class="flex items-center gap-3">
          <button @click="save" :disabled="saving"
            class="bg-primary hover:bg-primary-hover text-white disabled:opacity-50 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button @click="editing = null" class="text-xs text-gray-500 hover:text-gray-700">取消</button>
          <span v-if="saveMsg" :class="saveError ? 'text-red-500' : 'text-green-600'" class="text-xs">{{ saveMsg }}</span>
        </div>
      </template>
      <div v-else class="flex items-center justify-center h-40 text-gray-600 text-sm">
        选择左侧任务类型编辑，或点击「新建」
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import PipelineEditor from './PipelineEditor.vue';
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

async function confirmDelete(name) {
  if (!confirm(`确认删除任务类型 "${name}"？`)) return;
  try {
    await deleteTemplate(name);
    if (editing.value?.name === name) editing.value = null;
    await load();
  } catch (err) {
    alert(err.response?.data?.error ?? err.message);
  }
}

onMounted(load);
</script>
