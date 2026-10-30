import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  optimizeDeps: {
    exclude: ['@kvl/ui', '@kvl/shared'],
  },
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
