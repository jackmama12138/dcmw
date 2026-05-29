<template>
  <div class="bg-gray-900 rounded-xl p-5 border border-gray-800">
    <h2 class="text-lg font-semibold mb-4">截图查看</h2>

    <div class="flex gap-2 mb-4">
      <input v-model="taskId" placeholder="输入 task_id 查询"
        class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
      <button @click="load" :disabled="loading"
        class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm transition-colors">
        {{ loading ? '查询中...' : '查询' }}
      </button>
    </div>

    <div v-if="loaded">
      <div v-if="!shots.length" class="text-sm text-gray-500 text-center py-6">暂无截图</div>
      <div v-else>
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs text-gray-500">共 {{ shots.length }} 张，按 profile 分组</span>
          <div class="flex items-center gap-2">
            <label class="text-xs text-gray-500">仅显示</label>
            <select v-model="filterProfile"
              class="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs focus:outline-none">
              <option value="">全部</option>
              <option v-for="p in profiles" :key="p" :value="p">{{ p }}</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div v-for="(s, i) in filtered" :key="i"
            class="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden cursor-pointer group"
            @click="preview = s">
            <img :src="baseUrl + s.url" class="w-full h-32 object-cover group-hover:opacity-90 transition-opacity" loading="lazy" />
            <div class="px-2 py-1.5 text-xs">
              <div class="text-indigo-300 font-mono truncate">{{ s.profile }}</div>
              <div class="text-gray-600">{{ formatTime(s.timestamp) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- lightbox -->
    <div v-if="preview" class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      @click.self="preview = null">
      <div class="relative max-w-4xl w-full">
        <button @click="preview = null"
          class="absolute -top-8 right-0 text-gray-400 hover:text-white text-sm">✕ 关闭</button>
        <img :src="baseUrl + preview.url" class="w-full rounded-lg shadow-2xl" />
        <div class="mt-2 text-xs text-gray-400 text-center">
          {{ preview.profile }} · {{ formatTime(preview.timestamp) }}
          <a :href="baseUrl + preview.url" target="_blank"
            class="ml-3 text-indigo-400 hover:text-indigo-300">在新标签打开</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { fetchScreenshots } from '../api.js';

const props = defineProps({ initialTaskId: { type: String, default: '' } });

const BASE_URL = import.meta.env.VITE_SERVER_PUBLISH_URL ?? 'http://192.168.110.111:7777';
const baseUrl = BASE_URL;

const taskId = ref(props.initialTaskId);
const shots = ref([]);
const loading = ref(false);
const loaded = ref(false);
const preview = ref(null);
const filterProfile = ref('');

const profiles = computed(() => [...new Set(shots.value.map(s => s.profile))].sort());
const filtered = computed(() =>
  filterProfile.value ? shots.value.filter(s => s.profile === filterProfile.value) : shots.value
);

async function load() {
  if (!taskId.value) return;
  loading.value = true;
  try {
    shots.value = await fetchScreenshots(taskId.value);
    loaded.value = true;
  } catch {
    shots.value = [];
  } finally {
    loading.value = false;
  }
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}
</script>
