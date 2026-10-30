import { DEFAULT_FILTER, GraphFilterSchema, type GraphFilter } from '@shared/graph-types'

/**
 * Filtro de ramas por repo (H15), en el almacenamiento local de la ventana: es una comodidad de vista,
 * no un dato que deba sobrevivir a todo. Si no se puede leer o está dañado, se ven todas las ramas.
 */
const key = (root: string) => `fluxo.filter.${root.replace(/\\/g, '/').toLowerCase()}`

export function loadFilter(root: string): GraphFilter {
  try {
    const raw = localStorage.getItem(key(root))
    const r = raw ? GraphFilterSchema.safeParse(JSON.parse(raw)) : null
    return r?.success ? r.data : DEFAULT_FILTER
  } catch {
    return DEFAULT_FILTER
  }
}

export function saveFilter(root: string, filter: GraphFilter): void {
  try {
    localStorage.setItem(key(root), JSON.stringify(filter))
  } catch {
    // sin almacenamiento local el filtro dura hasta cerrar la app
  }
}

export const isFiltered = (f: GraphFilter) => f.mode !== 'all' || f.hidden.length > 0

/** Ocultar una píldora = ocultar todas sus refs (local y remotas). */
export function hideRefs(f: GraphFilter, refs: string[]): GraphFilter {
  return { ...f, hidden: [...new Set([...f.hidden, ...refs])] }
}
