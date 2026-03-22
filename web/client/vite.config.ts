/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const BACKEND_PORT = process.env.KANBAN_SERVER_PORT ?? '3000';
const CLIENT_PORT = parseInt(process.env.KANBAN_CLIENT_PORT ?? '5173', 10);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@kanban-code/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: CLIENT_PORT,
    proxy: {
      '/api': `http://localhost:${BACKEND_PORT}`,
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
