/**
 * Anchos de las columnas del grafo elegidos con los divisores de la cabecera. Una columna sin ancho guardado
 * usa el de fábrica (`columnsFor`). El mensaje no tiene ancho propio: ocupa lo que dejan las demás, y su borde
 * derecho es el divisor de la columna de autor.
 */
export type ColumnId = 'refs' | 'graph' | 'author' | 'date'
export type ColumnSizes = Partial<Record<ColumnId, number>>

export const COLUMN_LIMITS: Record<ColumnId, readonly [number, number]> = {
  refs: [60, 400],
  graph: [24, 600],
  author: [60, 400],
  date: [60, 300]
}

const KEY = 'fluxo.graph.columns'

export function clampColumn(id: ColumnId, want: number): number {
  const [min, max] = COLUMN_LIMITS[id]
  return Math.round(Math.max(min, Math.min(max, want)))
}

/** Lo guardado; un valor dañado o fuera de rango se descarta solo en esa columna. */
export function loadColumnSizes(): ColumnSizes {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null
    const out: ColumnSizes = {}
    for (const id of Object.keys(COLUMN_LIMITS) as ColumnId[]) {
      const v = raw?.[id]
      if (typeof v === 'number' && v >= COLUMN_LIMITS[id][0] && v <= COLUMN_LIMITS[id][1]) out[id] = v
    }
    return out
  } catch {
    return {}
  }
}

export function saveColumnSizes(sizes: ColumnSizes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sizes))
  } catch {
    // solo se pierden los anchos recordados
  }
}
