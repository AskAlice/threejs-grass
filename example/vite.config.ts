import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const src = (p: string) => fileURLToPath(new URL(`../packages/${p}`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: /^threejs-heightfield$/, replacement: src('heightfield/src/index.ts') },
    { find: /^threejs-grass\/react$/, replacement: src('grass/src/react.tsx') },
    { find: /^threejs-grass$/, replacement: src('grass/src/index.ts') },
  ] },
  build: { target: 'esnext', rollupOptions: { input: ['index.html', 'r3f.html'] } },
})
