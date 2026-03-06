import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  root: './src/web',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    watch: {
      usePolling: false,
    },
    proxy: {
      '/ws': {
        target: 'ws://localhost:3210',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3210',
        changeOrigin: true,
      },
    },
  },
});
