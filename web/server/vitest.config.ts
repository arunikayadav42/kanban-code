import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@kanban-code/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  test: {
    globals: false,
  },
});
