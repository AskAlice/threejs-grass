import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const src = (p: string) => fileURLToPath(new URL(`../src/${p}`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: /^threejs-grass\/react$/, replacement: src('react.tsx') },
    { find: /^threejs-grass$/, replacement: src('index.ts') },
  ] },
  build: { target: 'esnext', rollupOptions: { input: ['index.html', 'r3f.html'] } },
})
