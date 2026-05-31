<template>
  <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <div class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
      <div>
        <h2 class="text-sm font-semibold">Actions 代码</h2>
        <p class="text-xs text-gray-600 mt-0.5">保存后热推送到所有在线 Worker，正在执行的步骤不受影响</p>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="hasCustom" class="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">自定义版本</span>
        <span v-else class="text-xs text-gray-600">内置默认版本</span>
        <button @click="resetDefault" v-if="hasCustom"
          class="text-xs text-gray-500 hover:text-gray-800 transition-colors border border-gray-200 rounded-lg px-2.5 py-1">
          恢复默认
        </button>
        <button @click="save" :disabled="saving"
          class="bg-primary hover:bg-primary-hover text-white disabled:opacity-50 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
          {{ saving ? '推送中…' : '保存并推送' }}
        </button>
      </div>
    </div>
    <div class="p-5">

      <div v-if="error" class="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-xs text-red-500">
        {{ error }}
      </div>
      <div v-if="successMsg" class="mb-3 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-xs text-green-600">
        {{ successMsg }}
      </div>

      <textarea v-model="code" spellcheck="false"
        class="w-full h-[600px] bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm font-mono text-gray-800 focus:outline-none focus:border-blue-400 resize-y"
        placeholder="// 粘贴自定义 actions.js 代码..." />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { fetchActionsCode, saveActionsCode, resetActionsCode } from '../api.js';

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

async function resetDefault() {
  if (!confirm('恢复默认 actions 代码？所有 Worker 将重新加载内置版本。')) return;
  try {
    const res = await resetActionsCode();
    code.value = '';
    hasCustom.value = false;
    successMsg.value = `已恢复内置版本，已通知 ${res.notified} 个 Worker`;
    setTimeout(() => { successMsg.value = ''; }, 3000);
  } catch (err) {
    error.value = err.response?.data?.error ?? err.message;
  }
}
</script>
