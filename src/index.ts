/**
 * Framework-agnostic entry point: the {@link Grass} field, grass maps, the terrain painter, presets and
 * terrain helpers. Requires `WebGPURenderer` from `three/webgpu`.
 *
 * @module threejs-grass
 */
export { Grass, createBladeGeometry, createBillboardGeometry } from './grass'
export type { GrassOptions, GrassInput, GrassSettings, GrassLOD, GrassRenderer, GrassStats, WindOptions, Interactor } from './grass'
export { MAX_INTERACTORS, createGrassUniforms } from './material'
export type { GrassUniforms, GrassMapSample } from './material'
export { GrassMap, TerrainPainter } from './grass-map'
export type { GrassMapOptions, Brush, BrushMode } from './grass-map'
export { presets } from './presets'
export type { GrassStyle, PresetName } from './presets'
export { createHeightSampler, bakeHeightfield, raycastHeight, slopeAt } from './terrain'
export type { HeightFn, Terrain } from './terrain'
