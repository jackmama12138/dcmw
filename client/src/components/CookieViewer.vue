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
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs text-gray-500">共 {{ cookies.length }} 条</span>
          <div class="flex gap-3">
            <button @click="copyAll('cookie')" class="text-xs text-indigo-400 hover:text-indigo-300">复制全部 Cookie</button>
            <button @click="copyAll('json')" class="text-xs text-indigo-400 hover:text-indigo-300">复制 JSON</button>
          </div>
        </div>

        <div class="space-y-3 max-h-[600px] overflow-y-auto pr-1">
          <div v-for="(c, i) in cookies" :key="i"
            class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-xs space-y-2">

            <!-- header row -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="font-mono text-indigo-300 font-medium">{{ c.profile }}</span>
                <span class="text-gray-600">{{ formatTime(c.timestamp) }}</span>
              </div>
              <button @click="copyRecord(c)" class="text-gray-500 hover:text-gray-300 transition-colors">复制</button>
            </div>

            <!-- matched url -->
            <div class="text-gray-600 truncate" :title="c.matched_url">{{ c.matched_url }}</div>

            <!-- device_id / user_unique_id -->
            <div class="grid grid-cols-2 gap-2">
              <div class="bg-gray-900 rounded-lg px-3 py-2">
                <div class="text-gray-600 mb-0.5">device_id</div>
                <div v-if="c.device_id" class="font-mono text-yellow-300 break-all select-all">{{ c.device_id }}</div>
                <div v-else class="text-gray-700 italic">—</div>
              </div>
              <div class="bg-gray-900 rounded-lg px-3 py-2">
                <div class="text-gray-600 mb-0.5">user_unique_id</div>
                <div v-if="c.user_unique_id" class="font-mono text-green-300 break-all select-all">{{ c.user_unique_id }}</div>
                <div v-else class="text-gray-700 italic">—</div>
              </div>
            </div>

            <!-- user-agent -->
            <div v-if="c.user_agent" class="bg-gray-900 rounded-lg px-3 py-2">
              <div class="text-gray-600 mb-0.5">User-Agent</div>
              <div class="text-gray-400 break-all">{{ c.user_agent }}</div>
            </div>

            <!-- cookie -->
            <div class="bg-gray-900 rounded-lg px-3 py-2">
              <div class="flex items-center justify-between mb-0.5">
                <span class="text-gray-600">Cookie</span>
                <button @click="copy(c.cookie)" class="text-gray-600 hover:text-gray-300 transition-colors">复制</button>
              </div>
              <div class="font-mono text-gray-400 break-all select-all"
                :class="expanded.has(i) ? '' : 'line-clamp-2 cursor-pointer'"
                @click="toggle(i)">{{ c.cookie }}</div>
              <button v-if="!expanded.has(i)" @click="toggle(i)" class="text-indigo-500 hover:text-indigo-400 mt-1">展开</button>
              <button v-else @click="toggle(i)" class="text-gray-600 hover:text-gray-400 mt-1">收起</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { fetchCookies } from '../api.js';

const props = defineProps({ initialTaskId: { type: String, default: '' } });

const taskId = ref(props.initialTaskId);
const cookies = ref([]);
const loading = ref(false);
const loaded = ref(false);
const expanded = reactive(new Set());

async function load() {
  if (!taskId.value) return;
  loading.value = true;
  expanded.clear();
  try {
    cookies.value = await fetchCookies(taskId.value);
    loaded.value = true;
  } catch {
    cookies.value = [];
  } finally {
    loading.value = false;
  }
}

function toggle(i) {
  expanded.has(i) ? expanded.delete(i) : expanded.add(i);
}

function copy(text) {
  navigator.clipboard.writeText(text || '').catch(() => {});
}

function copyRecord(c) {
  const text = [
    `profile: ${c.profile}`,
    `device_id: ${c.device_id || ''}`,
    `user_unique_id: ${c.user_unique_id || ''}`,
    `user_agent: ${c.user_agent || ''}`,
    `cookie: ${c.cookie}`,
  ].join('\n');
  navigator.clipboard.writeText(text).catch(() => {});
}

function copyAll(format) {
  let text;
  if (format === 'json') {
    text = JSON.stringify(cookies.value, null, 2);
  } else {
    text = cookies.value.map(c =>
      `${c.profile}\t${c.device_id || ''}\t${c.user_unique_id || ''}\t${c.cookie}`
    ).join('\n');
  }
  navigator.clipboard.writeText(text).catch(() => {});
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString();
}
</script>
