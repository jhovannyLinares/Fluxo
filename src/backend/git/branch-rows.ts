import type { GraphRow, RefLabel } from '@shared/graph-types'

const isBranchLabel = (r: RefLabel) => r.kind === 'local' || r.kind === 'remote' || r.kind === 'head'

/**
 * B11: fila «dueña» de cada commit, con esta regla: una fila con etiqueta de rama es su propia dueña;
 * las demás heredan la dueña de un hijo, primero el hijo del que son primer padre y, entre iguales, el de más arriba.
 * Los tags no cuentan como rama. -1 = sin dueña.
 */
export function rowOwners(rows: readonly GraphRow[]): Int32Array {
  const owners = new Int32Array(rows.length).fill(-1)
  // mejor candidato por padre pendiente: menor índice de padre gana; a igualdad, el primero visto (más arriba)
  const best = new Map<string, { score: number; owner: number }>()
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!
    const inherited = best.get(row.hash)
    best.delete(row.hash)
    const owner = row.refs.some(isBranchLabel) ? r : (inherited?.owner ?? -1)
    owners[r] = owner
    if (owner < 0) continue
    // con commits agrupados, la línea sigue por los padres del más viejo del grupo
    const line = row.group?.parents ?? row.parents
    line.forEach((p, score) => {
      const cur = best.get(p)
      if (!cur || score < cur.score) best.set(p, { score, owner })
    })
  }
  return owners
}

/** `refs/heads/x` → rama local `x`; `refs/remotes/origin/x` → remota `origin/x`; otra cosa → null. */
export function branchLabel(ref: string): RefLabel | null {
  if (ref.startsWith('refs/heads/')) return { name: ref.slice('refs/heads/'.length), kind: 'local' }
  if (ref.startsWith('refs/remotes/')) return { name: ref.slice('refs/remotes/'.length), kind: 'remote' }
  return null
}

/** Índices de las filas que son de la rama `ref` (nombre completo), en orden. */
export function branchRows(rows: readonly GraphRow[], ref: string, owners = rowOwners(rows)): number[] {
  const label = branchLabel(ref)
  if (!label) return []
  const ownsBranch = new Map<number, boolean>()
  const out: number[] = []
  for (let r = 0; r < rows.length; r++) {
    const o = owners[r]!
    if (o < 0) continue
    let yes = ownsBranch.get(o)
    if (yes === undefined) {
      yes = rows[o]!.refs.some((x) => x.kind === label.kind && x.name === label.name)
      ownsBranch.set(o, yes)
    }
    if (yes) out.push(r)
  }
  return out
}
