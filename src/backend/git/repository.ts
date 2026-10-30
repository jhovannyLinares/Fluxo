import { existsSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { AppException } from '@shared/errors'
import { DEFAULT_FILTER, WIP_HASH, type GraphFilter, type GraphRow } from '@shared/graph-types'
import { runGit, runGitOk } from './runner'
import { LOG_FORMAT, parseLog, type RawCommit } from './parsers/log'
import { REFS_FORMAT, parseRefs } from './parsers/refs'
import { buildGraph, collapseRuns } from './graph-builder'

export interface OpenRepo {
  id: string
  root: string
  name: string
  rows: GraphRow[] | null
  maxLanes: number
}

/** Valida carpeta como repo y devuelve raíz real (no confía en ruta enviada por UI). */
export async function resolveRepoRoot(path: string): Promise<string> {
  // un reciente que se movió o borró no es "no es repo": se dice tal cual
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new AppException({
      code: 'PATH_NOT_FOUND',
      message: 'La carpeta no existe.',
      gitOutput: path,
      suggestion: 'Puede que se haya movido o borrado. Quítala de recientes o elige otra carpeta.'
    })
  }
  // la carpeta .git misma: se abre su proyecto
  if (basename(path).toLowerCase() === '.git') return resolveRepoRoot(dirname(path))
  const r = await runGit(['rev-parse', '--show-toplevel'], { cwd: path, timeoutMs: 10_000 })
  if (r.code !== 0) {
    const bare = await runGit(['rev-parse', '--is-bare-repository'], { cwd: path, timeoutMs: 10_000 })
    if (bare.code === 0 && bare.stdout.trim() === 'true') {
      throw new AppException({
        code: 'BARE_REPO',
        message: 'Es un repositorio sin árbol de trabajo (bare).',
        gitOutput: r.stderr.trim(),
        suggestion: 'Fluxo muestra repos con árbol de trabajo: abre un clon normal o un worktree de este repo.'
      })
    }
    throw new AppException({
      code: 'NOT_A_REPO',
      message: 'Carpeta seleccionada no es repositorio git.',
      gitOutput: r.stderr.trim(),
      suggestion: 'Elige carpeta raíz del proyecto (la que contiene .git) o clónalo primero.'
    })
  }
  return r.stdout.trim()
}

export async function readHead(root: string): Promise<{ ref: string | null; hash: string | null }> {
  const [ref, hash] = await Promise.all([
    runGit(['symbolic-ref', '-q', 'HEAD'], { cwd: root }),
    runGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: root })
  ])
  return {
    ref: ref.code === 0 ? ref.stdout.trim() : null,
    hash: hash.code === 0 ? hash.stdout.trim() : null
  }
}

export function repoName(root: string): string {
  return basename(root)
}

/**
 * Lee historial y calcula grafo. Con `limit` solo lee primeros N commits:
 * carriles de filas superiores dependen solo de commits por encima, así que
 * primera página es exacta y aparece en ~0.2–0.5 s aun en repos de 100k (spike S1).
 */
export interface LoadedGraph {
  rows: GraphRow[]
  maxLanes: number
  gitMs: number
  buildMs: number
  /** ramas (locales y remotas) que se ven de las que hay (C21: «Viendo N/M») */
  branches: { visible: number; total: number }
}

/** Ramas que entran en «actual y relacionadas» (C9): la de HEAD, su upstream y la rama por defecto local y remota. */
async function relatedRefs(root: string, headRef: string | null, allRefs: Set<string>): Promise<string[]> {
  const [upstream, originHead] = await Promise.all([
    runGit(['rev-parse', '--symbolic-full-name', '@{upstream}'], { cwd: root }),
    runGit(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd: root })
  ])
  const out = new Set<string>()
  if (headRef) out.add(headRef)
  if (upstream.code === 0 && upstream.stdout.trim()) out.add(upstream.stdout.trim())
  const def = originHead.code === 0 ? originHead.stdout.trim().replace('refs/remotes/origin/', '') : null
  for (const name of def ? [def] : ['main', 'master']) {
    for (const r of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) if (allRefs.has(r)) out.add(r)
  }
  return [...out].filter((r) => allRefs.has(r))
}

