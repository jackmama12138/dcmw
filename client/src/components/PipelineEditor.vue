<template>
  <div class="space-y-2">
    <draggable v-model="localSteps" item-key="_id" handle=".drag-handle" ghost-class="opacity-40" animation="150">
      <template #item="{ element, index }">
        <div class="flex items-start gap-2 bg-gray-800 border border-gray-700 rounded-lg p-3 group">
          <div class="drag-handle mt-0.5 cursor-grab text-gray-600 hover:text-gray-400 select-none text-lg leading-none">⠿</div>
          <div class="text-xs text-gray-600 mt-1 w-4 text-right flex-shrink-0">{{ index + 1 }}</div>

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

            <div v-if="stepDef(element.type).fields.length" class="flex flex-wrap items-end gap-x-2 gap-y-1.5">
              <div v-for="field in stepDef(element.type).fields" :key="field.key"
                :class="field.type === 'textarea' ? 'w-full'
                       : field.type === 'checkbox' ? 'flex items-center gap-1.5 flex-shrink-0 pb-0.5'
                       : field.type === 'number'   ? 'flex-shrink-0 w-28'
                       : field.type === 'select'   ? 'flex-shrink-0'
                       : 'flex-1 min-w-0'">
                <!-- checkbox: inline label + checkbox -->
                <template v-if="field.type === 'checkbox'">
                  <input type="checkbox"
                    :checked="element[field.key] ?? field.default ?? false"
                    @change="updateField(index, field.key, $event.target.checked)"
                    class="w-3.5 h-3.5 rounded accent-indigo-500 flex-shrink-0 cursor-pointer"
                  />
                  <label class="text-xs text-gray-400 select-none cursor-pointer">{{ field.label }}</label>
                </template>
                <!-- other field types: label above input -->
                <template v-else>
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
                    class="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
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
                </template>
              </div>
            </div>
            <div v-else class="text-xs text-gray-600 italic">无参数</div>
          </div>

          <button @click="removeStep(index)"
            class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 text-sm mt-0.5 flex-shrink-0 transition-opacity">✕</button>
        </div>
      </template>
    </draggable>

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

function strip(steps) {
  return steps.map(({ _id, ...rest }) => rest);
}

const localSteps = ref(toLocal(props.modelValue));

// Only re-sync from props when the incoming content actually differs from what we just emitted.
// This breaks the emit→prop-change→re-sync→emit infinite loop.
watch(() => props.modelValue, (v) => {
  const incoming = JSON.stringify(v);
  const current  = JSON.stringify(strip(localSteps.value));
  if (incoming === current) return;
  localSteps.value = toLocal(v);
});

watch(localSteps, (v) => {
  emit('update:modelValue', strip(v));
}, { deep: true });

const newType = ref('navigate');

