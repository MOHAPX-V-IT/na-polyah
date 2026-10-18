import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          editor: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            'y-codemirror.next',
          ],
          collaboration: ['yjs', 'y-websocket', 'y-indexeddb'],
        },
      },
    },
  },
});
