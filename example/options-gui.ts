import GUI from 'three/addons/libs/lil-gui.module.min.js'

/** Slider ranges by option name (anything else gets a range from its default value). */
export type Ranges = Record<string, [min: number, max: number, step?: number]>
/** Dropdown choices by option name. */
export type Choices = Record<string, readonly string[]>

/**
 * Builds a lil-gui panel for a plain-JSON options object: numbers → sliders, booleans → checkboxes,
 * strings → text or dropdowns, `#rrggbb` → colour pickers, nested objects → folders. Every change calls
 * `onChange(path, value)`; the shared sandboxes use it to call `set({...})` on the package.
 */
export function addOptions(gui: GUI, target: Record<string, any>, onChange: (path: string[], value: unknown) => void, opts: { ranges?: Ranges; choices?: Choices; skip?: string[]; path?: string[]; closed?: boolean } = {}) {
  const { ranges = {}, choices = {}, skip = [], path = [] } = opts
  for (const [key, value] of Object.entries(target)) {
    if (skip.includes(key)) continue
    const p = [...path, key]
    const notify = (v: unknown) => onChange(p, v)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const folder = gui.addFolder(key)
      addOptions(folder, value, onChange, { ...opts, path: p })
      if (opts.closed !== false) folder.close()
    } else if (typeof value === 'number') {
      const r = ranges[key] ?? guessRange(value)
      gui.add(target, key, r[0], r[1], r[2] ?? niceStep(r[0], r[1])).onChange(notify)
    } else if (typeof value === 'boolean') {
      gui.add(target, key).onChange(notify)
    } else if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
      gui.addColor(target, key).onChange(notify)
    } else if (typeof value === 'string') {
      ;(choices[key] ? gui.add(target, key, choices[key] as string[]) : gui.add(target, key)).onChange(notify)
    }
  }
}

function guessRange(v: number): [number, number] {
  if (v === 0) return [-1, 1]
  return v > 0 ? [0, v * 4] : [v * 4, -v * 4]
}

function niceStep(min: number, max: number): number {
  const span = max - min
  return span > 1000 ? 1 : span > 10 ? 0.1 : span > 1 ? 0.01 : 0.001
}

/** Builds `{ a: { b: value } }` from a path, for `set()` calls. */
export function patch(path: string[], value: unknown): Record<string, unknown> {
  return path.reduceRight<any>((acc, k) => ({ [k]: acc }), value)
}
