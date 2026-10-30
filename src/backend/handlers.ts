import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AppException, SUPERSEDED, toAppError } from '@shared/errors'
import { DEFAULT_FILTER, type GraphFilter, type GraphRow } from '@shared/graph-types'
import { contracts, isChannel, type Channel, type Req, type Res, type RpcResult } from '@shared/ipc-contracts'
import { checkEnvironment } from './environment/detect'
import { emit } from './events'
import { cloneInto, cloneTarget } from './git/clone'
import { commitDetail, commitTree } from './git/commit-detail'
import { fileDiff } from './git/diff'
import { compareDiff, compareWorktree } from './git/compare'
import { gitDirOf, readOperation } from './git/operation'
import { webLink } from './git/web-links'
import { wipDiff, wipFiles } from './git/wip'
import { commit, lastCommit, stage, unstage } from './git/commit-write'
import { fetchAll } from './git/fetch'
import { pull } from './git/pull'
import { createBranch, deleteBranch, renameBranch, setUpstream } from './git/branch'
import { readConflict, resolveAll, saveConflict, takeSide } from './git/conflicts'
import { addRemote, editRemote, fetchRemote, listRemotes, removeRemote } from './git/remotes'
import { undoInfo, undoRedo } from './git/undo'
import { initRepo } from './git/init'
import { azureProjects, createRemoteRepo } from './git/remote-create'
import { addSubmodule, deleteSubmodule, editSubmodule, updateSubmodule } from './git/submodules'
import { lockWorktree, removeWorktree } from './git/worktrees'
import { moveCommit, rebaseInteractive, rebasePlan } from './git/interactive'
import { pullBranch, pushBranch } from './git/other-branch'
import { integrate, operation } from './git/integrate'
import { addWorktree, checkoutCommit, createTag, deleteTag, dropCommit, editMessage, pushTag, resetTo, restoreFiles, revertCommit, tagsOnRemote } from './git/history'
import { applyStash, createStash, dropStash, renameStash } from './git/stash'
import { createFile, deleteFile, discard, ignore, stagePatch } from './git/local-changes'
import { checkout } from './git/checkout'
import { push, pushTarget } from './git/push'
import { cherryPick, inHistory } from './git/cherry-pick'
import { squash, squashBlocker } from './git/squash'
import { fileBlame, fileHistory, searchFiles } from './git/file-history'
import { githubLogin, githubLogout, listAccounts, testRemote } from './git/accounts'
import { prCreate, prPrepare } from './git/pr-create'
import { accountAccess, reloginAccount, repoAccount, setRepoAccount } from './git/repo-account'
import { listPullRequests } from './git/pull-requests'
import { repoSummary } from './git/summary'
import { branchNeighbor, indexOf } from './git/navigate'
import { searchGraph } from './git/graph-search'
import { branchRows, rowOwners } from './git/branch-rows'
import { listRefs } from './git/refs-list'
import { loadGraph, readHead, readWip, repoName, resolveRepoRoot } from './git/repository'
import { writeOp } from './git/write-queue'
import { RepoWatcher, type ChangeKind, type WatchOptions } from './git/watcher'

/** Primera página del grafo: suficiente para llenar pantalla varias veces. */
export const FIRST_PAGE = 2000

interface OpenRepo {
  id: string
  root: string
  name: string
  rows: GraphRow[]
  maxLanes: number
  /** sube cada vez que cambian las filas: el renderer descarta bloques de una versión vieja */
  version: number
  /** sube en cada carga desde git; una carga que termina tarde no pisa a otra más nueva */
  loadId: number
  /** filtro de ramas con que se cargaron las filas (H15) */
  filter: GraphFilter
  branches: { visible: number; total: number }
  /** H20/A3: refresco en vivo corriendo y tipos de cambio que esperan al siguiente */
  refreshing: boolean
  pendingKinds: Set<ChangeKind>
  /** H21: gitDir absoluto, para ver si hay una operación en curso */
  gitDir: string
  /** las filas son el historial entero (no solo la primera página) con el filtro vigente */
  complete: boolean
}

const sameFilter = (a: GraphFilter, b: GraphFilter) => JSON.stringify(a) === JSON.stringify(b)

