import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { vitePluginForArco } from '@arco-plugins/vite-vue';

export default defineConfig({
  plugins: [
    vue(),
    // 按需引入 Arco 组件与样式（自动处理模板内组件 + JS 内 Message/Modal）
    vitePluginForArco({ style: 'css' }),
  ],
  build: {
    rollupOptions: {
      output: {
        // 代码分割：Vue 运行时与第三方库各自独立分块，利于缓存
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@arco-design')) return 'arco';
            if (id.includes('vue') || id.includes('@vue')) return 'vue';
            return 'vendor';
          }
        },
      },
    },
  },
});
