import type { RefLabel } from '@shared/graph-types'

/** Una píldora de la columna de etiquetas (H13). */
export interface DisplayRef {
  kind: 'branch' | 'tag' | 'stash' | 'head'
  name: string
  /** existe como rama local */
  local: boolean
  /** remotos donde la misma rama apunta a este commit (C2: local y remota fundidas) */
  remotes: string[]
  /** rama de HEAD (C4: ✓) */
  current: boolean
  /** nombres completos que agrupa la píldora (`refs/heads/x`, `refs/remotes/origin/x`): ocultar o anclar (H15) */
  refs: string[]
}

// la rama local que también está en un remoto va antes que las solo locales: es la que se comparte
const RANK = { current: 0, synced: 1, local: 1.5, remote: 2, tag: 3, stash: 4, head: -1 } as const

/**
 * Refs de un commit → píldoras (C1–C4).
 * - local + `remoto/misma` en el mismo commit → una píldora con los dos iconos.
 * - remota sin local igual → píldora propia `origin/x`.
 * - HEAD apuntando a rama → ✓ en esa rama; HEAD desacoplado → píldora HEAD.
 */
export function groupRefs(refs: readonly RefLabel[]): DisplayRef[] {
  const head = refs.find((r) => r.kind === 'head')
  const detached = head && head.name !== 'HEAD'
  // parseRefs pone la rama de HEAD justo después de HEAD
  const currentBranch = head && !detached ? refs.find((r) => r.kind === 'local')?.name : undefined
  const locals = refs.filter((r) => r.kind === 'local').map((r) => r.name)
  const out: DisplayRef[] = []
  const usedRemotes = new Set<string>()

  for (const name of locals) {
    const remotes: string[] = []
    for (const r of refs) {
      if (r.kind !== 'remote') continue
      const slash = r.name.indexOf('/')
      if (slash > 0 && r.name.slice(slash + 1) === name) {
        remotes.push(r.name.slice(0, slash))
        usedRemotes.add(r.name)
      }
    }
    out.push({
      kind: 'branch',
      name,
      local: true,
      remotes,
      current: name === currentBranch,
      refs: [`refs/heads/${name}`, ...remotes.map((rm) => `refs/remotes/${rm}/${name}`)]
    })
  }
  for (const r of refs) {
    if (r.kind === 'remote' && !usedRemotes.has(r.name)) {
      const remotes = [r.name.slice(0, r.name.indexOf('/'))]
      out.push({ kind: 'branch', name: r.name, local: false, remotes, current: false, refs: [`refs/remotes/${r.name}`] })
    } else if (r.kind === 'tag') {
      out.push({ kind: 'tag', name: r.name, local: false, remotes: [], current: false, refs: [`refs/tags/${r.name}`] })
    } else if (r.kind === 'stash') {
      out.push({ kind: 'stash', name: r.name, local: false, remotes: [], current: false, refs: [] })
    }
  }
  if (detached) {
    out.push({ kind: 'head', name: `HEAD ${head.name.replace(/^HEAD \((\w+)\)$/, '$1')}`, local: false, remotes: [], current: true, refs: [] })
  }

  const rank = (d: DisplayRef) =>
    d.kind === 'head'
      ? RANK.head
      : d.current
        ? RANK.current
        : d.kind === 'branch'
          ? d.local
            ? d.remotes.length
              ? RANK.synced
              : RANK.local
            : RANK.remote
          : RANK[d.kind]
  return out.sort((a, b) => rank(a) - rank(b))
}

/**
 * Rama a la que lleva el doble clic sobre la columna de etiquetas: la píldora que se ve (la primera, sin contar
 * HEAD desacoplado), si es una rama y no es ya la actual. Tags y stash no cambian de rama: null.
 */
export function checkoutTarget(list: readonly DisplayRef[]): string | null {
  const d = list.find((x) => x.kind !== 'head')
  return d?.kind === 'branch' && !d.current ? (d.refs[0] ?? null) : null
}

/** Texto del tooltip de la columna (C3: «+N» muestra la lista al pasar el ratón). */
export function refsTooltip(list: readonly DisplayRef[]): string {
  return list
    .map((d) => {
      const where = d.kind === 'branch' ? [d.local ? 'local' : '', ...d.remotes].filter(Boolean).join(' + ') : d.kind
      return `${d.current ? '✓ ' : ''}${d.name} (${where})`
    })
    .join('\n')
}