const repos = new Map<string, OpenRepo>()
/** B11: dueña de cada fila, una vez por juego de filas; pasar de una rama a otra solo filtra */
const ownersCache = new WeakMap<GraphRow[], Int32Array>()
let nextId = 1

function getRepo(id: string): OpenRepo {
  const repo = repos.get(id)
  if (!repo) throw new AppException({ code: 'REPO_NOT_OPEN', message: 'Repositorio no está abierto.' })
  return repo
}

const graphInfo = (repo: OpenRepo, partial: boolean, gitMs = 0, buildMs = 0) => ({
  total: repo.rows.length,
  maxLanes: repo.maxLanes,
  gitMs,
  buildMs,
  partial,
  version: repo.version,
  branches: repo.branches
})

/** Historial completo en segundo plano; si nadie cargó otra cosa entretanto, lo publica con evento `graph:full`. */
function loadFullInBackground(repo: OpenRepo, loadId: number): void {
  void loadGraph(repo.root, undefined, repo.filter).then(
    (full) => {
      if (repo.loadId !== loadId) return
      // la fila WIP pudo cambiar mientras cargaba (H20): se conserva la más reciente
      const top = repo.rows[0]
      if (top?.kind === 'wip' && full.rows[0]?.kind === 'wip') full.rows[0].wip = top.wip
      repo.version++
      repo.rows = full.rows
      repo.maxLanes = full.maxLanes
      repo.complete = true
      emit({
        type: 'graph:full',
        repoId: repo.id,
        version: repo.version,
        total: full.rows.length,
        maxLanes: full.maxLanes,
        gitMs: full.gitMs,
        buildMs: full.buildMs
      })
    },
    (err) => {
      if (repo.loadId === loadId) emit({ type: 'graph:error', repoId: repo.id, error: toAppError(err) })
    }
  )
}

/** Primera página con `filter` (graph:load y recarga en vivo); el resto llega por `graph:full`. */
async function loadFirstPage(repo: OpenRepo, filter: GraphFilter): Promise<Res<'graph:load'>> {
  const loadId = ++repo.loadId
  repo.filter = filter
  repo.complete = false
  const first = await loadGraph(repo.root, FIRST_PAGE, filter)
  if (repo.loadId !== loadId) throw new AppException({ code: 'INTERNAL', message: SUPERSEDED })
  repo.version++
  repo.rows = first.rows
  repo.maxLanes = first.maxLanes
  repo.branches = first.branches
  const partial = first.rows.length >= FIRST_PAGE
  if (partial) loadFullInBackground(repo, loadId)
  else repo.complete = true
  return graphInfo(repo, partial, first.gitMs, first.buildMs)
}

// H20: se vigilan todos los repos con pestaña abierta, así al volver a una ya está al día
const watched = new Map<OpenRepo, RepoWatcher>()
let watchOptions: WatchOptions = {}

/** Pruebas: tiempos cortos de vigilancia. */
export function setWatchOptions(opts: WatchOptions): void {
  watchOptions = opts
}

/** Cierra la vigilancia de un repo, o de todos (al salir y en pruebas, antes de borrar la carpeta). */
export function stopWatching(repo?: OpenRepo): void {
  for (const [r, w] of watched) {
    if (repo && r !== repo) continue
    w.close()
    watched.delete(r)
  }
}

/** Vigilado y sin caer: sus filas en memoria siguen al día sin preguntarle a git. */
const isLive = (repo: OpenRepo) => {
  const mode = watched.get(repo)?.mode
  return mode === 'watching' || mode === 'polling'
}

/** A4: el repo se borró o se movió; se deja de vigilar y la UI lo dice. */
function checkGone(repo: OpenRepo): boolean {
  if (existsSync(join(repo.root, '.git'))) return false
  stopWatching(repo)
  emit({ type: 'repo:gone', repoId: repo.id, root: repo.root })
  return true
}

/**
 * A3: un refresco corriendo y, como mucho, uno esperando con todos los tipos que llegaron entretanto:
 * 30 commits seguidos dan 2 o 3 recargas, no 30.
 */
