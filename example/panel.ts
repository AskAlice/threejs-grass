import GUI from 'three/addons/libs/lil-gui.module.min.js'
import { addOptions, patch, type Choices, type Ranges } from './options-gui'

/** One class (or options struct) shown in the panel. */
export interface PanelClass {
  /** Folder name, e.g. `World` or `WorldTerrain`. */
  name: string
  /** The live options object the controls edit (a plain JSON copy of the instance's options). */
  target: Record<string, any>
  /** Called with the changed path and value; apply it with the class's `set(patch(path, value))`. */
  onChange: (path: string[], value: unknown) => void
  /** Slider ranges by option name. */
  ranges?: Ranges
  /** Dropdown choices by option name. */
  choices?: Choices
  /** Option names to leave out. */
  skip?: string[]
}

/** One package's section of the panel. */
export interface PanelPackage {
  /** Package name, e.g. `threejs-biomes`. */
  name: string
  /** Its classes. */
  classes: PanelClass[]
}

/**
 * The shared options panel for every demo and sandbox: top-level folders per package, then one folder
 * per class, generated from each class's JSON options. Adds a search box that filters every control
 * (and opens the folders that match), a reset button per class, and share-by-URL (changed options are
 * kept in the URL hash and re-applied on load).
 */
export function createPanel(packages: PanelPackage[], { title = 'threejs-worldgen', container }: { title?: string; container?: HTMLElement } = {}): GUI {
  const gui = new GUI({ title, container, width: 320 })
  const shared: Record<string, Record<string, unknown>> = readHash()

  // Search box above the folders.
  const search = document.createElement('input')
  search.placeholder = 'search options…'
  search.className = 'worldgen-panel-search'
  search.style.cssText = 'width: calc(100% - 12px); margin: 6px; padding: 4px 6px; background: #222; color: #eee; border: 1px solid #444; border-radius: 3px; font: inherit'
  gui.$children.prepend(search)

  for (const pkg of packages) {
    const pf = gui.addFolder(pkg.name)
    for (const cls of pkg.classes) {
      const key = `${pkg.name}/${cls.name}`
      const defaults = structuredClone(cls.target)
      const cf = pf.addFolder(cls.name)
      const apply = (path: string[], value: unknown) => {
        cls.onChange(path, value)
        const entry = (shared[key] ??= {})
        entry[path.join('.')] = value
        writeHash(shared)
      }
      addOptions(cf, cls.target, apply, { ranges: cls.ranges, choices: cls.choices, skip: cls.skip })
      cf.add({ reset: () => {
        for (const [p, v] of Object.entries(shared[key] ?? {})) {
          const path = p.split('.')
          const def = path.reduce<any>((o, k) => o?.[k], defaults)
          if (def !== undefined && def !== v) {
            setPath(cls.target, path, structuredClone(def))
            cls.onChange(path, def)
          }
        }
        delete shared[key]
        writeHash(shared)
        cf.controllersRecursive().forEach((c) => c.updateDisplay())
      } }, 'reset').name(`↺ reset ${cls.name}`)
      cf.close()
      // Re-apply shared options from the URL.
      for (const [p, v] of Object.entries(shared[key] ?? {})) {
        const path = p.split('.')
        setPath(cls.target, path, v)
        cls.onChange(path, v)
      }
      cf.controllersRecursive().forEach((c) => c.updateDisplay())
    }
    pf.close()
  }

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase()
    for (const c of gui.controllersRecursive()) {
      const label = `${c.property} ${c._name ?? ''} ${folderPath(c.parent)}`.toLowerCase()
      const show = !q || label.includes(q)
      c.show(show)
      if (show && q) for (let f = c.parent; f && f !== gui; f = f.parent) f.open()
    }
    if (!q) for (const f of gui.foldersRecursive()) f.close()
  })
  return gui
}

/** Convenience: a `PanelClass` whose changes call `instance.set(patch(path, value))`. */
export function classOf(name: string, instance: { set: (input: any) => unknown }, options: Record<string, any>, extra: Partial<PanelClass> = {}): PanelClass {
  return { name, target: structuredClone(options), onChange: (path, value) => instance.set(patch(path, value)), ...extra }
}

function folderPath(f: GUI | undefined): string {
  const names: string[] = []
  for (let g = f; g; g = g.parent) names.push(g._title ?? '')
  return names.join(' ')
}

function setPath(target: Record<string, any>, path: string[], value: unknown) {
  let o = target
  for (const k of path.slice(0, -1)) o = o[k] ??= {}
  o[path[path.length - 1]] = value
}

function readHash(): Record<string, Record<string, unknown>> {
  try {
    const h = location.hash.slice(1)
    return h ? JSON.parse(decodeURIComponent(atob(h))) : {}
  } catch {
    return {}
  }
}

function writeHash(state: Record<string, Record<string, unknown>>) {
  const json = JSON.stringify(state)
  history.replaceState(null, '', json === '{}' ? location.pathname + location.search : `#${btoa(encodeURIComponent(json))}`)
}
