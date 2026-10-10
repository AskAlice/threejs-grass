import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import GUI from 'three/addons/libs/lil-gui.module.min.js'
import { World, createSample } from 'threejs-biomes'
import { DEFAULT_FISH_SCHOOLS, FISH_SPECIES, Fauna, Fish } from 'threejs-fauna'
import { addOptions, patch } from './options-gui'

// Sandbox for threejs-fauna. Default: every fish species swimming in place, with a GUI for one of
// them. `?world`: fish schools and bird flocks streaming around the camera at a river mouth.
const params = new URLSearchParams(location.search)
const hud = document.getElementById('hud')!

const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.has('webgl') })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)
await renderer.init()

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 20_000)
const sun = new THREE.DirectionalLight('#fff4e0', 3)
sun.position.set(3, 6, 4)
scene.add(sun, new THREE.HemisphereLight('#bfe0ff', '#3a4a40', 1.2))
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
const gui = new GUI({ title: 'threejs-fauna' })

if (params.has('world')) await worldMode()
else await gallery()

async function gallery() {
  scene.background = new THREE.Color('#1d4a5e')
  const ids = Object.keys(FISH_SPECIES)
  const fishes = await Promise.all(ids.map((preset, i) => Fish.create({ renderer, scene, preset, seed: i + 1 })))
  fishes.forEach((f, i) => {
    // Gallery: each fish shown about 0.6 m long so small and large species compare by shape.
    const k = 0.6 / FISH_SPECIES[ids[i]].length
    f.object.scale.setScalar(k)
    f.object.position.set((i % 4) * 0.9 - 1.35, 1.4 - Math.floor(i / 4) * 0.7, 0)
    f.object.rotation.y = Math.PI / 2
  })
  camera.position.set(0, 0.7, 3.4)
  controls.target.set(0, 0.7, 0)
  const state = { species: 'clownfish', speed: 1, turn: 0 }
  let folder = gui.addFolder('species')
  const bind = () => {
    folder.destroy()
    folder = gui.addFolder(`species: ${state.species}`)
    const fish = fishes[ids.indexOf(state.species)]
    const opts = structuredClone(fish.settings.species) as Record<string, any>
    delete opts.habitat
    delete opts.school
    addOptions(folder, opts, (path, value) => fish.set({ species: patch(path, value) }), {
      ranges: { depth: [0.05, 0.8], width: [0.02, 0.4], bodyLength: [0.5, 0.95], nose: [0.3, 1.5], back: [0.3, 0.7], peduncle: [0.05, 0.6], squareness: [1.5, 4], count: [0, 20, 1], density: [0, 30], amplitude: [0, 0.3], hueVariation: [0, 1] },
      choices: { shape: ['forked', 'lunate', 'rounded', 'truncate'] },
    })
  }
  gui.add(state, 'species', ids).onChange(bind)
  gui.add(state, 'speed', 0, 4).onChange((v: number) => fishes.forEach((f) => f.set({ speed: v })))
  gui.add(state, 'turn', -1, 1).onChange((v: number) => fishes.forEach((f) => f.set({ turn: v })))
  bind()
  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
    hud.textContent = `${ids.length} species · one InstancedMesh each`
  })
}

async function worldMode() {
  scene.background = new THREE.Color('#9cc4e4')
  const world = new World({ seed: 1 })
  const frame = world.frame
  const center: [number, number] = [-10400, 6200] // a river mouth in seed 1 (see water.ts)
  const origin: [number, number, number] = [center[0], 0, center[1]]
  scene.add(buildTerrain(world, center, 700, 220))
  // A simple see-through sea so the fish stay visible from above.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: '#2b6f8a', transparent: true, opacity: 0.35, depthWrite: false }))
  sea.position.y = world.options.seaLevel - origin[1]
  scene.add(sea)
  camera.position.set(-40, 25, 60)
  controls.target.set(0, -1, 0)
  const fauna = await Fauna.create({ camera, scene, renderer, world, origin, predators: [{ object: camera, radius: 3 }] })
  Object.assign(globalThis, { fauna, THREE }) // for poking at it from the console
  const fishOptions = structuredClone({ ...DEFAULT_FISH_SCHOOLS, predators: [], species: undefined }) as Record<string, any>
  for (const k of ['predators', 'origin', 'species', 'seed']) delete fishOptions[k]
  addOptions(gui.addFolder('fish'), fishOptions, (path, value) => fauna.set({ fish: patch(path, value) }), { ranges: { density: [0, 2000], gridResolution: [3, 9, 1], tileSize: [16, 256, 1] } })
  const s = createSample(8)
  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
    const t = controls.target
    frame.sample(center[0] + t.x, center[1] + t.z, s, 1)
    const f = fauna.layers.fish?.stats, b = fauna.layers.birds?.stats
    hud.textContent = [
      `fish: ${f?.animals ?? 0} in ${f?.groups ?? 0} schools · ${f?.pending ?? 0} tiles pending`,
      `birds: ${b?.animals ?? 0} in ${b?.groups ?? 0} flocks`,
      `target: ${s.waterLevel === s.waterLevel ? `${(s.waterLevel - s.elevation).toFixed(1)} m of ${s.river > 0.25 ? 'river' : 'sea'} water` : 'dry'} · ${s.temperature.toFixed(1)} °C`,
    ].join('\n')
  })
}

/** A square terrain patch around `center`, in render space (origin at `center`, y = 0 at sea level), coloured by height. */
function buildTerrain(world: World, center: [number, number], size: number, segments: number) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const s = createSample(8)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = center[0] + pos.getX(i), z = center[1] + pos.getZ(i)
    const h = world.frame.sample(x, z, s, (size / segments) * 2).elevation
    pos.setY(i, h)
    c.set(s.river > 0.2 ? '#6b5a44' : h < world.options.seaLevel + 1.2 ? '#d8c79a' : h < 60 ? '#5f8a3c' : '#7d756b')
    c.toArray(colors, i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95 }))
}
