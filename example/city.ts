import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { World } from 'threejs-biomes'
import { City, findSettlements, type CityInput, type SettlementSize } from 'threejs-city'

// threejs-city demo: a settlement placed by findSettlements on a threejs-biomes world, on a simple
// terrain mesh sampled from world.frame (rebuilt whenever the city flattens the ground).
// Keys: 1–4 size · R new seed · N night · W wet · S snow · B burn · D damage · G organic/grid/radial

const hud = document.getElementById('hud')!
const renderer = new THREE.WebGPURenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.shadowMap.enabled = true
document.body.appendChild(renderer.domElement)
await renderer.init()

const scene = new THREE.Scene()
const day = new THREE.Color('#9cc4e4'), night = new THREE.Color('#0b1020')
scene.background = day.clone()
scene.fog = new THREE.Fog(day.clone(), 1500, 9000)
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 30000)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
const sun = new THREE.DirectionalLight('#fff1dc', 3)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
Object.assign(sun.shadow.camera, { left: -900, right: 900, top: 900, bottom: -900, near: 10, far: 6000 })
const sky = new THREE.HemisphereLight('#cfe3ff', '#5a5040', 1.2)
scene.add(sun, sun.target, sky)

const world = new World({ seed: 11 })
const sites = findSettlements(world, world.frame, { minX: -10000, minZ: -10000, maxX: 10000, maxZ: 10000 })
const best = (size: SettlementSize) => sites.filter((s) => s.size === size).sort((a, b) => b.score - a.score)[0] ?? sites.sort((a, b) => b.importance - a.importance)[0]
let size: SettlementSize = 'town'
let site = best(size)

// Terrain: a grid around the city, coloured by the world's ground mix; water from waterLevel.
const terrainMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95 })
const waterMaterial = new THREE.MeshStandardNodeMaterial({ color: '#3a6f8f', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 })
const terrain = new THREE.Mesh(new THREE.BufferGeometry(), terrainMaterial)
const water = new THREE.Mesh(new THREE.BufferGeometry(), waterMaterial)
terrain.receiveShadow = true
scene.add(terrain, water)

function buildTerrain(cx: number, cz: number, size: number, n = 256) {
  const geo = new THREE.PlaneGeometry(size, size, n, n).rotateX(-Math.PI / 2).translate(cx, 0, cz)
  const wgeo = geo.clone()
  const pos = geo.attributes.position, wpos = wgeo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const s = world.sample(0, 0)
  for (let i = 0; i < pos.count; i++) {
    world.sample(pos.getX(i), pos.getZ(i), s)
    pos.setY(i, s.elevation)
    wpos.setY(i, s.waterLevel === s.waterLevel ? s.waterLevel : s.elevation - 2)
  }
  geo.computeVertexNormals()
  const nrm = geo.attributes.normal
  for (let i = 0; i < pos.count; i++) {
    world.sample(pos.getX(i), pos.getZ(i), s)
    const ny = Math.max(0.05, nrm.getY(i))
    const { color } = world.ground(s, Math.sqrt(1 - ny * ny) / ny)
    colors.set(new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace).toArray(), i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeBoundingSphere(); wgeo.computeBoundingSphere()
  terrain.geometry.dispose(); water.geometry.dispose()
  terrain.geometry = geo; water.geometry = wgeo
}

const input: CityInput = { seed: 1 }
let city: City
let nightValue = 0
let rebuild = 0
world.onChange(() => (rebuild = performance.now() + 50)) // the city added/removed flatten modifiers
async function place() {
  city?.dispose()
  city = await City.create({ world, camera, scene, center: [site.x, site.z], size, radius: site.radius, ...input, facade: { night: nightValue } })
  const r = city.plan!.radius
  buildTerrain(site.x, site.z, r * 3.2)
  rebuild = 0
  const y = world.height(site.x, site.z)
  controls.target.set(site.x, y, site.z)
  camera.position.set(site.x + r * 0.9, y + r * 0.7, site.z + r * 1.1)
  sun.position.set(site.x + 1500, y + 2500, site.z + 800)
  sun.target.position.set(site.x, y, site.z)
  Object.assign(globalThis, { city, camera, controls, world }) // for poking at it from the console
}
await place()

const weather = { wetness: 0, snow: 0, burn: 0, damage: 0 }
const styles = ['auto', 'grid', 'radial', 'organic'] as const
let style = 0, nightTarget = 0
addEventListener('keydown', async (e) => {
  const k = e.key.toLowerCase()
  const sizes: Record<string, SettlementSize> = { '1': 'hamlet', '2': 'village', '3': 'town', '4': 'city' }
  if (sizes[k]) { size = sizes[k]; site = best(size); await place() }
  if (k === 'r') { input.seed = (Number(input.seed) || 0) + 1; city.set({ seed: input.seed }) }
  if (k === 'g') { style = (style + 1) % styles.length; input.style = styles[style]; city.set({ style: styles[style] }) }
  if (k === 'n') nightTarget = 1 - nightTarget
  const toggle = { w: 'wetness', s: 'snow', b: 'burn', d: 'damage' } as const
  if (k in toggle) {
    const key = toggle[k as keyof typeof toggle]
    weather[key] = weather[key] ? 0 : key === 'burn' || key === 'damage' ? 0.6 : 1
    const w = { walls: { ...weather }, roofs: { ...weather }, roads: { ...weather } }
    input.weather = w
    city.set({ weather: w })
  }
})
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

renderer.setAnimationLoop(() => {
  controls.update()
  if (rebuild && performance.now() > rebuild && city.plan) { rebuild = 0; buildTerrain(site.x, site.z, city.plan.radius * 3.2) }
  if (Math.abs(nightTarget - nightValue) > 0.002) {
    nightValue += (nightTarget - nightValue) * 0.05
    city.set({ facade: { night: nightValue } }) // only while fading: uniforms only, no regeneration
  }
  ;(scene.background as THREE.Color).copy(day).lerp(night, nightValue)
  ;(scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color)
  sun.intensity = 3 * (1 - nightValue) + 0.05
  sky.intensity = 1.2 * (1 - nightValue * 0.85)
  const s = city.stats
  hud.textContent = `threejs-city — ${size} (${city.plan?.architecture ?? '…'}, ${city.plan?.style ?? '…'})
${s.buildings} buildings · ${s.roadKm.toFixed(1)} km roads · ${s.bridges} bridges · pop ≈ ${s.population.toLocaleString()}
${s.detailed} at full detail · generated in ${s.generationMs.toFixed(0)} ms
1–4 size · R seed · G layout · N night · W wet · S snow · B burn · D damage`
  renderer.render(scene, camera)
})
