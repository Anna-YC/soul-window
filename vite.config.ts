import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 主窗口 index.html + 休息窗口 rest.html 双入口。
// base './' 保证 electron-loadFile 加载打包产物时相对路径正确。
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        rest: resolve(__dirname, 'rest.html'),
      },
    },
  },
});