async function onRepoChange(repo: OpenRepo, kinds: ChangeKind[]): Promise<void> {
  for (const k of kinds) repo.pendingKinds.add(k)
  if (repo.refreshing) return
  repo.refreshing = true
  try {
    while (repo.pendingKinds.size > 0) {
      const batch = [...repo.pendingKinds]
      repo.pendingKinds.clear()
      await refresh(repo, batch).catch((err) => {
        if (!checkGone(repo)) emit({ type: 'graph:error', repoId: repo.id, error: toAppError(err) })
      })
    }
  } finally {
    repo.refreshing = false
  }
}

/** Refresco por tipo (A3): solo WIP/index actualiza la fila WIP sin ir a git log; refs o HEAD recargan el grafo. */
async function refresh(repo: OpenRepo, kinds: ChangeKind[]): Promise<void> {
  if (checkGone(repo)) return
  // H21: los conflictos cambian con el index, la operación con sus archivos de marca
  const operation = await readOperation(repo.root, repo.gitDir)
  if (kinds.every((k) => k === 'worktree' || k === 'index' || k === 'operation')) {
    const wip = await readWip(repo.root)
    const top = repo.rows[0]
    if ((top?.kind === 'wip') === !!wip) {
      if (wip && top) top.wip = wip
      if (wip || kinds.includes('operation')) {
        repo.version++
        const graph = graphInfo(repo, repo.rows.length >= FIRST_PAGE)
        emit({ type: 'repo:changed', repoId: repo.id, kinds, graph, operation })
      }
      return
    }
  }
  const graph = await loadFirstPage(repo, repo.filter)
  emit({ type: 'repo:changed', repoId: repo.id, kinds, graph, operation })
}

type Handlers = { [C in Channel]?: (req: Req<C>) => Promise<Res<C>> }

