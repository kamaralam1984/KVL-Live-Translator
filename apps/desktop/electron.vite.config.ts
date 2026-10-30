import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    // @kvl/shared points at raw TypeScript source with extensionless relative
    // imports (e.g. './types/transcript') — fine for Vite's bundler, but
    // externalizing it leaves those imports for plain Node ESM to resolve at
    // runtime, which requires explicit extensions and throws ERR_MODULE_NOT_FOUND.
    plugins: [externalizeDepsPlugin({ exclude: ['@kvl/shared'] })],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@kvl/shared'] })],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    optimizeDeps: {
      exclude: ['@kvl/ui', '@kvl/shared'],
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    plugins: [react()],
  },
});
