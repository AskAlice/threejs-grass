/**
 * React Three Fiber entry point: the `<Grass>` component plus everything from `threejs-grass`
 * (the imperative class is re-exported as `GrassImpl`).
 *
 * @module threejs-grass/react
 */
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Camera, Object3D } from 'three/webgpu'
import { Grass as GrassImpl, type GrassInput, type GrassRenderer } from './grass'
import { TerrainPainter, type Brush } from './grass-map'
import type { HeightFn, Terrain } from 'threejs-heightfield'

export * from './index'
/** The imperative {@link GrassImpl | Grass} class, re-exported under another name because `Grass` is the component here. */
export { Grass as GrassImpl } from './grass'

/** Props of the `<Grass>` component: every {@link GrassInput} setting plus the ones below. */
export interface GrassProps extends GrassInput {
  /** Receives the underlying Grass instance (for `sampleHeight`, `mapNode`, `stats`, …). */
  ref?: Ref<GrassImpl | null>
  /**
   * Mesh/group (or a ref to one) — baked when the component mounts or the object changes — or a
   * `(x, z) => y` height function. Inline functions are fine: the latest one is always used, but
   * tiles already built keep their heights (call `grass.setTerrain()` to force a rebuild).
   */
  terrain?: Terrain | RefObject<Object3D | null>
  /** Camera the field follows. Defaults to the R3F default camera. */
  camera?: Camera
  /** Turns on the {@link TerrainPainter} with this brush (needs `grassMap`). `false` = off. */
  paint?: Partial<Brush> | false
}

/**
 * Infinite, camera-centred grass for react-three-fiber. Needs a WebGPURenderer:
 *
 * @example
 * ```tsx
 * <Canvas gl={async (props) => { const r = new WebGPURenderer(props as any); await r.init(); return r }}>
 *   <mesh ref={terrain} geometry={hills} />
 *   <Grass terrain={terrain} preset="tallFescue" tileSize={25} maxDistance={200} />
 * </Canvas>
 * ```
 */
export function Grass({ ref, terrain, camera, paint = false, ...options }: GrassProps): React.JSX.Element | null {
  const { camera: defaultCamera, gl } = useThree()
  const activeCamera = camera ?? defaultCamera
  const [grass, setGrass] = useState<GrassImpl | null>(null)
  const latest = useRef(options)
  latest.current = options

  // Height functions are often written inline; only an object/ref change should recreate the field.
  const terrainRef = useRef(terrain)
  terrainRef.current = terrain
  const terrainKey = typeof terrain === 'function' ? 'function' : terrain

  useEffect(() => {
    let created: GrassImpl | null = null
    let cancelled = false
    const t = terrainRef.current
    const resolved: Terrain | undefined =
      typeof t === 'function' ? (x, z) => (terrainRef.current as HeightFn)(x, z)
      : t && 'current' in t ? t.current ?? undefined
      : t
    GrassImpl.create({ camera: activeCamera, renderer: gl as unknown as GrassRenderer, terrain: resolved, ...latest.current }).then((g) => {
      if (cancelled) return g.dispose()
      created = g
      setGrass(g)
    })
    return () => {
      cancelled = true
      created?.dispose()
      setGrass(null)
    }
  }, [activeCamera, gl, terrainKey])

  // Props are the full truth: reset() drops overrides whose props were removed. Cheap: visual props
  // only touch uniforms; tiles rebuild only when layout props actually change.
  useEffect(() => {
    grass?.reset(options)
  })

  const painter = useRef<TerrainPainter | null>(null)
  const painting = !!paint
  useEffect(() => {
    if (!grass || !painting) return
    const p = (painter.current = new TerrainPainter(grass, gl.domElement))
    return () => {
      p.dispose()
      painter.current = null
    }
  }, [grass, gl, painting])
  useEffect(() => {
    if (painter.current && paint) Object.assign(painter.current.brush, paint)
  })

  useImperativeHandle(ref, () => grass!, [grass])
  useFrame(() => grass?.update())

  return grass ? <primitive object={grass.object} /> : null
}
