<template>
  <div class="pe">
    <draggable v-model="localSteps" item-key="_id" handle=".drag-handle" ghost-class="pe__ghost" animation="150">
      <template #item="{ element, index }">
        <a-card class="pe__step" size="small" :bordered="true" :body-style="{ padding: '12px' }">
          <div class="pe__step-row">
            <div class="drag-handle pe__handle">⠿</div>
            <div class="pe__index">{{ index + 1 }}</div>

            <div class="pe__body">
              <a-space :size="8" align="center" class="pe__head">
                <a-tag :color="badgeColor(element.type)" :title="stepDef(element.type).desc ?? ''">
                  {{ stepDef(element.type).label }}
                </a-tag>
                <a-select
                  :model-value="element.type"
                  size="small"
                  class="pe__type-select"
                  @change="val => changeType(index, val)">
                  <a-option v-for="(def, key) in STEP_DEFS" :key="key" :value="key">{{ def.label }}</a-option>
                </a-select>
              </a-space>

              <a-space v-if="stepDef(element.type).fields.length" wrap :size="[12, 8]" align="end" class="pe__fields">
                <div v-for="field in stepDef(element.type).fields" :key="field.key"
                  :class="fieldWrapClass(field.type)">
                  <!-- checkbox -->
                  <template v-if="field.type === 'checkbox'">
                    <a-checkbox
                      :model-value="element[field.key] ?? field.default ?? false"
                      @change="val => updateField(index, field.key, val)">
                      {{ field.label }}
                    </a-checkbox>
                  </template>
                  <!-- textarea -->
                  <template v-else-if="field.type === 'textarea'">
                    <div class="pe__field-label">{{ field.label }}</div>
                    <a-textarea
                      :model-value="element[field.key] ?? ''"
                      :placeholder="field.placeholder ?? ''"
                      :auto-size="{ minRows: 3, maxRows: 8 }"
                      class="mono"
                      @input="val => updateField(index, field.key, val)" />
                  </template>
                  <!-- select -->
                  <template v-else-if="field.type === 'select'">
                    <div class="pe__field-label">{{ field.label }}</div>
                    <a-select
                      :model-value="element[field.key] ?? field.default ?? field.options[0]"
                      size="small"
                      class="pe__field-select"
                      @change="val => updateField(index, field.key, val)">
                      <a-option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</a-option>
                    </a-select>
                  </template>
                  <!-- number -->
                  <template v-else-if="field.type === 'number'">
                    <div class="pe__field-label">{{ field.label }}</div>
                    <a-input-number
                      :model-value="element[field.key] ?? field.default ?? 0"
                      size="small"
                      @change="val => updateField(index, field.key, Number(val))" />
                  </template>
                  <!-- text (default) -->
                  <template v-else>
                    <div class="pe__field-label">{{ field.label }}</div>
                    <a-input
                      :model-value="element[field.key] ?? field.default ?? ''"
                      :placeholder="field.placeholder ?? ''"
                      size="small"
                      @input="val => updateField(index, field.key, val)" />
                  </template>
                </div>
              </a-space>
              <div v-else class="pe__no-field">无参数</div>
            </div>

            <a-button type="text" status="danger" size="mini" class="pe__remove" @click="removeStep(index)">
              <template #icon><icon-close /></template>
            </a-button>
          </div>
        </a-card>
      </template>
    </draggable>

    <a-space :size="8" align="center" class="pe__add">
      <a-select v-model="newType" size="small" class="pe__add-select">
        <a-option v-for="(def, key) in STEP_DEFS" :key="key" :value="key">{{ def.label }}</a-option>
      </a-select>
      <a-button size="small" @click="addStep">
        <template #icon><icon-plus /></template>添加步骤
      </a-button>
    </a-space>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue';
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

// 从 gateway 拉取插件 schemas，动态合并进 STEP_DEFS
onMounted(async () => {
  try {
    const res = await fetch('/api/schemas');
    if (!res.ok) return;
    const schemas = await res.json();
    for (const [type, def] of Object.entries(schemas)) {
      if (!STEP_DEFS[type]) STEP_DEFS[type] = def;
    }
  } catch {}
});

// pipeline 步骤定义，与 gateway VALID_ACTION_TYPES 和 worker actions.js 保持同步
// 新增动作时三处同步更新：gateway/src/router.js、worker/src/actions.js、此处
//
// on_fail 字段说明（适用于可能失败的交互动作）：
//   continue — 默认，失败后继续执行下一步
//   stop     — 以成功状态结束任务（预期中止，如检测到未登录则不继续）
//   error    — 以错误状态结束任务（意外失败需标记）

const ON_FAIL_FIELD = { key: 'on_fail', label: '失败行为', type: 'select', options: ['continue','stop','error'], default: 'continue' };

const STEP_DEFS = reactive({
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
});

function stepDef(type) {
  return STEP_DEFS[type] ?? { label: type, badge: 'bg-gray-100 text-gray-600', fields: [] };
}

// 将原 Tailwind badge 类映射为 Arco a-tag 颜色
const HUE_TO_ARCO = {
  blue: 'blue', orange: 'orange', yellow: 'gold', green: 'green', gray: 'gray',
  purple: 'purple', indigo: 'arcoblue', pink: 'pinkpurple', cyan: 'cyan',
  red: 'red', sky: 'arcoblue', teal: 'cyan',
};
function badgeColor(type) {
  const m = (stepDef(type).badge || '').match(/text-(\w+)-/);
  return HUE_TO_ARCO[m?.[1]] ?? 'gray';
}

function fieldWrapClass(type) {
  return {
    textarea: 'pe__field pe__field--full',
    checkbox: 'pe__field pe__field--checkbox',
    number:   'pe__field pe__field--number',
    select:   'pe__field pe__field--select',
  }[type] ?? 'pe__field pe__field--text';
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

<style scoped>
.pe { display: flex; flex-direction: column; gap: 8px; }
.pe__ghost { opacity: 0.4; }
.pe__step { background: var(--bg-card); transition: box-shadow 0.15s; }
.pe__step:hover { box-shadow: var(--shadow-card); }
.pe__step-row { display: flex; align-items: flex-start; gap: 8px; }
.pe__handle {
  margin-top: 2px;
  cursor: grab;
  color: var(--tx-4);
  user-select: none;
  font-size: 18px;
  line-height: 1;
}
.pe__handle:hover { color: var(--tx-2); }
.pe__handle:active { cursor: grabbing; }
.pe__index { font-size: var(--fs-xs); color: var(--tx-4); margin-top: 5px; width: 16px; text-align: right; flex-shrink: 0; }
.pe__body { flex: 1; min-width: 0; }
.pe__head { margin-bottom: 8px; }
.pe__type-select { width: 130px; }
.pe__no-field { font-size: var(--fs-xs); color: var(--tx-4); font-style: italic; }

.pe__fields { width: 100%; }
.pe__field-label { font-size: var(--fs-xs); color: var(--tx-3); margin-bottom: 2px; }
.pe__field--full     { width: 100%; }
.pe__field--checkbox { display: flex; align-items: center; padding-bottom: 2px; flex-shrink: 0; }
.pe__field--number   { flex-shrink: 0; width: 120px; }
.pe__field--select   { flex-shrink: 0; }
.pe__field--text     { flex: 1; min-width: 160px; }
.pe__field-select    { width: 140px; }

.pe__remove { margin-top: 2px; flex-shrink: 0; }
.pe__add { margin-top: 4px; }
.pe__add-select { width: 140px; }
</style>
