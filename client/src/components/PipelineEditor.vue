<template>
  <div class="space-y-2">
    <draggable v-model="localSteps" item-key="_id" handle=".drag-handle" ghost-class="opacity-40" animation="150">
      <template #item="{ element, index }">
        <div class="flex items-start gap-2 bg-white border border-gray-200 rounded-lg p-3 group">
          <div class="drag-handle mt-0.5 cursor-grab text-gray-400 hover:text-gray-600 select-none text-lg leading-none">⠿</div>
          <div class="text-xs text-gray-400 mt-1 w-4 text-right flex-shrink-0">{{ index + 1 }}</div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-2">
              <span :class="['text-xs font-medium px-2 py-0.5 rounded cursor-default', stepDef(element.type).badge]"
                :title="stepDef(element.type).desc ?? ''">
                {{ stepDef(element.type).label }}
              </span>
              <select
                :value="element.type"
                @change="changeType(index, $event.target.value)"
                class="bg-gray-50 border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-400"
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
                  <label class="text-xs text-gray-500 select-none cursor-pointer">{{ field.label }}</label>
                </template>
                <!-- other field types: label above input -->
                <template v-else>
                  <label class="block text-xs text-gray-500 mb-0.5">{{ field.label }}</label>
                  <textarea v-if="field.type === 'textarea'"
                    :value="element[field.key] ?? ''"
                    @input="updateField(index, field.key, $event.target.value)"
                    :placeholder="field.placeholder ?? ''"
                    rows="3"
                    class="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-blue-400 resize-y"
                  />
                  <select v-else-if="field.type === 'select'"
                    :value="element[field.key] ?? field.default ?? field.options[0]"
                    @change="updateField(index, field.key, $event.target.value)"
                    class="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                  >
                    <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
                  </select>
                  <input v-else
                    :type="field.type"
                    :value="element[field.key] ?? field.default ?? ''"
                    @input="updateField(index, field.key, field.type === 'number' ? Number($event.target.value) : $event.target.value)"
                    :placeholder="field.placeholder ?? ''"
                    class="w-full bg-gray-50 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-400"
                  />
                </template>
              </div>
            </div>
            <div v-else class="text-xs text-gray-400 italic">无参数</div>
          </div>

          <button @click="removeStep(index)"
            class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-500 text-sm mt-0.5 flex-shrink-0 transition-opacity">✕</button>
        </div>
      </template>
    </draggable>

    <div class="flex items-center gap-2">
      <select v-model="newType" class="bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400">
        <option v-for="(def, key) in STEP_DEFS" :key="key" :value="key">{{ def.label }}</option>
      </select>
      <button @click="addStep"
        class="bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs px-3 py-1.5 rounded transition-colors">
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

// pipeline 步骤定义，与 gateway VALID_ACTION_TYPES 和 worker actions.js 保持同步
// 新增动作时三处同步更新：gateway/src/router.js、worker/src/actions.js、此处
//
// on_fail 字段说明（适用于可能失败的交互动作）：
//   continue — 默认，失败后继续执行下一步
//   stop     — 以成功状态结束任务（预期中止，如检测到未登录则不继续）
//   error    — 以错误状态结束任务（意外失败需标记）

const ON_FAIL_FIELD = { key: 'on_fail', label: '失败行为', type: 'select', options: ['continue','stop','error'], default: 'continue' };

