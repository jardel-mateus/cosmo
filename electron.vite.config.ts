import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // superjson e electron-trpc são só ESM: vão dentro do bundle em vez de depender de require(esm).
    build: { externalizeDeps: { exclude: ['superjson', 'electron-trpc'] } },
  },
  preload: {
    // O preload roda em sandbox: tudo precisa ir dentro do bundle (inclusive o electron-trpc).
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
  },
});
