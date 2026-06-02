<template>
  <a-card :bordered="true" :body-style="{ padding: '20px' }">
    <template #title><span class="ts__title">发布任务</span></template>
    <template #extra><span class="ts__desc">选择模板或自定义 Pipeline，指定目标 URL 和节点数量后提交</span></template>

    <a-form :model="form" layout="vertical">
      <a-row :gutter="16">
        <a-col :span="24">
          <a-form-item label="目标 URL">
            <a-input v-model="form.target_url" placeholder="https://live.douyin.com/..." allow-clear />
          </a-form-item>
        </a-col>

        <a-col :span="12">
          <a-form-item label="任务类型">
            <a-select v-if="templates.length" v-model="form.task_type" placeholder="— 自定义 Pipeline —" allow-clear>
              <a-option value="">— 自定义 Pipeline —</a-option>
              <a-option v-for="t in templates" :key="t.name" :value="t.name">{{ t.name }}</a-option>
            </a-select>
            <a-input v-else v-model="form.task_type" placeholder="AFK" />
          </a-form-item>
        </a-col>

        <a-col :span="12">
          <a-form-item label="数量 (count)">
            <a-space :size="8" fill>
              <a-input-number v-model="form.count" :min="1" class="ts__count" />
              <a-button v-if="form.target_worker_id" @click="fillAllSlots">全部节点</a-button>
            </a-space>
          </a-form-item>
        </a-col>

        <a-col :span="12">
          <a-form-item label="持续时间 (秒)">
            <a-input-number v-model="form.task_time" :min="1" />
          </a-form-item>
        </a-col>

        <a-col :span="12">
          <a-form-item label="指定 Worker（可选）">
            <a-select v-model="form.target_worker_id" placeholder="全部 Worker" allow-clear>
              <a-option value="">全部 Worker</a-option>
              <a-option v-for="w in workers" :key="w.workerId" :value="w.workerId">
                {{ w.workerId }} ({{ w.slots.idle }} idle)
              </a-option>
            </a-select>
          </a-form-item>
        </a-col>

        <a-col v-if="form.target_worker_id" :span="12">
          <a-form-item label="指定 Profile（可选）">
            <a-select v-model="form.target_profile" placeholder="全部 Profile" allow-clear>
              <a-option value="">全部 Profile</a-option>
              <a-option v-for="p in selectedWorkerProfiles" :key="p.profileName" :value="p.profileName">
                {{ p.profileName }} ({{ p.state }})
              </a-option>
            </a-select>
          </a-form-item>
        </a-col>

        <a-col v-if="!form.task_type" :span="24">
          <a-form-item label="Pipeline (JSON)">
            <a-textarea v-model="form.pipelineJson" :auto-size="{ minRows: 5, maxRows: 12 }"
              placeholder='[{"type":"navigate","url":"https://..."},{"type":"dwell"}]' class="mono" />
          </a-form-item>
        </a-col>
      </a-row>

      <a-space :size="12" align="center">
        <a-button type="primary" :loading="submitting" @click="submit">
          {{ submitting ? '提交中…' : '发布任务' }}
        </a-button>
        <span v-if="msg" :class="isError ? 'ts__msg-err' : 'ts__msg-ok'">{{ msg }}</span>
      </a-space>
    </a-form>
  </a-card>
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

<style scoped>
.ts__title { font-size: 14px; font-weight: 600; }
.ts__desc  { font-size: 12px; color: var(--tx-3); }
.ts__count { width: 100%; }
.ts__msg-err { font-size: 14px; color: var(--danger); }
.ts__msg-ok  { font-size: 14px; color: var(--success); }
</style>