const handlers: Handlers = {
  'app:ping': async () => ({ pong: true, backendPid: process.pid }),

  'env:check': async () => checkEnvironment(),

  'repo:open': async ({ path }) => {
    const root = await resolveRepoRoot(path)
    let repo = [...repos.values()].find((r) => r.root === root)
    if (!repo) {
      repo = {
        id: `r${nextId++}`,
        root,
        name: repoName(root),
        rows: [],
        maxLanes: 0,
        version: 0,
        loadId: 0,
        filter: DEFAULT_FILTER,
        branches: { visible: 0, total: 0 },
        refreshing: false,
        pendingKinds: new Set(),
        gitDir: await gitDirOf(root),
        complete: false
      }
      repos.set(repo.id, repo)
    }
    const [head, operation] = await Promise.all([readHead(root), readOperation(root, repo.gitDir)])
    return { repoId: repo.id, root, name: repo.name, head: head.ref, operation }
  },

  'repo:watch': async ({ repoId }) => {
    const repo = getRepo(repoId)
    const live = watched.get(repo)
    if (live && live.mode !== 'closed') return { mode: live.mode }
    stopWatching(repo)
    const watcher = await RepoWatcher.start(repo.root, (c) => void onRepoChange(repo, c.kinds), {
      ...watchOptions,
      // A4: un error de vigilancia puede ser que el repo ya no está
      onError: () => void checkGone(repo),
      // A2: fs.watch sordo o caído → la UI avisa que pasó a sondeo
      onMode: (mode) => emit({ type: 'repo:watch', repoId: repo.id, mode })
    })
    watched.set(repo, watcher)
    return { mode: watcher.mode }
  },

  // pestañas cerradas o que cambiaron de repo: se deja de vigilar lo que ya no está en ninguna
  'repo:watchKeep': async ({ roots }) => {
    // Windows: la misma carpeta puede llegar con otra capitalización
    const keep = new Set(roots.map((r) => r.toLowerCase()))
    for (const r of [...watched.keys()]) if (!keep.has(r.root.toLowerCase())) stopWatching(r)
    return { watching: watched.size }
  },

  'graph:load': async ({ repoId, reuse, filter = DEFAULT_FILTER }) => {
    const repo = getRepo(repoId)
    // N12: repo ya cargado en esta sesión con el mismo filtro → se muestra al instante lo que hay y se recarga
    // en segundo plano, sin subir la versión (las filas en memoria siguen sirviendo hasta que llegue la nueva)
    if (reuse && repo.rows.length > 0 && sameFilter(repo.filter, filter)) {
      // vigilado y con el historial entero: lo que hay en memoria ya es lo vigente, no se vuelve a git
      if (repo.complete && isLive(repo)) return graphInfo(repo, false)
      loadFullInBackground(repo, ++repo.loadId)
      return graphInfo(repo, true)
    }
    return loadFirstPage(repo, filter)
  },

  // las escrituras pasan por la fila del repo (una a la vez) y quedan en la bitácora
  'repo:fetch': async ({ repoId, auto }) => {
    const root = getRepo(repoId).root
    return writeOp(root, 'fetch', { auto, network: true }, () => fetchAll(root, auto))
  },

  'repo:pull': async ({ repoId, mode }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `pull ${mode}`, { network: true }, () => pull(root, mode))
  },

  'repo:checkout': async ({ repoId, ref }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `checkout ${ref}`, {}, () => checkout(root, ref))
  },

  'repo:createBranch': async ({ repoId, name, at }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `create branch ${name}`, {}, () => createBranch(root, name, at))
  },

  'repo:renameBranch': async ({ repoId, from, to }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `rename branch ${from} ${to}`, {}, () => renameBranch(root, from, to))
  },

  'repo:deleteBranch': async ({ repoId, name, scope, remote }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `delete branch ${name}`, { network: scope !== 'local' }, () => deleteBranch(root, name, scope, remote))
  },

  'repo:setUpstream': async ({ repoId, branch, remote, remoteBranch }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `set upstream ${branch}`, {}, () => setUpstream(root, branch, remote, remoteBranch))
  },

  'repo:integrate': async ({ repoId, kind, ref }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `${kind} ${ref}`, {}, () => integrate(root, kind, ref))
  },

  'repo:operation': async ({ repoId, action }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `operation ${action}`, {}, () => operation(root, action))
  },

  'repo:reset': async ({ repoId, hash, mode }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `reset ${mode} ${hash.slice(0, 7)}`, {}, () => resetTo(root, hash, mode))
  },

  'repo:revert': async ({ repoId, hash }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `revert ${hash.slice(0, 7)}`, {}, () => revertCommit(root, hash))
  },

  'repo:createTag': async ({ repoId, hash, name, message }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `create tag ${name}`, {}, () => createTag(root, hash, name, message))
  },

  'repo:checkoutCommit': async ({ repoId, hash }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `checkout commit ${hash.slice(0, 7)}`, {}, () => checkoutCommit(root, hash))
  },

  'repo:addWorktree': async ({ repoId, path, ref, hash, newBranch }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `add worktree ${path}`, {}, () => addWorktree(root, path, { ref, hash, newBranch }))
  },

  'repo:editMessage': async ({ repoId, hash, message }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `edit message ${hash.slice(0, 7)}`, {}, () => editMessage(root, hash, message))
  },

  'repo:dropCommit': async ({ repoId, hash }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `drop commit ${hash.slice(0, 7)}`, {}, () => dropCommit(root, hash))
  },

  'repo:rebasePlan': async ({ repoId, ref }) => rebasePlan(getRepo(repoId).root, ref),

  'repo:rebaseInteractive': async ({ repoId, ref, steps }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `interactive rebase ${ref}`, {}, () => rebaseInteractive(root, ref, steps))
  },

  'repo:moveCommit': async ({ repoId, hash, dir }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `move commit ${hash.slice(0, 7)} ${dir}`, {}, () => moveCommit(root, hash, dir))
  },

  'repo:pullBranch': async ({ repoId, branch }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `pull branch ${branch}`, { network: true }, () => pullBranch(root, branch))
  },

  'repo:pushBranch': async ({ repoId, branch, to }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `push branch ${branch}`, { network: true }, () => pushBranch(root, branch, to))
  },

  'conflict:read': async ({ repoId, path }) => readConflict(getRepo(repoId).root, path),

  'conflict:save': async ({ repoId, path, content }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `resolve conflict ${path}`, {}, () => saveConflict(root, path, content))
  },

  'conflict:take': async ({ repoId, path, side }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `take ${side} ${path}`, {}, () => takeSide(root, path, side))
  },

  'conflict:resolveAll': async ({ repoId }) => {
    const root = getRepo(repoId).root
    return writeOp(root, 'mark all resolved', {}, () => resolveAll(root))
  },

  'repo:undoInfo': async ({ repoId }) => undoInfo(getRepo(repoId).root),

  'repo:undo': async ({ repoId, action }) => {
    const root = getRepo(repoId).root
    return writeOp(root, action, {}, () => undoRedo(root, action))
  },

  'repo:deleteTag': async ({ repoId, name, scope, remote }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `delete tag ${name}`, { network: scope !== 'local' }, () => deleteTag(root, name, scope, remote))
  },

  'repo:pushTag': async ({ repoId, name, remote }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `push tag ${name}`, { network: true }, () => pushTag(root, name, remote))
  },

  'repo:tagsOnRemote': async ({ repoId }) => tagsOnRemote(getRepo(repoId).root),

  'wip:restore': async ({ repoId, hash, paths }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `restore ${hash.slice(0, 7)}`, {}, () => restoreFiles(root, hash, paths))
  },

  'repo:remotes': async ({ repoId }) => ({ remotes: await listRemotes(getRepo(repoId).root) }),

  'remote:add': async ({ repoId, name, pullUrl, pushUrl }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `add remote ${name}`, {}, () => addRemote(root, name, pullUrl, pushUrl))
  },

  'remote:edit': async ({ repoId, name, newName, pullUrl, pushUrl }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `edit remote ${name}`, {}, () => editRemote(root, name, newName, pullUrl, pushUrl))
  },

  'remote:remove': async ({ repoId, name }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `remove remote ${name}`, {}, () => removeRemote(root, name))
  },

  'remote:fetch': async ({ repoId, name }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `fetch ${name}`, { network: true }, () => fetchRemote(root, name))
  },

  'worktree:remove': async ({ repoId, path, deleteBranch }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `remove worktree ${path}`, {}, () => removeWorktree(root, path, deleteBranch))
  },

  'submodule:add': async ({ repoId, url, path }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `add submodule ${path}`, { network: true }, () => addSubmodule(root, url, path))
  },

  'submodule:edit': async ({ repoId, path, url, newPath }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `edit submodule ${path}`, {}, () => editSubmodule(root, path, url, newPath))
  },

  'submodule:delete': async ({ repoId, path }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `delete submodule ${path}`, {}, () => deleteSubmodule(root, path))
  },

  'submodule:update': async ({ repoId, path, init }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `${init ? 'init' : 'update'} submodule ${path}`, { network: true }, () => updateSubmodule(root, path, init))
  },

  'worktree:lock': async ({ repoId, path, lock }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `${lock ? 'lock' : 'unlock'} worktree ${path}`, {}, () => lockWorktree(root, path, lock))
  },

  'repo:pushTarget': async ({ repoId }) => pushTarget(getRepo(repoId).root),

  'repo:push': async ({ repoId, to, forceExpected }) => {
    const root = getRepo(repoId).root
    const op = forceExpected ? 'push force-with-lease' : to ? `push → ${to.remote}/${to.branch}` : 'push'
    return writeOp(root, op, { network: true }, () => push(root, { to, forceExpected }))
  },

  'repo:cherryPick': async ({ repoId, hashes }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `cherry-pick ${hashes.length}`, {}, () => cherryPick(root, hashes))
  },

  'repo:inHistory': async ({ repoId, hashes }) => ({ hash: await inHistory(getRepo(repoId).root, hashes) }),

  'repo:squash': async ({ repoId, hashes }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `squash ${hashes.length}`, {}, () => squash(root, hashes))
  },

  'repo:squashCheck': async ({ repoId, hashes }) => ({ why: await squashBlocker(getRepo(repoId).root, hashes) }),

  'repo:pullRequests': async ({ repoId }) => listPullRequests(getRepo(repoId).root),

  'accounts:list': async () => listAccounts(),

  'accounts:githubLogin': async () => {
    await githubLogin()
    return { ok: true as const }
  },

  'accounts:githubLogout': async ({ account }) => {
    await githubLogout(account)
    return { ok: true as const }
  },

  'accounts:test': async ({ repoId, remote }) => testRemote(getRepo(repoId).root, remote),

  'repo:account': async ({ repoId }) => repoAccount(getRepo(repoId).root),

  'pr:prepare': async ({ repoId, head, base }) => prPrepare(getRepo(repoId).root, head, base),

  'pr:create': async ({ repoId, remote, ...req }) => {
    const root = getRepo(repoId).root
    return writeOp(root, `create pull request ${req.head} → ${req.base}`, { network: true }, () => prCreate(root, remote, req))
  },

  'repo:accountAccess': async ({ repoId }) => {
    const root = getRepo(repoId).root
    return { access: await accountAccess(root, (await repoAccount(root)).accounts) }
  },

  'repo:setAccount': async ({ repoId, account }) => {
    const root = getRepo(repoId).root
    await writeOp(root, `account ${account ?? 'auto'}`, {}, () => setRepoAccount(root, account))
    return { ok: true as const }
  },

  'accounts:relogin': async ({ account }) => {
    await reloginAccount(account)
    return { ok: true as const }
  },

  'file:search': async ({ repoId, query }) => ({ paths: await searchFiles(getRepo(repoId).root, query) }),

  'file:history': async ({ repoId, path }) => ({ entries: await fileHistory(getRepo(repoId).root, path) }),

  'file:blame': async ({ repoId, path }) => ({ lines: await fileBlame(getRepo(repoId).root, path) }),

  'repo:summary': async ({ path }) => ({ summary: await repoSummary(path) }),

  'graph:neighbor': async ({ repoId, index, dir }) => ({ index: branchNeighbor(getRepo(repoId).rows, index, dir) }),

  'graph:find': async ({ repoId, hash }) => ({ index: indexOf(getRepo(repoId).rows, hash) }),

  'graph:search': async ({ repoId, query }) => {
    const repo = getRepo(repoId)
    return { indices: await searchGraph(repo.root, repo.rows, query) }
  },

  'graph:branchRows': async ({ repoId, ref }) => {
    const rows = getRepo(repoId).rows
    let owners = ownersCache.get(rows)
    if (!owners) ownersCache.set(rows, (owners = rowOwners(rows)))
    return { indices: branchRows(rows, ref, owners) }
  },

  'refs:list': async ({ repoId }) => listRefs(getRepo(repoId).root),

  'commit:detail': async ({ repoId, hash, base }) => commitDetail(getRepo(repoId).root, hash, base),

  'commit:tree': async ({ repoId, hash }) => ({ paths: await commitTree(getRepo(repoId).root, hash) }),

  'commit:diff': async ({ repoId, ...req }) => fileDiff(getRepo(repoId).root, req),

  'commit:compare': async ({ repoId, hash, to }) => ({ files: await compareWorktree(getRepo(repoId).root, hash, to) }),

  'commit:compareDiff': async ({ repoId, ...req }) => compareDiff(getRepo(repoId).root, req),

  'wip:files': async ({ repoId }) => wipFiles(getRepo(repoId).root),

  'wip:stage': async ({ repoId, paths }) => {
    const root = getRepo(repoId).root
    await writeOp(root, paths ? `stage ${paths.length}` : 'stage all', {}, () => stage(root, paths))
    return { ok: true as const }
  },

  'wip:unstage': async ({ repoId, paths }) => {
    const root = getRepo(repoId).root
    await writeOp(root, paths ? `unstage ${paths.length}` : 'unstage all', {}, () => unstage(root, paths))
    return { ok: true as const }
  },

  'repo:stash': async ({ repoId, message, paths, includeUntracked }) => {
    const root = getRepo(repoId).root
    return writeOp(root, paths ? `stash ${paths.length} files` : 'stash', {}, () => createStash(root, { message, paths, includeUntracked }))
  },

  'repo:stashApply': async ({ repoId, hash, pop, paths }) => {
    const root = getRepo(repoId).root
    return writeOp(root, paths ? 'stash apply file' : pop ? 'stash pop' : 'stash apply', {}, () => applyStash(root, hash, pop, paths))
  },

  'repo:stashDrop': async ({ repoId, hash }) => {
    const root = getRepo(repoId).root
    return writeOp(root, 'stash drop', {}, () => dropStash(root, hash))
  },

  'repo:stashRename': async ({ repoId, hash, message }) => {
    const root = getRepo(repoId).root
    return writeOp(root, 'stash rename', {}, () => renameStash(root, hash, message))
  },

  'wip:discard': async ({ repoId, paths, patch }) => {
    const root = getRepo(repoId).root
    await writeOp(root, patch ? 'discard hunk' : paths ? `discard ${paths.length}` : 'discard all', {}, () => discard(root, paths, patch))
    return { ok: true as const }
  },

  'wip:stagePatch': async ({ repoId, patch, reverse }) => {
    const root = getRepo(repoId).root
    await writeOp(root, reverse ? 'unstage patch' : 'stage patch', {}, () => stagePatch(root, patch, reverse))
    return { ok: true as const }
  },

  'wip:ignore': async ({ repoId, pattern, stopTracking }) => {
    const root = getRepo(repoId).root
    return writeOp(root, stopTracking ? 'ignore and untrack' : 'ignore', {}, () => ignore(root, pattern, stopTracking))
  },

  'wip:createFile': async ({ repoId, path }) => {
    const root = getRepo(repoId).root
    return writeOp(root, 'create file', {}, () => createFile(root, path))
  },

  'wip:deleteFile': async ({ repoId, path }) => {
    const root = getRepo(repoId).root
    await writeOp(root, 'delete file', {}, () => deleteFile(root, path))
    return { ok: true as const }
  },

  'wip:lastCommit': async ({ repoId }) => ({ last: await lastCommit(getRepo(repoId).root) }),

  'wip:commit': async ({ repoId, message, amend }) => {
    const root = getRepo(repoId).root
    return writeOp(root, amend ? 'commit amend' : 'commit', {}, () => commit(root, message, amend))
  },

  'wip:diff': async ({ repoId, ...req }) => wipDiff(getRepo(repoId).root, req),

  'web:url': async ({ repoId, target }) => ({ url: await webLink(getRepo(repoId).root, target) }),

  'repo:clone': async ({ url, parent }) => {
    const dest = cloneTarget(url, parent)
    await writeOp(dest, 'clone', { network: true }, () => cloneInto(url.trim(), dest, (p) => emit({ type: 'clone:progress', ...p })))
    return { path: dest }
  },

  // la carpeta aún no existe: la bitácora la anota con su futura ruta (git -C sobre ella da 128 y queda sin HEAD «antes»)
  'repo:init': async (req) => writeOp(join(req.parent, req.name.trim()), 'init repository', {}, () => initRepo(req)),

  'repo:createRemote': async (req) => {
    // sin «Clone after init» no hay carpeta: la bitácora lo anota como proveedor://cuenta/nombre
    const where = req.parent ? join(req.parent, req.name.trim()) : `${req.provider}://${req.account}/${req.name}`
    return writeOp(where, `create ${req.provider} repository`, { network: true }, () => createRemoteRepo(req))
  },

  'azure:projects': async ({ org, account }) => ({ projects: await azureProjects(org, account) }),

  'graph:rows': async ({ repoId, offset, limit }) => {
    const repo = getRepo(repoId)
    return { offset, version: repo.version, rows: repo.rows.slice(offset, offset + limit) }
  }
}

/** Valida petición (segundo extremo), ejecuta y devuelve resultado con error estándar. */
export async function dispatch(channel: unknown, payload: unknown): Promise<RpcResult> {
  try {
    if (!isChannel(channel)) throw new AppException({ code: 'INVALID_REQUEST', message: 'Canal desconocido.' })
    const handler = handlers[channel] as ((req: unknown) => Promise<unknown>) | undefined
    if (!handler) throw new AppException({ code: 'INVALID_REQUEST', message: `Canal ${channel} no lo atiende backend.` })
    const req = contracts[channel].req.parse(payload)
    const data = await handler(req)
    return { ok: true, data }
  } catch (err) {
    return { ok: false, error: toAppError(err) }
  }
}