const STEP_DEFS = {
  // ─── 页面控制 ───────────────────────────────────────────────────────────────
  navigate: {
    label: '打开页面', badge: 'bg-blue-50 text-blue-600',
    desc: '导航到指定 URL，支持等待不同加载状态',
    fields: [
      { key: 'url',          label: '目标 URL',    type: 'text',     placeholder: 'https://example.com' },
      { key: 'waitUntil',   label: '等待策略',    type: 'select',   options: ['commit','load','domcontentloaded','networkidle'], default: 'commit' },
      { key: 'blockNewTabs', label: '拦截新标签页', type: 'checkbox', default: false },
      ON_FAIL_FIELD,
    ]},
  reload: {
    label: '刷新页面', badge: 'bg-orange-50 text-orange-600',
    desc: '刷新当前页面，等待 DOMContentLoaded',
    fields: [ON_FAIL_FIELD] },
  wait: {
    label: '随机等待', badge: 'bg-yellow-50 text-yellow-600',
    desc: '在 min~max 范围内随机等待，模拟人类停顿',
    fields: [
      { key: 'min', label: '最短(ms)', type: 'number', default: 3000 },
      { key: 'max', label: '最长(ms)', type: 'number', default: 4000 },
    ]},
  dwell: {
    label: '计时停留', badge: 'bg-green-50 text-green-600',
    desc: '停留 task_time 秒，可被提前停止',
    fields: [] },
  close: {
    label: '关闭页面', badge: 'bg-gray-100 text-gray-500',
    desc: '导航到空白页（懒关闭），释放 Chrome 槽位',
    fields: [] },

  // ─── 元素交互 ───────────────────────────────────────────────────────────────
  click: {
    label: '点击元素', badge: 'bg-purple-50 text-purple-600',
    desc: '模拟人类鼠标点击：检查可用性 → 贝塞尔移动 → 点击',
    fields: [
      { key: 'selector', label: '选择器 / getBy*', type: 'text',   placeholder: "#btn 或 getByText('提交')" },
      { key: 'timeout',  label: '等待超时(ms)',     type: 'number', default: 5000 },
      ON_FAIL_FIELD,
    ]},
  dblclick: {
    label: '双击元素', badge: 'bg-purple-50 text-purple-600',
    desc: '模拟人类双击操作',
    fields: [
      { key: 'selector', label: '选择器 / getBy*', type: 'text' },
      { key: 'timeout',  label: '等待超时(ms)',     type: 'number', default: 5000 },
      ON_FAIL_FIELD,
    ]},
  hover: {
    label: '悬停元素', badge: 'bg-indigo-50 text-indigo-600',
    desc: '将鼠标移到元素上方并停留',
    fields: [
      { key: 'selector', label: '选择器 / getBy*', type: 'text' },
      { key: 'timeout',  label: '等待超时(ms)',     type: 'number', default: 5000 },
      ON_FAIL_FIELD,
    ]},
  fill: {
    label: '填写输入框', badge: 'bg-pink-50 text-pink-600',
    desc: '向输入框填写内容，支持直接赋值或逐字模拟键盘',
    fields: [
      { key: 'selector', label: '选择器 / getBy*', type: 'text',   placeholder: "#input 或 getByPlaceholder('...')" },
      { key: 'value',    label: '填写内容',         type: 'text',   placeholder: '输入文字' },
      { key: 'mode',     label: '填写方式',         type: 'select', options: ['fill','type'], default: 'fill' },
      { key: 'delay',    label: '键入间隔(ms)',      type: 'number', default: 50 },
      ON_FAIL_FIELD,
    ]},
  scroll: {
    label: '滚动页面', badge: 'bg-cyan-50 text-cyan-600',
    desc: '滚动整个页面或指定容器元素',
    fields: [
      { key: 'y',        label: '垂直距离(px)', type: 'number', default: 300 },
      { key: 'selector', label: '目标容器',     type: 'text',   placeholder: '可选，不填则滚动整页' },
    ]},
  mousemove: {
    label: '移动鼠标', badge: 'bg-gray-100 text-gray-600',
    desc: '将鼠标移动到页面绝对坐标',
    fields: [
      { key: 'x', label: 'X 坐标', type: 'number', default: 0 },
      { key: 'y', label: 'Y 坐标', type: 'number', default: 0 },
    ]},

  // ─── 等待 / 监听 ────────────────────────────────────────────────────────────
  'wait-for': {
    label: '等待元素', badge: 'bg-cyan-50 text-cyan-600',
    desc: '等待指定元素出现并可见，超时可选择中止任务',
    fields: [
      { key: 'selector',      label: '选择器 / getBy*', type: 'text',     placeholder: "getByText('加载完成') 或 .modal" },
      { key: 'timeout',       label: '超时(ms)',         type: 'number',   default: 10000 },
      { key: 'stopOnTimeout', label: '超时中止任务',     type: 'checkbox', default: false },
      ON_FAIL_FIELD,
    ]},
  'hover-capture': {
    label: '悬停触发请求', badge: 'bg-indigo-50 text-indigo-600',
    desc: '悬停到元素上等待 duration 毫秒后移走，常用于触发懒加载或弹窗',
    fields: [
      { key: 'selector', label: '目标元素',     type: 'text',   placeholder: "getByText('推荐') 或 .card" },
      { key: 'duration', label: '悬停时长(ms)', type: 'number', default: 1000 },
      { key: 'exit_x',   label: '移走坐标 X',  type: 'number', default: 0 },
      { key: 'exit_y',   label: '移走坐标 Y',  type: 'number', default: 0 },
      ON_FAIL_FIELD,
    ]},
  intercept: {
    label: '拦截网络数据', badge: 'bg-red-50 text-red-600',
    desc: '监听匹配的请求或响应并上报数据，不阻断请求（零延迟开销）',
    fields: [
      { key: 'url',   label: 'URL 关键词', type: 'text',   placeholder: '/api/recommend' },
      { key: 'direction', label: '监听方向', type: 'select', options: ['response','request'], default: 'response' },
      { key: 'times', label: '捕获次数',   type: 'number', default: 1 },
      { key: 'pick',  label: '字段提取',   type: 'text',   placeholder: 'data.list 或留空上报全量' },
    ]},

  // ─── 数据采集 ───────────────────────────────────────────────────────────────
  screenshot: {
    label: '截图上报', badge: 'bg-sky-50 text-sky-600',
    desc: '通过 CDP 截取当前帧 JPEG 并上传到 gateway',
    fields: [
      { key: 'quality',  label: '画质(20-90)', type: 'number',   default: 60 },
      { key: 'fullPage', label: '截取全页',     type: 'checkbox', default: false },
    ]},

  // ─── 反检测 / 媒体 ──────────────────────────────────────────────────────────
  antidetect: {
    label: '防检测 & 静音', badge: 'bg-teal-50 text-teal-600',
    desc: '注入可见性欺骗脚本 + 人类活动模拟，视频自动静音',
    fields: [] },
  'pause-video': {
    label: '暂停视频', badge: 'bg-teal-50 text-teal-600',
    desc: '暂停页面上匹配的 <video> 元素',
    fields: [
      { key: 'selector', label: 'CSS 选择器', type: 'text',     placeholder: 'video', default: 'video' },
      { key: 'all',      label: '匹配全部',   type: 'checkbox', default: false },
    ]},
  'mute-video': {
    label: '视频静音', badge: 'bg-teal-50 text-teal-600',
    desc: '对页面上匹配的 <video> 元素设置静音状态',
    fields: [
      { key: 'selector', label: 'CSS 选择器', type: 'text',     placeholder: 'video', default: 'video' },
      { key: 'mute',     label: '静音',       type: 'checkbox', default: true },
      { key: 'all',      label: '匹配全部',   type: 'checkbox', default: false },
    ]},

  press: {
    label: '键盘按键', badge: 'bg-purple-50 text-purple-600',
    desc: '按下键盘按键，可聚焦到指定元素后再按',
    fields: [
      { key: 'key',      label: '按键',             type: 'text', placeholder: 'Enter / Tab / Escape / Control+a' },
      { key: 'selector', label: '选择器（可选）',    type: 'text', placeholder: '留空则全局按键' },
    ]},

  // ─── 脚本执行 ───────────────────────────────────────────────────────────────
  eval: {
    label: '执行页面 JS', badge: 'bg-gray-100 text-gray-600',
    desc: '在浏览器上下文执行 JS 表达式，结果写入日志',
    fields: [{ key: 'code', label: 'JS 表达式', type: 'textarea', placeholder: "() => document.title" }] },
  'run-code': {
    label: '执行 PW 脚本', badge: 'bg-gray-100 text-gray-600',
    desc: '在 Node.js 侧执行 Playwright 脚本，可访问 page/context/ctrl',
    fields: [{ key: 'code', label: 'PW 脚本', type: 'textarea', placeholder: "async ({ page, context, ctrl }) => { await page.click('button'); }" }] },
};

function stepDef(type) {
  return STEP_DEFS[type] ?? { label: type, badge: 'bg-gray-100 text-gray-600', fields: [] };
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