export async function loadGraph(root: string, limit?: number, filter: GraphFilter = DEFAULT_FILTER): Promise<LoadedGraph> {
  const t0 = performance.now()
  const head = await readHead(root)
  const empty = { rows: [], maxLanes: 0, gitMs: 0, buildMs: 0, branches: { visible: 0, total: 0 } }
  if (!head.hash) return empty // repo sin commits

  // refs primero: el filtro necesita saber qué ramas existen
  const refsOut = await runGitOk(['for-each-ref', `--format=${REFS_FORMAT}`], { cwd: root })
  const refLines = refsOut.split('\n').filter(Boolean).map((l) => l.split('\0') as [string, string, string])
  const isBranch = (r: string) => (r.startsWith('refs/heads/') || r.startsWith('refs/remotes/')) && !r.endsWith('/HEAD')
  const branchRefs = refLines.map((l) => l[2]).filter(isBranch)
  const allRefs = new Set(refLines.map((l) => l[2]))
  const hidden = new Set(filter.hidden.filter((r) => allRefs.has(r)))

  let selection: string[]
  if (filter.mode === 'current') {
    const related = await relatedRefs(root, head.ref, allRefs)
    selection = ['--end-of-options', 'HEAD', ...related]
  } else {
    // --exclude va antes de --all; los nombres de rama no admiten comodines de glob (*, ?, [)
    selection = [...[...hidden].map((r) => `--exclude=${r}`), '--all', '--end-of-options']
  }
  const visibleBranches =
    filter.mode === 'current'
      ? selection.filter(isBranch).length
      : branchRefs.filter((r) => !hidden.has(r)).length

  const range = limit ? ['-n', String(limit)] : []
  const [logOut, wip] = await Promise.all([
    runGitOk(['log', '--topo-order', ...range, `--format=${LOG_FORMAT}`, ...selection], {
      cwd: root,
      timeoutMs: 120_000
    }),
    readWip(root)
  ])
  // `--all` no incluye HEAD desacoplado: se agrega si falta
  let raw = parseLog(logOut)
  if (!limit && !raw.some((c) => c.hash === head.hash)) {
    const extra = await runGitOk(['log', '--topo-order', `--format=${LOG_FORMAT}`, head.hash, '--not', '--all'], { cwd: root })
    raw = [...parseLog(extra), ...raw]
  }
  // H14: cambios sin commit = commit sintético arriba de todo, hijo de HEAD; los carriles salen solos
  if (wip) {
    const now = Math.floor(Date.now() / 1000)
    raw = [{ hash: WIP_HASH, parents: [head.hash], author: '', email: '', time: now, subject: '', coAuthors: '' }, ...raw]
  }
  const t1 = performance.now()
  // etiquetas de ramas ocultas no se pintan
  const shownRefs = refLines.filter((l) => !hidden.has(l[2])).map((l) => l.join('\0')).join('\n')
  const refs = parseRefs(shownRefs, head.ref, head.hash)
  // commits seguidos del mismo autor en una fila: el grafo se arma con los padres del más viejo de cada grupo
  // y después cada fila vuelve a tener los padres reales del commit que muestra
  const collapsed = filter.collapse ? collapseRuns(raw, refs) : null
  if (collapsed) raw = collapsed.commits
  const { rows, maxLanes } = buildGraph(raw, refs, pinnedChain(filter.pinned, refLines, raw))
  if (collapsed)
    for (const r of rows) {
      const g = collapsed.groups.get(r.hash)
      if (g) Object.assign(r, { group: { count: g.count, parents: r.parents }, parents: g.parents })
    }
  if (wip) Object.assign(rows[0]!, { kind: 'wip', wip })
  for (const r of rows) if (r.refs.some((ref) => ref.kind === 'stash')) r.kind = 'stash'
  const t2 = performance.now()
  return { rows, maxLanes, gitMs: t1 - t0, buildMs: t2 - t1, branches: { visible: visibleBranches, total: branchRefs.length } }
}

/** A5: commits de la rama anclada siguiendo primeros padres dentro de lo cargado. */
function pinnedChain(pinned: string | null, refLines: [string, string, string][], raw: RawCommit[]): Set<string> {
  const chain = new Set<string>()
  const line = pinned ? refLines.find((l) => l[2] === pinned) : undefined
  if (!line) return chain
  const firstParent = new Map(raw.map((c) => [c.hash, c.parents[0]]))
  for (let h: string | undefined = line[1] || line[0]; h && firstParent.has(h) && !chain.has(h); h = firstParent.get(h)) chain.add(h)
  return chain
}

/** Conteo de cambios sin commit (H14); null si el árbol está limpio. Respeta .gitignore y no toma locks. */
export async function readWip(root: string): Promise<GraphRow['wip'] | null> {
  const out = await runGitOk(['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--no-renames'], { cwd: root })
  const counts = { staged: 0, unstaged: 0, untracked: 0 }
  for (const e of out.split('\0')) {
    if (e.length < 3) continue
    if (e.startsWith('??')) counts.untracked++
    else {
      if (e[0] !== ' ') counts.staged++
      if (e[1] !== ' ') counts.unstaged++
    }
  }
  return counts.staged + counts.unstaged + counts.untracked > 0 ? counts : null
}
