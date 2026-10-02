import { Color, DataTexture, DoubleSide, MeshPhysicalNodeMaterial, Vector2, Vector3, Vector4, type Node } from 'three/webgpu'
import {
  Discard, Fn, Loop, abs, atan, attribute, cameraPosition, color, cos, dot, float, floor, fract, hash, int, length, max, min, mix,
  modelWorldMatrix, mx_noise_float, normalize, positionGeometry, positionWorld, pow, sin, smoothstep, sqrt, step,
  texture, time, transformNormalToView, uniform, uniformArray, uv, varying, vec2, vec3, vec4,
} from 'three/tsl'

/** Maximum number of simultaneous {@link Interactor}s. Extra ones are ignored. */
export const MAX_INTERACTORS = 16

/** Neutral grass map: full coverage (R=1), default height (G=0.5 → 1x). */
const neutralMap = new DataTexture(new Uint8Array([255, 128, 0, 255]), 1, 1)
neutralMap.needsUpdate = true

/**
 * Creates the uniform set shared by a Grass field's materials. Grass calls this for you and drives the
 * values from `Grass.set()`; it is exported so the {@link GrassUniforms} type is documented in full.
 */
export function createGrassUniforms() {
  return {
    /** Blade colour at the root (from `baseColor`). */
    baseColor: uniform(new Color()),
    /** Blade colour at the tip (from `tipColor`). */
    tipColor: uniform(new Color()),
    /** Per-blade brightness variation, 0..1. */
    colorVariation: uniform(0),
    /** Field-scale light/dark and dry patches, 0..1. */
    patchiness: uniform(0),
    /** Back-lit glow strength. */
    translucency: uniform(0),
    /** Blade height in metres. */
    bladeHeight: uniform(0),
    /** Blade base width in metres. */
    bladeWidth: uniform(0),
    /** Natural droop, 0..1. */
    curvature: uniform(0),
    /** Resistance to wind and interaction (never below 0.05). */
    stiffness: uniform(1),
    /** Normalised XZ wind direction. */
    windDirection: uniform(new Vector2(1, 0)),
    /** How far blades bend in the wind. */
    windStrength: uniform(0),
    /** Gust noise frequency (1/metres). */
    windScale: uniform(0),
    /** Gust travel speed. */
    windSpeed: uniform(0),
    /** The four LOD distances (x, y, z, w = LOD 0..3). */
    lodDistances: uniform(new Vector4()),
    /** The four LOD density fractions (x, y, z, w = LOD 0..3). */
    lodDensities: uniform(new Vector4(1, 1, 1, 1)),
    /** Radius with grass; blades fade over its last 15%. */
    maxDistance: uniform(0),
    /** 1 tints grass by LOD, 0 = normal shading. */
    debugLods: uniform(0),
    /** Position LOD/fades are measured from. Set from the Grass camera on the CPU so shadow passes
     *  (which render from the light) see exactly the same blades as the main view. */
    viewPosition: uniform(new Vector3()),
    /** Direction *towards* the sun. Drives back-lit translucency. */
    sunDirection: uniform(new Vector3(0.4, 0.8, 0.3).normalize()),
    /** Sun colour × intensity. */
    sunColor: uniform(new Color(1, 1, 1)),
    /** minX, minZ, sizeX, sizeZ of the grass map in world space. */
    mapBounds: uniform(new Vector4(-1e6, -1e6, 2e6, 2e6)),
    /** Grass map texture (R = coverage, G = height); a neutral 1×1 texture when there is none. */
    map: texture(neutralMap),
    /** Global multiplier on interactor push. */
    interactionStrength: uniform(1),
    /** xyz = world position, w = radius (0 = unused slot). */
    interactors: uniformArray(Array.from({ length: MAX_INTERACTORS }, () => new Vector4()), 'vec4'),
    /** Number of active entries in `interactors`. */
    interactorCount: uniform(0, 'int'),
  }
}

/** Shader uniforms of a Grass field (`grass.uniforms`). Each entry is a TSL uniform/texture node. */
export type GrassUniforms = ReturnType<typeof createGrassUniforms>

/** TSL nodes returned by `grass.mapNode()`. */
export interface GrassMapSample {
  /** 0 = no grass, 1 = full coverage. 1 outside the map. */
  coverage: Node<'float'>
  /** Height multiplier, 0..2 (1 = preset height). 1 outside the map. */
  height: Node<'float'>
}

/**
 * Samples the grass map at a world XZ position. Outside the map: full coverage, 1x height.
 * Usable in any material — e.g. to show dirt on terrain where grass was erased.
 */
