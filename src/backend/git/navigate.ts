import type { GraphRow } from '@shared/graph-types'

/** hash → fila, por arreglo de filas: se arma una vez por versión del grafo */
const indexCache = new WeakMap<GraphRow[], Map<string, number>>()

/** Fila de un commit en las filas cargadas (clic en una rama del panel, H16). */
export function indexOf(rows: GraphRow[], hash: string): number | null {
  let map = indexCache.get(rows)
  if (!map) {
    map = new Map(rows.map((r, i) => [r.hash, i]))
    indexCache.set(rows, map)
  }
  return map.get(hash) ?? null
}

/**
 * Navegar por la rama (H12, C22: Shift+↑/↓).
 * - parent: el primer padre (bajar por la misma rama).
 * - child: el commit más cercano por encima cuyo primer padre es este (subir por la rama).
 * Devuelve null si no hay (raíz, punta de rama o padre fuera de lo cargado).
 */
export function branchNeighbor(rows: GraphRow[], index: number, dir: 'parent' | 'child'): number | null {
  const row = rows[index]
  if (!row) return null
  if (dir === 'parent') {
    const first = (row.group?.parents ?? row.parents)[0]
    return first ? indexOf(rows, first) : null
  }
  // en orden topológico los hijos están arriba: el más cercano sigue la línea de la rama
  for (let i = index - 1; i >= 0; i--) if ((rows[i]!.group?.parents ?? rows[i]!.parents)[0] === row.hash) return i
  return null
}
