import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
      },
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        output: { format: 'esm' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
      },
    },
  },
});
