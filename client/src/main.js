import { createApp } from 'vue';
import './style.css';
import App from './App.vue';

// Arco 组件与样式由 @arco-plugins/vite-vue 按需自动引入，无需全量注册
createApp(App).mount('#app');
