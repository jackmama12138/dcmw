<template>
  <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
    <h2 class="text-lg font-semibold mb-4">Cookie 采集</h2>

    <div class="flex gap-2 mb-4">
      <input v-model="taskId" placeholder="输入 task_id 查询"
        class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
      <button @click="load" :disabled="loading"
        class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm transition-colors">
        {{ loading ? '查询中...' : '查询' }}
      </button>
    </div>

    <div v-if="taskId && loaded">
      <div v-if="!cookies.length" class="text-sm text-gray-500 text-center py-6">暂无采集记录</div>
      <div v-else>
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs text-gray-500">共 {{ cookies.length }} 条</span>
          <button @click="copyAll" class="text-xs text-indigo-400 hover:text-indigo-300">复制全部</button>
        </div>
        <div class="space-y-2 max-h-96 overflow-y-auto">
          <div v-for="(c, i) in cookies" :key="i"
            class="bg-gray-800 border border-gray-700 rounded-lg p-3">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-mono text-indigo-300">{{ c.profile }}</span>
                <span class="text-xs text-gray-600">{{ formatTime(c.timestamp) }}</span>
              </div>
              <div class="flex gap-2">
                <span class="text-xs text-gray-600 truncate max-w-xs">{{ c.matched_url }}</span>
                <button @click="copy(c.cookie)" class="text-xs text-gray-500 hover:text-gray-300 flex-shrink-0">复制</button>
              </div>
            </div>
            <div class="text-xs font-mono text-gray-400 break-all line-clamp-2 hover:line-clamp-none cursor-pointer">{{ c.cookie }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { fetchCookies } from '../api.js';

const props = defineProps({ initialTaskId: { type: String, default: '' } });

const taskId = ref(props.initialTaskId);
const cookies = ref([]);
const loading = ref(false);
const loaded = ref(false);

async function load() {
  if (!taskId.value) return;
  loading.value = true;
  try {
    cookies.value = await fetchCookies(taskId.value);
    loaded.value = true;
  } catch {
    cookies.value = [];
  } finally {
    loading.value = false;
  }
}

function copy(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function copyAll() {
  const text = cookies.value.map(c => `${c.profile}\t${c.cookie}`).join('\n');
  navigator.clipboard.writeText(text).catch(() => {});
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString();
}
</script>