export function sampleGrassMap(u: GrassUniforms, worldXZ: Node<'vec2'>, vertexStage = false): GrassMapSample {
  const mapUv = worldXZ.sub(u.mapBounds.xy).div(u.mapBounds.zw)
  const inMap = step(0, mapUv.x).mul(step(mapUv.x, 1)).mul(step(0, mapUv.y)).mul(step(mapUv.y, 1))
  const s = vertexStage ? u.map.sample(mapUv).level(float(0)) : u.map.sample(mapUv)
  return { coverage: mix(float(1), s.r, inMap), height: mix(float(1), s.g.mul(2), inMap) }
}

const LOD_COLORS = [new Color('#ff4d4d'), new Color('#ffd23f'), new Color('#4dd96b'), new Color('#4da6ff')]

/**
 * One material, two shapes:
 *  - blades: tapered strips, yaw baked per instance
 *  - billboards: view-facing quads cut into a clump of strands in the fragment shader
 *
 * Instance attributes (filled by Grass tiles):
 *  aOffset = (x, y, z) local to tile, w = yaw
 *  aParams = heightScale, widthScale, rank (0..1, LOD thinning order), seed (0..1)
 *  aPatch  = field-scale brightness and dryness noise (static, so baked on the CPU instead of per vertex)
 */
