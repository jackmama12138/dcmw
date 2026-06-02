<template>
  <a-card :bordered="true" :body-style="{ padding: '20px' }">
    <template #title>
      <div>
        <span class="ae__title">Actions 代码</span>
        <p class="ae__desc">保存后热推送到所有在线 Worker，正在执行的步骤不受影响</p>
      </div>
    </template>
    <template #extra>
      <a-space :size="12" align="center">
        <a-tag v-if="hasCustom" color="blue">自定义版本</a-tag>
        <span v-else class="ae__meta">内置默认版本</span>
        <a-button v-if="hasCustom" size="small" @click="resetDefault">恢复默认</a-button>
        <a-button type="primary" :loading="saving" @click="save">
          {{ saving ? '推送中…' : '保存并推送' }}
        </a-button>
      </a-space>
    </template>

    <a-alert v-if="error" type="error" class="ae__alert">{{ error }}</a-alert>
    <a-alert v-if="successMsg" type="success" class="ae__alert">{{ successMsg }}</a-alert>

    <a-textarea v-model="code" :spellcheck="false"
      placeholder="// 粘贴自定义 actions.js 代码..."
      class="mono ae__code" :auto-size="false" />
  </a-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { fetchActionsCode, saveActionsCode, resetActionsCode } from '../api.js';
import { Modal } from '@arco-design/web-vue';

const code = ref('');
const hasCustom = ref(false);
const saving = ref(false);
const error = ref('');
const successMsg = ref('');

onMounted(load);

async function load() {
  try {
    const res = await fetchActionsCode();
    hasCustom.value = res.has_custom;
    code.value = res.code ?? '';
  } catch {}
}

async function save() {
  if (!code.value.trim()) { error.value = '代码不能为空'; return; }
  saving.value = true;
  error.value = '';
  successMsg.value = '';
  try {
    const res = await saveActionsCode(code.value);
    hasCustom.value = true;
    successMsg.value = `已推送到 ${res.notified} 个 Worker`;
    setTimeout(() => { successMsg.value = ''; }, 3000);
  } catch (err) {
    error.value = err.response?.data?.error ?? err.message;
  } finally {
    saving.value = false;
  }
}

function resetDefault() {
  Modal.confirm({
    title: '恢复默认',
    content: '恢复默认 actions 代码？所有 Worker 将重新加载内置版本。',
    okText: '确认恢复',
    cancelText: '取消',
    onOk: async () => {
      try {
        const res = await resetActionsCode();
        code.value = '';
        hasCustom.value = false;
        successMsg.value = `已恢复内置版本，已通知 ${res.notified} 个 Worker`;
        setTimeout(() => { successMsg.value = ''; }, 3000);
      } catch (err) {
        error.value = err.response?.data?.error ?? err.message;
      }
    },
  });
}
</script>

<style scoped>
.ae__title { font-size: 14px; font-weight: 600; }
.ae__desc  { font-size: 12px; color: var(--tx-3); margin-top: 2px; }
.ae__meta  { font-size: 12px; color: var(--tx-3); }
.ae__alert { margin-bottom: 12px; }
.ae__code  { height: 600px; }
.ae__code :deep(.arco-textarea) { height: 600px; resize: vertical; font-size: 13px; }
</style>
