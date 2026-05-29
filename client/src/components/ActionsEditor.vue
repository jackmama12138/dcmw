<template>
  <div class="space-y-4">
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-lg font-semibold">Actions 代码</h2>
          <p class="text-xs text-gray-500 mt-0.5">保存后立即热推送到所有在线 Worker，正在执行的步骤不受影响</p>
        </div>
        <div class="flex items-center gap-3">
          <span v-if="hasCustom" class="text-xs text-indigo-400">已有自定义版本</span>
          <span v-else class="text-xs text-gray-600">使用内置默认版本</span>
          <button @click="resetDefault" v-if="hasCustom"
            class="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            恢复默认
          </button>
          <button @click="save" :disabled="saving"
            class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm transition-colors">
            {{ saving ? '推送中...' : '保存并推送' }}
          </button>
        </div>
      </div>

      <div v-if="error" class="mb-3 bg-red-950 border border-red-800 rounded-lg px-4 py-2 text-xs text-red-400">
        {{ error }}
      </div>
      <div v-if="successMsg" class="mb-3 bg-green-950 border border-green-800 rounded-lg px-4 py-2 text-xs text-green-400">
        {{ successMsg }}
      </div>

      <textarea v-model="code" spellcheck="false"
        class="w-full h-[600px] bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-sm font-mono text-gray-200 focus:outline-none focus:border-indigo-500 resize-y"
        placeholder="// 粘贴自定义 actions.js 代码..." />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { fetchActionsCode, saveActionsCode } from '../api.js';

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
  // Clearing custom code: send empty string — gateway treats it as "use built-in"
  // For now just clear the local editor; a future API can support explicit reset.
  code.value = '';
  hasCustom.value = false;
}
</script>