export function createGrassMaterial(u: GrassUniforms, billboard: boolean) {
  const aOffset = attribute('aOffset', 'vec4')
  const aParams = attribute('aParams', 'vec4')
  const aPatch = attribute('aPatch', 'vec2')
  const seed = aParams.w
  const t = positionGeometry.y // 0 at root, 1 at tip

  const root = modelWorldMatrix.mul(vec4(aOffset.xyz, 1)).xyz
  const toView = u.viewPosition.xz.sub(root.xz)
  const dist = length(toView)

  // Density fraction, piecewise-linear across the 4 LOD distances. Continuous in distance,
  // so thinning happens blade-by-blade instead of popping at tile boundaries.
  const d = u.lodDistances
  const k = u.lodDensities
  const seg = (a: any, b: any) => dist.sub(a).div(max(b.sub(a), 1e-3)).clamp(0, 1)
  const density = mix(mix(mix(k.x, k.y, seg(d.x, d.y)), k.z, seg(d.y, d.z)), k.w, seg(d.z, d.w))
  const thin = float(1).sub(smoothstep(density.mul(0.75), density, aParams.z))
  const widthCompensation = density.max(0.02).sqrt().reciprocal() // fewer blades → wider blades, same coverage
  const lodIndex = step(d.y, dist).add(step(d.z, dist)).add(step(d.w, dist))

  // Grass map: R = coverage, G = height. Blades thin out *and* shorten towards map edges,
  // so painted borders look like grass growing out rather than a hard cut.
  const map = sampleGrassMap(u, root.xz, true)
  const covered = float(1).sub(smoothstep(map.coverage.sub(0.08), map.coverage, fract(seed.mul(13.37))))
  const edgeTaper = mix(float(0.3), float(1), smoothstep(0, 0.75, map.coverage))

  const distanceFade = float(1).sub(smoothstep(u.maxDistance.mul(0.85), u.maxDistance, dist))
  const fade = thin.mul(covered).mul(distanceFade)

  const height = u.bladeHeight.mul(aParams.x).mul(map.height).mul(edgeTaper).mul(fade)
  const width = billboard
    ? u.bladeHeight.mul(1.4).mul(aParams.y).mul(widthCompensation).mul(fade)
    : u.bladeWidth.mul(aParams.y).mul(widthCompensation).mul(fade)

  const yaw = billboard ? atan(toView.x, toView.y) : aOffset.w
  const facing = vec2(sin(yaw), cos(yaw))
  const side = vec2(cos(yaw), sin(yaw).negate())

  // Broad scrolling gusts plus a cheap travelling ripple. Every vertex of a blade evaluates this,
  // so it is kept to a single noise call.
  const windUv = root.xz.mul(u.windScale).sub(u.windDirection.mul(time.mul(u.windSpeed)))
  const ripple = sin(dot(root.xz, u.windDirection).mul(u.windScale.mul(9)).sub(time.mul(u.windSpeed).mul(5)))
  const gust = mx_noise_float(windUv).mul(0.75).add(ripple.mul(0.25)).mul(0.5).add(0.5)

  const interaction = Fn(() => {
    const push = vec2(0).toVar()
    Loop({ start: int(0), end: u.interactorCount, type: 'int', condition: '<' }, ({ i }) => {
      const it = u.interactors.element(i) as any
      const radius = max(it.w, 1e-4)
      const delta = root.xz.sub(it.xz)
      const falloff = float(1).sub(smoothstep(radius.mul(0.35), radius, length(delta)))
      const gate = step(1e-4, it.w).mul(float(1).sub(smoothstep(radius, radius.mul(2), abs(root.y.sub(it.y)))))
      push.addAssign(normalize(delta.add(1e-5)).mul(falloff.mul(gate)))
    })
    return push.mul(u.interactionStrength)
  })

  const position = Fn(() => {
    const flutter = sin(time.mul(3.1).add(seed.mul(40))).mul(0.06)
    const wind = u.windDirection.mul(gust.add(flutter).mul(u.windStrength))
    const r = fract(seed.mul(7.1))
    const droop = facing.mul(u.curvature.mul(r.mul(r).mul(1.5).add(0.25))) // most blades stand, a few flop over
    const bend = droop.add(wind.div(u.stiffness)).add(interaction().mul(2.2)).toVar()

    // Bend the tip along `bend` while (approximately) preserving blade length.
    const amount = min(length(bend), 0.97)
    const offset = bend.div(max(length(bend), 1e-4)).mul(amount)
    const xz = side.mul(positionGeometry.x.mul(width)).add(offset.mul(t.mul(t).mul(height)))
    const y = t.mul(height).mul(sqrt(float(1).sub(amount.mul(amount))))
    return aOffset.xyz.add(vec3(xz.x, y, xz.y))
  })

  // Mostly-up normals shade grass like the surface it forms; the sideways tilt rounds each blade and
  // the wind tilt makes gusts visible as moving light/dark bands across the field.
  const windTilt = vec3(u.windDirection.x, 0, u.windDirection.y).mul(gust.mul(u.windStrength).mul(0.9))
  const objectNormal = billboard
    ? normalize(vec3(0, 1, 0).add(windTilt))
    : normalize(vec3(side.x, 0, side.y).mul(positionGeometry.x.mul(1.1)).add(vec3(0, 1, 0)).add(windTilt))

  // Per-vertex extras for the fragment stage: large-scale patches, dryness, gust, LOD index.
  const patches = varying(vec4(aPatch.x, aPatch.y, gust, lodIndex))

  const albedo = Fn(() => {
    let tipT: any = t
    if (billboard) {
      // Cut the quad into a clump of tapered, leaning strands.
      const strands = 17
      const sx = uv().x.mul(strands)
      const id = floor(sx)
      const strandHeight = hash(id.add(seed.mul(1000))).pow(0.6).mul(0.7).add(0.3)
      const lean = hash(id.mul(3.1).add(seed.mul(500))).sub(0.5).mul(2.4)
      const fx = fract(sx).sub(0.5).sub(lean.mul(t))
      const halfWidth = float(0.42).mul(float(1).sub(t.div(strandHeight)).pow(0.8))
      Discard(t.greaterThan(strandHeight).or(abs(fx).greaterThan(halfWidth)))
      tipT = t.div(strandHeight)
    }
    const variation = float(1).add(fract(seed.mul(91.7)).sub(0.5).mul(2).mul(u.colorVariation))
    let c: any = mix(u.baseColor, u.tipColor, pow(tipT, 1.2)).mul(variation)
    // Field-scale variation: brighter/darker patches and sun-dried yellowish areas.
    c = c.mul(float(1).add(patches.x.mul(u.patchiness).mul(0.7)))
    c = mix(c, c.mul(vec3(1.3, 1.12, 0.55)), smoothstep(0.05, 0.55, patches.y).mul(u.patchiness))
    // Bent blades catch more sky light.
    c = c.mul(float(1).add(patches.z.mul(u.windStrength).mul(0.35).mul(tipT)))
    // Dense grass occludes its own base.
    c = c.mul(mix(float(0.22), float(1), smoothstep(0, 0.75, tipT)))
    const i = patches.w
    const lodColor = mix(mix(mix(color(LOD_COLORS[0]), color(LOD_COLORS[1]), step(0.5, i)), color(LOD_COLORS[2]), step(1.5, i)), color(LOD_COLORS[3]), step(2.5, i))
    return vec4(mix(c, lodColor.mul(mix(float(0.4), float(1), tipT)), u.debugLods), 1)
  })

  // Thin blades transmit sunlight: glow when looking towards the sun.
  const translucency = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld))
    const back = pow(max(dot(viewDir, u.sunDirection.negate()), 0), 4)
    const albedo = mix(u.baseColor, u.tipColor, t)
    return albedo.mul(u.sunColor).mul(back.mul(u.translucency).mul(t.mul(t)).mul(0.45)).mul(float(1).sub(u.debugLods))
  })

  // Physical only for its specular-intensity knob: grass is glossy, but full dielectric Fresnel at grazing
  // angles turns a whole field white when looking towards the sun.
  const material = new MeshPhysicalNodeMaterial({ side: DoubleSide, roughness: 0.6, metalness: 0, specularIntensity: 0.18 })
  material.positionNode = position()
  material.normalNode = transformNormalToView(varying(objectNormal))
  material.colorNode = albedo()
  material.emissiveNode = translucency()
  material.specularColorNode = mix(u.tipColor, vec3(1), 0.35) // sheen picks up the blade colour
  return material
}
