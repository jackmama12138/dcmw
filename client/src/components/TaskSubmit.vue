<template>
  <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
    <div class="px-5 py-3 border-b border-gray-800">
      <h2 class="text-sm font-semibold">发布任务</h2>
      <p class="text-xs text-gray-600 mt-0.5">选择模板或自定义 Pipeline，指定目标 URL 和节点数量后提交</p>
    </div>
    <div class="p-5">

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- target_url -->
      <div class="md:col-span-2">
        <label class="block text-xs text-gray-400 mb-1">目标 URL</label>
        <input v-model="form.target_url" type="text" placeholder="https://live.douyin.com/..."
          class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
      </div>

      <!-- task_type -->
      <div>
        <label class="block text-xs text-gray-400 mb-1">任务类型</label>
        <div class="flex gap-2">
          <select v-if="templates.length" v-model="form.task_type"
            class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500">
            <option value="">— 自定义 Pipeline —</option>
            <option v-for="t in templates" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
          <input v-else v-model="form.task_type" placeholder="AFK"
            class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
        </div>
      </div>

      <!-- count -->
      <div>
        <label class="block text-xs text-gray-400 mb-1">数量 (count)</label>
        <div class="flex gap-2">
          <input v-model.number="form.count" type="number" min="1"
            class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          <button v-if="form.target_worker_id" @click="fillAllSlots"
            class="bg-gray-700 hover:bg-gray-600 text-xs px-3 rounded-lg transition-colors whitespace-nowrap">
            全部节点
          </button>
        </div>
      </div>

      <!-- task_time -->
      <div>
        <label class="block text-xs text-gray-400 mb-1">持续时间 (秒)</label>
        <input v-model.number="form.task_time" type="number" min="1"
          class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
      </div>

      <!-- target worker -->
      <div>
        <label class="block text-xs text-gray-400 mb-1">指定 Worker（可选）</label>
        <select v-model="form.target_worker_id"
          class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500">
          <option value="">全部 Worker</option>
          <option v-for="w in workers" :key="w.workerId" :value="w.workerId">
            {{ w.workerId }} ({{ w.slots.idle }} idle)
          </option>
        </select>
      </div>

      <!-- target node (only when worker selected) -->
      <div v-if="form.target_worker_id">
        <label class="block text-xs text-gray-400 mb-1">指定 Profile（可选）</label>
        <select v-model="form.target_profile"
          class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500">
          <option value="">全部 Profile</option>
          <option v-for="p in selectedWorkerProfiles" :key="p.profileName" :value="p.profileName">
            {{ p.profileName }} ({{ p.state }})
          </option>
        </select>
      </div>

      <!-- custom pipeline (only when no task_type) -->
      <div v-if="!form.task_type" class="md:col-span-2">
        <label class="block text-xs text-gray-400 mb-1">Pipeline (JSON)</label>
        <textarea v-model="form.pipelineJson" rows="5"
          placeholder='[{"type":"navigate","url":"https://..."},{"type":"dwell"}]'
          class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
      </div>
    </div>

    <div class="mt-5 flex items-center gap-3">
      <button @click="submit" :disabled="submitting"
        class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2 rounded-lg text-sm font-medium transition-colors">
        {{ submitting ? '提交中…' : '发布任务' }}
      </button>
      <span v-if="msg" :class="isError ? 'text-red-400' : 'text-emerald-400'" class="text-sm">{{ msg }}</span>
    </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { submitTask, fetchTemplates } from '../api.js';

const props = defineProps({ workers: { type: Array, default: () => [] } });
const emit = defineEmits(['submitted']);

const templates = ref([]);
const submitting = ref(false);
const msg = ref('');
const isError = ref(false);

const form = ref({
  target_url: '',
  task_type: '',
  count: 50,
  task_time: 3600,
  target_worker_id: '',
  target_profile: '',
  pipelineJson: JSON.stringify([
    { type: 'navigate', url: 'https://', waitUntil: 'commit' },
    { type: 'dwell' },
  ], null, 2),
});

const selectedWorkerProfiles = computed(() => {
  const w = props.workers.find(w => w.workerId === form.value.target_worker_id);
  return w?.profiles ?? [];
});

function fillAllSlots() {
  const w = props.workers.find(w => w.workerId === form.value.target_worker_id);
  if (w) form.value.count = w.slots.total;
}

async function submit() {
  msg.value = '';
  isError.value = false;
  if (!form.value.target_url) { msg.value = '请填写目标 URL'; isError.value = true; return; }

  const payload = {
    target_url: form.value.target_url,
    count: form.value.count,
    task_time: form.value.task_time,
  };

  if (form.value.task_type) {
    payload.task_type = form.value.task_type;
  } else {
    try {
      payload.pipeline = JSON.parse(form.value.pipelineJson);
    } catch {
      msg.value = 'Pipeline JSON 格式错误';
      isError.value = true;
      return;
    }
  }

  if (form.value.target_worker_id) {
    if (form.value.target_profile) {
      payload.target_node = { worker_id: form.value.target_worker_id, profile: form.value.target_profile };
    } else {
      payload.target_worker_id = form.value.target_worker_id;
    }
  }

  submitting.value = true;
  try {
    await submitTask(payload);
    msg.value = '任务已发布';
    emit('submitted');
  } catch (err) {
    const data = err.response?.data;
    if (data?.available !== undefined) {
      msg.value = `${data.error}，可将 count 调整为 ${data.available}`;
    } else {
      msg.value = data?.error ?? err.message;
    }
    isError.value = true;
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  templates.value = await fetchTemplates().catch(() => []);
});
</script>
