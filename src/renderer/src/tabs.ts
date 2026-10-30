/**
 * Pestañas de repos: cada una guarda la ruta de su repo; sin ruta es la pestaña nueva
 * («Repositorios»). Funciones puras: App decide qué repo abrir con el resultado.
 */
export interface Tab {
  id: number
  /** raíz del repo; null = pestaña nueva */
  path: string | null
  name: string | null
}

export interface Tabs {
  tabs: Tab[]
  active: number
  /** rutas de las pestañas cerradas, la última al final (Reabrir pestaña cerrada) */
  closed: string[]
  nextId: number
}

const MAX_CLOSED = 20

export const initialTabs = (): Tabs => ({ tabs: [{ id: 1, path: null, name: null }], active: 1, closed: [], nextId: 2 })

export const activeTab = (s: Tabs): Tab => s.tabs.find((t) => t.id === s.active) ?? s.tabs[0]!

/** Abre una pestaña nueva (vacía) a la derecha de la activa y la activa. */
export function newTab(s: Tabs): Tabs {
  const at = s.tabs.findIndex((t) => t.id === s.active) + 1
  const tab: Tab = { id: s.nextId, path: null, name: null }
  return { ...s, tabs: [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)], active: tab.id, nextId: s.nextId + 1 }
}

/** Cierra una pestaña; se activa la de la derecha (o la de la izquierda). Cerrar la última deja una pestaña nueva. */
export function closeTab(s: Tabs, id: number): Tabs {
  const i = s.tabs.findIndex((t) => t.id === id)
  if (i < 0) return s
  const tab = s.tabs[i]!
  const closed = tab.path ? [...s.closed, tab.path].slice(-MAX_CLOSED) : s.closed
  const rest = s.tabs.filter((t) => t.id !== id)
  if (rest.length === 0) {
    const fresh = { id: s.nextId, path: null, name: null }
    return { tabs: [fresh], active: fresh.id, closed, nextId: s.nextId + 1 }
  }
  const active = s.active === id ? rest[Math.min(i, rest.length - 1)]!.id : s.active
  return { ...s, tabs: rest, active, closed }
}

/** Pestaña siguiente o anterior, dando la vuelta (Ctrl+Tab / Ctrl+Shift+Tab). */
export function cycleTab(s: Tabs, dir: 1 | -1): Tabs {
  const i = s.tabs.findIndex((t) => t.id === s.active)
  return { ...s, active: s.tabs[(i + dir + s.tabs.length) % s.tabs.length]!.id }
}

/** Pestaña N (Ctrl+1–9); Ctrl+9 es siempre la última, como en el navegador. */
export function tabAt(s: Tabs, n: number): Tabs {
  const tab = n >= 9 ? s.tabs.at(-1) : s.tabs[n - 1]
  return tab ? { ...s, active: tab.id } : s
}

/**
 * La pestaña `id` mostrará el repo `path`. Si otra pestaña ya lo tiene abierto, se activa esa y, si `id` era una
 * pestaña nueva vacía, se descarta: un repo vive en una sola pestaña.
 */
export function showRepo(s: Tabs, id: number, path: string, name: string): Tabs {
  const other = s.tabs.find((t) => t.id !== id && t.path !== null && samePath(t.path, path))
  if (other) {
    const self = s.tabs.find((t) => t.id === id)
    const tabs = self && self.path === null ? s.tabs.filter((t) => t.id !== id) : s.tabs
    return { ...s, tabs, active: other.id }
  }
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, path, name } : t)), active: id }
}

/** Reabre la última pestaña cerrada; devuelve el estado y la ruta que hay que abrir (null si no hay). */
export function reopenClosed(s: Tabs): { tabs: Tabs; path: string | null } {
  const path = s.closed.at(-1) ?? null
  if (!path) return { tabs: s, path: null }
  return { tabs: { ...newTab(s), closed: s.closed.slice(0, -1) }, path }
}

const samePath = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// las pestañas de repo vuelven al reiniciar (las vacías no se guardan)
const KEY = 'fluxo.tabs'

export function saveTabs(s: Tabs): void {
  try {
    const repos = s.tabs.filter((t) => t.path)
    const active = Math.max(0, repos.findIndex((t) => t.id === s.active))
    localStorage.setItem(KEY, JSON.stringify({ repos: repos.map((t) => ({ path: t.path, name: t.name })), active }))
  } catch {
    // solo se pierde lo recordado
  }
}

/** Pestañas guardadas, o null si no hay (entonces se reabre el último reciente, H08). */
export function loadTabs(): Tabs | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { repos?: { path?: unknown; name?: unknown }[]; active?: unknown } | null
    const repos = (raw?.repos ?? []).filter((r): r is { path: string; name: string } => typeof r.path === 'string' && typeof r.name === 'string')
    if (repos.length === 0) return null
    const tabs = repos.map((r, i) => ({ id: i + 1, path: r.path, name: r.name }))
    const active = tabs[typeof raw?.active === 'number' ? raw.active : 0]?.id ?? 1
    return { tabs, active, closed: [], nextId: tabs.length + 1 }
  } catch {
    return null
  }
}