const STEP_DEFS = {
  navigate:    { label: '进入',            badge: 'bg-blue-900 text-blue-300',
    fields: [
      { key: 'url',       label: 'URL',       type: 'text',   placeholder: 'https://' },
      { key: 'waitUntil', label: '等待策略',   type: 'select', options: ['commit','load','domcontentloaded','networkidle'], default: 'commit' },
    ]},
  wait:        { label: '随机等待',         badge: 'bg-yellow-900 text-yellow-300',
    fields: [
      { key: 'min', label: '最短(ms)', type: 'number', default: 3000 },
      { key: 'max', label: '最长(ms)', type: 'number', default: 4000 },
    ]},
  dwell:       { label: '挂机(task_time)', badge: 'bg-green-900 text-green-300',  fields: [] },
  reload:      { label: '刷新页面',         badge: 'bg-orange-900 text-orange-300', fields: [] },
  antidetect:     { label: '防检测',     badge: 'bg-teal-900 text-teal-300',    fields: [] },
  'hover-capture': { label: 'Hover 移入移出', badge: 'bg-indigo-900 text-indigo-300',
    fields: [
      { key: 'string', label: '选择器 / getBy*', type: 'text', placeholder: "getByText('推荐') 或 .card" },
      { key: 'dwell',  label: '悬停时长(ms)',     type: 'number', default: 1000 },
      { key: 'exit_x', label: '移走 X',           type: 'number', default: 0 },
      { key: 'exit_y', label: '移走 Y',           type: 'number', default: 0 },
    ]},
  intercept: { label: '拦截响应数据', badge: 'bg-red-900 text-red-300',
    fields: [
      { key: 'url',     label: '响应 URL 关键词', type: 'text', placeholder: '/api/recommend' },
      { key: 'timeout', label: '超时(ms)',         type: 'number', default: 15000 },
    ]},
  'pause-video':  { label: '暂停视频',   badge: 'bg-teal-900 text-teal-300',
    fields: [
      { key: 'selector', label: 'CSS 选择器', type: 'text', placeholder: 'video', default: 'video' },
      { key: 'all',      label: '匹配全部',   type: 'checkbox', default: false },
    ]},
  'mute-video':   { label: '静音视频',   badge: 'bg-teal-900 text-teal-300',
    fields: [
      { key: 'selector', label: 'CSS 选择器', type: 'text', placeholder: 'video', default: 'video' },
      { key: 'mute',     label: '静音',       type: 'checkbox', default: true },
      { key: 'all',      label: '匹配全部',   type: 'checkbox', default: false },
    ]},
  click:       { label: '点击',             badge: 'bg-purple-900 text-purple-300',
    fields: [
      { key: 'string',  label: '选择器 / getBy*', type: 'text', placeholder: "#id 或 getByText('文字')" },
      { key: 'timeout', label: '超时(ms)',         type: 'number', default: 5000 },
    ]},
  dblclick:    { label: '双击',             badge: 'bg-purple-900 text-purple-300',
    fields: [{ key: 'string', label: '选择器 / getBy*', type: 'text' }] },
  hover:       { label: '悬停',             badge: 'bg-indigo-900 text-indigo-300',
    fields: [{ key: 'string', label: '选择器 / getBy*', type: 'text' }] },
  fill:        { label: '填写输入框',        badge: 'bg-pink-900 text-pink-300',
    fields: [
      { key: 'string', label: '选择器 / getBy*', type: 'text', placeholder: "#input 或 getByPlaceholder('...')" },
      { key: 'value',  label: '填写内容',         type: 'text', placeholder: '输入文字' },
      { key: 'mode',   label: '模式',             type: 'select', options: ['fill','type'], default: 'fill' },
      { key: 'delay',  label: '打字间隔(ms)',      type: 'number', default: 50 },
    ]},
  scroll:      { label: '滚动',             badge: 'bg-cyan-900 text-cyan-300',
    fields: [
      { key: 'y',        label: 'Y(px)',     type: 'number', default: 300 },
      { key: 'selector', label: '目标元素',  type: 'text',   placeholder: '可选' },
    ]},
  mousemove:   { label: '移动鼠标',         badge: 'bg-gray-700 text-gray-300',
    fields: [
      { key: 'x', label: 'X', type: 'number', default: 0 },
      { key: 'y', label: 'Y', type: 'number', default: 0 },
    ]},
  'wait-for':  { label: '等待元素',         badge: 'bg-cyan-900 text-cyan-300',
    fields: [
      { key: 'string',        label: '选择器 / getBy*',  type: 'text',     placeholder: "getByText('xxx') 或 .class" },
      { key: 'timeout',       label: '超时(ms)',         type: 'number',   default: 10000 },
      { key: 'stopOnTimeout', label: '超时结束任务',     type: 'checkbox', default: false },
    ]},
  rtcookie:    { label: '采集 Cookie',      badge: 'bg-red-900 text-red-300',
    fields: [{ key: 'url', label: 'URL 关键词', type: 'text', placeholder: '/api/user/info' }] },
  eval:        { label: '执行 JS',          badge: 'bg-gray-700 text-gray-300',
    fields: [{ key: 'code', label: 'JS 代码', type: 'textarea', placeholder: "() => document.title" }] },
  'run-code':  { label: 'Playwright 代码',  badge: 'bg-gray-700 text-gray-300',
    fields: [{ key: 'code', label: '代码', type: 'textarea', placeholder: "async ({ page }) => { ... }" }] },
  close:       { label: '关闭浏览器',        badge: 'bg-gray-800 text-gray-400',    fields: [] },
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
