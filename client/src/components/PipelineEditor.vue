<template>
  <div class="space-y-2">
    <draggable v-model="localSteps" item-key="_id" handle=".drag-handle" ghost-class="opacity-40" animation="150">
      <template #item="{ element, index }">
        <div class="flex items-start gap-2 bg-gray-800 border border-gray-700 rounded-lg p-3 group">
          <!-- drag handle -->
          <div class="drag-handle mt-0.5 cursor-grab text-gray-600 hover:text-gray-400 select-none text-lg leading-none">⠿</div>

          <!-- step number -->
          <div class="text-xs text-gray-600 mt-1 w-4 text-right flex-shrink-0">{{ index + 1 }}</div>

          <!-- type badge + fields -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-2">
              <span :class="['text-xs font-medium px-2 py-0.5 rounded', stepDef(element.type).badge]">
                {{ stepDef(element.type).label }}
              </span>
              <select
                :value="element.type"
                @change="changeType(index, $event.target.value)"
                class="bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-indigo-500"
              >
                <option v-for="(def, key) in STEP_DEFS" :key="key" :value="key">{{ def.label }}</option>
              </select>
            </div>

            <div v-if="stepDef(element.type).fields.length" class="grid grid-cols-2 gap-2">
              <div v-for="field in stepDef(element.type).fields" :key="field.key"
                :class="field.type === 'textarea' ? 'col-span-2' : ''">
                <label class="block text-xs text-gray-500 mb-0.5">{{ field.label }}</label>
                <textarea v-if="field.type === 'textarea'"
                  :value="element[field.key] ?? ''"
                  @input="updateField(index, field.key, $event.target.value)"
                  :placeholder="field.placeholder ?? ''"
                  rows="3"
                  class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-indigo-500 resize-y"
                />
                <select v-else-if="field.type === 'select'"
                  :value="element[field.key] ?? field.default ?? field.options[0]"
                  @change="updateField(index, field.key, $event.target.value)"
                  class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                >
                  <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
                </select>
                <input v-else
                  :type="field.type"
                  :value="element[field.key] ?? field.default ?? ''"
                  @input="updateField(index, field.key, field.type === 'number' ? Number($event.target.value) : $event.target.value)"
                  :placeholder="field.placeholder ?? ''"
                  class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div v-else class="text-xs text-gray-600 italic">无参数</div>
          </div>

          <!-- delete -->
          <button @click="removeStep(index)"
            class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 text-sm mt-0.5 flex-shrink-0 transition-opacity">✕</button>
        </div>
      </template>
    </draggable>

    <!-- add step -->
    <div class="flex items-center gap-2">
      <select v-model="newType" class="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500">
        <option v-for="(def, key) in STEP_DEFS" :key="key" :value="key">{{ def.label }}</option>
      </select>
      <button @click="addStep"
        class="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs px-3 py-1.5 rounded transition-colors">
        + 添加步骤
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import draggable from 'vuedraggable';

const props = defineProps({ modelValue: { type: Array, default: () => [] } });
const emit = defineEmits(['update:modelValue']);

let _uid = 0;
const uid = () => ++_uid;

function toLocal(steps) {
  return steps.map(s => ({ ...s, _id: uid() }));
}

const localSteps = ref(toLocal(props.modelValue));

watch(() => props.modelValue, (v) => {
  localSteps.value = toLocal(v);
}, { deep: true });

watch(localSteps, (v) => {
  emit('update:modelValue', v.map(({ _id, ...rest }) => rest));
}, { deep: true });

const newType = ref('navigate');

const STEP_DEFS = {
  navigate:   { label: '导航',            badge: 'bg-blue-900 text-blue-300',
    fields: [
      { key: 'url',       label: 'URL',       type: 'text',   placeholder: 'https://' },
      { key: 'waitUntil', label: '等待策略',   type: 'select', options: ['commit','load','domcontentloaded','networkidle'], default: 'commit' },
    ]},
  wait:       { label: '随机等待',         badge: 'bg-yellow-900 text-yellow-300',
    fields: [
      { key: 'min', label: '最短(ms)', type: 'number', default: 3000 },
      { key: 'max', label: '最长(ms)', type: 'number', default: 4000 },
    ]},
  dwell:      { label: '挂机(task_time)', badge: 'bg-green-900 text-green-300',  fields: [] },
  reload:     { label: '刷新页面',         badge: 'bg-orange-900 text-orange-300', fields: [] },
  click:      { label: '点击',            badge: 'bg-purple-900 text-purple-300',
    fields: [
      { key: 'string',  label: '选择器 / getBy*', type: 'text', placeholder: "#id 或 getByText('文字')" },
      { key: 'timeout', label: '超时(ms)',         type: 'number', default: 5000 },
    ]},
  dblclick:   { label: '双击',            badge: 'bg-purple-900 text-purple-300',
    fields: [{ key: 'string', label: '选择器 / getBy*', type: 'text' }] },
  hover:      { label: '悬停',            badge: 'bg-indigo-900 text-indigo-300',
    fields: [{ key: 'string', label: '选择器 / getBy*', type: 'text' }] },
  scroll:     { label: '滚动',            badge: 'bg-cyan-900 text-cyan-300',
    fields: [
      { key: 'y',        label: 'Y(px)',     type: 'number', default: 300 },
      { key: 'selector', label: '目标元素',  type: 'text',   placeholder: '可选' },
    ]},
  mousemove:  { label: '移动鼠标',        badge: 'bg-gray-700 text-gray-300',
    fields: [
      { key: 'x', label: 'X', type: 'number', default: 0 },
      { key: 'y', label: 'Y', type: 'number', default: 0 },
    ]},
  rtcookie:   { label: '采集 Cookie',     badge: 'bg-red-900 text-red-300',
    fields: [{ key: 'url', label: 'URL 关键词', type: 'text', placeholder: '/api/user/info' }] },
  eval:       { label: '执行 JS',         badge: 'bg-gray-700 text-gray-300',
    fields: [{ key: 'code', label: 'JS 代码', type: 'textarea', placeholder: "() => document.title" }] },
  'run-code': { label: 'Playwright 代码', badge: 'bg-gray-700 text-gray-300',
    fields: [{ key: 'code', label: '代码', type: 'textarea', placeholder: "async ({ page }) => { ... }" }] },
};

function stepDef(type) {
  return STEP_DEFS[type] ?? { label: type, badge: 'bg-gray-700 text-gray-400', fields: [] };
}

function addStep() {
  const def = STEP_DEFS[newType.value];
  const defaults = {};
  for (const f of def?.fields ?? []) {
    if (f.default !== undefined) defaults[f.key] = f.default;
  }
  localSteps.value.push({ type: newType.value, ...defaults, _id: uid() });
}

function removeStep(idx) {
  localSteps.value.splice(idx, 1);
}

function changeType(idx, type) {
  const def = STEP_DEFS[type];
  const defaults = {};
  for (const f of def?.fields ?? []) {
    if (f.default !== undefined) defaults[f.key] = f.default;
  }
  localSteps.value[idx] = { type, ...defaults, _id: localSteps.value[idx]._id };
}

function updateField(idx, key, value) {
  localSteps.value[idx] = { ...localSteps.value[idx], [key]: value };
}
</script>
