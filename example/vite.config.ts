import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const src = (p: string) => fileURLToPath(new URL(`../packages/${p}`, import.meta.url))
const packages = ['heightfield', 'biomes', 'scatter', 'trees', 'water', 'city', 'grass', 'worldgen']
const name = (dir: string) => (dir === 'worldgen' ? 'threejs-worldgen' : `threejs-${dir}`)

export default defineConfig({
  plugins: [react()],
  // Demos run straight from each package's src/, so edits show up without a build.
  resolve: { alias: packages.flatMap((dir) => [
    { find: new RegExp(`^${name(dir)}/react$`), replacement: src(`${dir}/src/react.tsx`) },
    { find: new RegExp(`^${name(dir)}$`), replacement: src(`${dir}/src/index.ts`) },
  ]) },
  worker: { format: 'es' },
  build: { target: 'esnext', rollupOptions: { input: ['index.html', 'r3f.html', 'world.html', 'world-r3f.html'] } },
})
