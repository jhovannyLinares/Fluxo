import { z } from 'zod'
import { GraphFilterSchema, GraphRowSchema } from './graph-types'
import { AppErrorSchema } from './errors'
import { PreferencesSchema } from './preferences'
import { RecentSchema } from './recents'
import { RefsListSchema } from './refs'
import { CommitDetailSchema, FileChangeSchema } from './commit'
import { FileDiffSchema } from './diff'
import { OperationSchema } from './operation'
import { WebTargetSchema } from './web-links'
import { MenuActionSchema, OpenInSchema } from './menu'
import { LastCommitSchema, WipAreaSchema, WipFilesSchema, WipPathsSchema } from './wip'
import { PullModeSchema } from './pull'
import { PushRequestSchema, PushResultSchema, PushTargetSchema } from './push'
import { RepoSummarySchema } from './summary'
import { BlameLineSchema, FileHistoryEntrySchema } from './file-history'
import { OpEntrySchema } from './op-journal'
import { PrCreateRequestSchema, PrPrepareSchema, RemoteBranchSchema } from './pr-create'
import { AccountAccessSchema, AccountsInfoSchema, GithubAccountSchema, RepoAccountSchema } from './accounts'
import { PullRequestSchema } from './pull-requests'
import { ThemeSchema } from './themes'

/**
 * Contrato IPC único: cada canal define esquema de petición y respuesta.
 * Main valida petición antes de reenviar; backend valida de nuevo (doble extremo).
 */
const StashHash = z.string().regex(/^[0-9a-f]{40,64}$/)
const RepoId = z.string().regex(/^r[0-9]+$/)
const ConflictSideSchema = z.object({ label: z.string(), commit: z.string().nullable() })
const ConflictFileSchema = z.object({
  path: z.string(),
  eol: z.enum(['\n', '\r\n']),
  finalNewline: z.boolean(),
  ours: ConflictSideSchema,
  theirs: ConflictSideSchema,
  segments: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), lines: z.array(z.string()) }),
      z.object({ type: z.literal('conflict'), ours: z.array(z.string()), theirs: z.array(z.string()) })
    ])
  )
})
const BranchNameSchema = z.string().min(1).max(255).regex(/^(?!-)[^\0\s]+$/)

/** Estado del grafo cargado (respuesta de graph:load y de cada cambio en vivo). */
const GraphInfoSchema = z.object({
  total: z.number().int(),
  maxLanes: z.number().int(),
  gitMs: z.number(),
  buildMs: z.number(),
  /** true = solo primera página; historial completo llega por evento graph:full */
  partial: z.boolean(),
  version: z.number().int(),
  /** C21: «Viendo N/M» ramas */
  branches: z.object({ visible: z.number().int(), total: z.number().int() })
})

/** watching: fs.watch · polling: sondeo de respaldo (A2) · closed: sin vigilancia */
const WatchModeSchema = z.enum(['watching', 'polling', 'closed'])

export const contracts = {
  'app:ping': {
    req: z.object({}),
    res: z.object({ pong: z.literal(true), backendPid: z.number() })
  },
  'app:pickRepo': {
    req: z.object({}),
    res: z.object({ path: z.string().nullable() })
  },
  'env:check': {
    req: z.object({}),
    res: z.object({
      gitFound: z.boolean(),
      gitVersion: z.string().nullable(),
      gitVersionOk: z.boolean(),
      gcmFound: z.boolean(),
      minGitVersion: z.string(),
      gitPath: z.string().nullable(),
      // pantalla de entorno (H05): una fila por pieza
      checks: z.array(
        z.object({
          id: z.enum(['git', 'gcm', 'helper', 'proxy', 'ssl']),
          status: z.enum(['ok', 'info', 'warn', 'error']),
          value: z.string().nullable()
        })
      )
    })
  },
  'repo:open': {
    req: z.object({ path: z.string().min(1).max(1024) }),
    res: z.object({ repoId: RepoId, root: z.string(), name: z.string(), head: z.string().nullable(), operation: OperationSchema })
  },
  'graph:load': {
    // reuse (N12): si el repo ya está cargado, responde al instante con lo que hay y recarga en segundo plano
    // filter (H15): ramas ocultas, «actual y relacionadas» y rama anclada; sin filtro = todas
    req: z.object({ repoId: RepoId, reuse: z.boolean().optional(), filter: GraphFilterSchema.optional() }),
    res: GraphInfoSchema
  },
  /** H20: vigilar el repo (uno por pestaña abierta); cambios llegan por evento `repo:changed`. */
  'repo:watch': {
    req: z.object({ repoId: RepoId }),
    res: z.object({ mode: WatchModeSchema })
  },
  /** Deja de vigilar los repos que ya no están en ninguna pestaña. */
  'repo:watchKeep': {
    req: z.object({ roots: z.array(z.string().min(1).max(1024)).max(100) }),
    res: z.object({ watching: z.number().int() })
  },
  'graph:rows': {
    req: z.object({
      repoId: RepoId,
      offset: z.number().int().min(0),
      limit: z.number().int().min(1).max(2000)
    }),
    res: z.object({ offset: z.number().int(), version: z.number().int(), rows: z.array(GraphRowSchema) })
  },
  'prefs:get': {
    req: z.object({}),
    res: PreferencesSchema
  },
  /** Guarda preferencias completas y las aplica (zoom en main); responde lo guardado. */
  'prefs:set': {
    req: PreferencesSchema,
    res: PreferencesSchema
  },
  // recientes (H08): el primero es el último abierto
  'recents:get': {
    req: z.object({}),
    res: z.array(RecentSchema)
  },
  /** Anota un repo abierto con éxito (ruta raíz); responde la lista nueva. */
  'recents:add': {
    req: z.object({ path: z.string().min(1).max(1024), name: z.string().min(1).max(256) }),
    res: z.array(RecentSchema)
  },
  'recents:remove': {
    req: z.object({ path: z.string().min(1).max(1024) }),
    res: z.array(RecentSchema)
  },
  /** Fija o desfija un reciente en la pestaña nueva; responde la lista nueva. */
  'recents:pin': {
    req: z.object({ path: z.string().min(1).max(1024), pinned: z.boolean() }),
    res: z.array(RecentSchema)
  },
  /** Resumen de un repo por ruta (gestión de repositorios); null si ya no existe o no es repo. */
  'repo:summary': {
    req: z.object({ path: z.string().min(1).max(1024) }),
    res: z.object({ summary: RepoSummarySchema.nullable() })
  },
  /** Cherry pick de uno o varios commits sobre la rama actual, en el orden dado (del más viejo al más nuevo). */
  'repo:cherryPick': {
    req: z.object({ repoId: RepoId, hashes: z.array(z.string().regex(/^[0-9a-f]{7,64}$/)).min(1).max(200) }),
    res: z.object({ ms: z.number() })
  },
  /** Primer commit de la lista que ya está en la historia de la rama actual (cherry pick en gris), o null. */
  'repo:inHistory': {
    req: z.object({ repoId: RepoId, hashes: z.array(z.string().regex(/^[0-9a-f]{7,64}$/)).min(1).max(200) }),
    res: z.object({ hash: z.string().nullable() })
  },
  /** Une commits seguidos de la rama actual que todavía no se subieron («Squash de N commits»). */
  'repo:squash': {
    req: z.object({ repoId: RepoId, hashes: z.array(z.string().regex(/^[0-9a-f]{7,64}$/)).min(1).max(200) }),
    res: z.object({ ms: z.number() })
  },
  /** Motivo por el que no se puede hacer squash de esos commits (entrada en gris), o null. */
  'repo:squashCheck': {
    req: z.object({ repoId: RepoId, hashes: z.array(z.string().regex(/^[0-9a-f]{7,64}$/)).min(1).max(200) }),
    res: z.object({ why: z.string().nullable() })
  },
  /** Pull de la rama actual (botón Pull); responde si movió algo. */
  'repo:pull': {
    req: z.object({ repoId: RepoId, mode: PullModeSchema }),
    res: z.object({ changed: z.boolean(), ms: z.number() })
  },
  /** A dónde sube Push la rama actual (botón Push: sin upstream abre el diálogo). */
  'repo:pushTarget': {
    req: z.object({ repoId: RepoId }),
    res: PushTargetSchema
  },
  /** Push de la rama actual: al upstream, al destino del diálogo o forzado con el hash esperado. */
  'repo:push': {
    req: z.object({ repoId: RepoId }).extend(PushRequestSchema.shape),
    res: PushResultSchema
  },
  /** Cambiar a una rama local o remota (doble clic sobre su etiqueta); responde si cambió algo. */
  'repo:checkout': {
    req: z.object({ repoId: RepoId, ref: z.string().max(1024).regex(/^refs\/(heads|remotes)\/(?!-)[^\0\s]+$/) }),
    res: z.object({ changed: z.boolean(), ms: z.number() })
  },
  /** «Create branch here»: rama local nueva en un commit, sin cambiarse a ella. */
  'repo:createBranch': {
    req: z.object({
      repoId: RepoId,
      name: z.string().min(1).max(255).regex(/^(?!-)[^\0\s]+$/),
      at: z.string().regex(/^[0-9a-f]{7,64}$/)
    }),
    res: z.object({ ref: z.string(), ms: z.number() })
  },
  /** «Rename X»: cambia el nombre de una rama local; el commit y el historial no se tocan. */
  'repo:renameBranch': {
    req: z.object({ repoId: RepoId, from: BranchNameSchema, to: BranchNameSchema }),
    res: z.object({ ms: z.number() })
  },
  /** «Delete X» (ya confirmado en la interfaz): borra la local, la remota o las dos. La rama actual no se borra. */
  'repo:deleteBranch': {
    req: z.object({
      repoId: RepoId,
      name: BranchNameSchema,
      scope: z.enum(['local', 'remote', 'both']).default('local'),
      remote: z.string().min(1).max(255).regex(/^(?!-)[^\0\s]+$/).optional()
    }),
    res: z.object({ ms: z.number() })
  },
  /** «Set Upstream»: la rama sube y baja de `remote/remoteBranch`, que ya tiene que existir. */
  'repo:setUpstream': {
    req: z.object({ repoId: RepoId, branch: BranchNameSchema, remote: BranchNameSchema, remoteBranch: BranchNameSchema }),
    res: z.object({ ms: z.number() })
  },
  /**
   * Fast-forward / Merge / Rebase de la rama actual con `ref`. Los cambios sin commit se guardan solos y se
   * reaplican; si la operación queda con conflicto responde `conflict` y el stash automático se conserva.
   */
  'repo:integrate': {
    req: z.object({
      repoId: RepoId,
      kind: z.enum(['ff', 'merge', 'rebase']),
      ref: z.string().max(1024).regex(/^refs\/(heads|remotes)\/(?!-)[^\0\s]+$/)
    }),
    res: z.object({ status: z.enum(['done', 'conflict']), stashed: z.boolean(), ms: z.number() })
  },
  /** Abort / Continue / Skip de la operación a medias (merge, rebase, cherry-pick, revert). */
  'repo:operation': {
    req: z.object({ repoId: RepoId, action: z.enum(['abort', 'continue', 'skip']) }),
    res: z.object({ ms: z.number() })
  },
  /** «Reset {rama} to this commit >» Soft / Mixed / Hard (el hard se confirma en la interfaz). */
  'repo:reset': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/), mode: z.enum(['soft', 'mixed', 'hard']) }),
    res: z.object({ ms: z.number() })
  },
  /** «Revert commit»: commit nuevo que deshace otro; `conflict` deja el revert a medias. */
  'repo:revert': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/) }),
    res: z.object({ status: z.enum(['done', 'conflict']), stashed: z.boolean(), ms: z.number() })
  },
  /** «Create tag here» (sin mensaje) y «Create annotated tag here» (con mensaje). */
  'repo:createTag': {
    req: z.object({
      repoId: RepoId,
      hash: z.string().regex(/^[0-9a-f]{7,64}$/),
      name: z.string().min(1).max(255).regex(/^(?!-)[^\0\s]+$/),
      message: z.string().max(4096).optional()
    }),
    res: z.object({ ms: z.number() })
  },
  /** «Checkout this commit»: HEAD separado en ese commit. */
  'repo:checkoutCommit': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/) }),
    res: z.object({ ms: z.number() })
  },
  /** «Create worktree from…»: `path` absoluto y nuevo; con `ref` (rama local) o con `hash` (commit separado). */
  'repo:addWorktree': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(1024), ref: BranchNameSchema.optional(), hash: z.string().regex(/^[0-9a-f]{7,64}$/).optional(), newBranch: z.string().max(255).optional() }),
    res: z.object({ ms: z.number() })
  },
  /** «Edit commit message»: mismo contenido, autor y fecha; solo cambia el mensaje. */
  'repo:editMessage': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/), message: z.string().max(10000) }),
    res: z.object({ ms: z.number() })
  },
  /** «Drop commit»: lo quita de la rama actual; `conflict` deja el rebase a medias. */
  'repo:dropCommit': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/) }),
    res: z.object({ status: z.enum(['done', 'conflict']), stashed: z.boolean(), ms: z.number() })
  },
  /** Interactive Rebase: commits de la rama actual que no están en `ref`, del más viejo al más nuevo. */
  'repo:rebasePlan': {
    req: z.object({ repoId: RepoId, ref: z.string().max(1024).regex(/^refs\/(heads|remotes)\/(?!-)[^\0\s]+$/) }),
    res: z.object({ commits: z.array(z.object({ hash: z.string(), subject: z.string() })) })
  },
  /** Ejecuta el rebase interactivo con los pasos elegidos (Pick / Reword / Squash / Drop y el orden). */
  'repo:rebaseInteractive': {
    req: z.object({
      repoId: RepoId,
      ref: z.string().max(1024).regex(/^refs\/(heads|remotes)\/(?!-)[^\0\s]+$/),
      steps: z
        .array(z.object({ hash: z.string().regex(/^[0-9a-f]{40,64}$/), action: z.enum(['pick', 'reword', 'squash', 'drop']), message: z.string().max(10000).optional() }))
        .min(1)
        .max(500)
    }),
    res: z.object({ status: z.enum(['done', 'conflict']), stashed: z.boolean(), ms: z.number() })
  },
  /** «Move commit up / down»: intercambia un commit con su vecino en la historia de la rama actual. */
  'repo:moveCommit': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/), dir: z.enum(['up', 'down']) }),
    res: z.object({ status: z.enum(['done', 'conflict']), stashed: z.boolean(), ms: z.number() })
  },
  /** «Pull» / «Push» de una rama que no es la actual, a su upstream. */
  'repo:pullBranch': {
    req: z.object({ repoId: RepoId, branch: BranchNameSchema }),
    res: z.object({ ms: z.number() })
  },
  'repo:pushBranch': {
    req: z.object({ repoId: RepoId, branch: BranchNameSchema, to: z.object({ remote: BranchNameSchema, branch: BranchNameSchema }).optional() }),
    res: z.object({ ms: z.number() })
  },
  /** Editor de conflictos: el archivo como bloques (texto común y los dos lados de cada conflicto). */
  'conflict:read': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(4096) }),
    res: ConflictFileSchema
  },
  /** «Save»: escribe el resultado y deja el archivo resuelto (en el stage). */
  'conflict:save': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(4096), content: z.string().max(20_000_000) }),
    res: z.object({ ms: z.number() })
  },
  /** «Take current» (A) o «Take incoming» (B): resuelve el archivo entero con un lado. */
  'conflict:take': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(4096), side: z.enum(['ours', 'theirs']) }),
    res: z.object({ ms: z.number() })
  },
  /** «Mark All Resolved». */
  'conflict:resolveAll': {
    req: z.object({ repoId: RepoId }),
    res: z.object({ count: z.number().int() })
  },
  /** Undo / Redo de la barra: qué se deshace y qué se rehace, para el tooltip. */
  'repo:undoInfo': {
    req: z.object({ repoId: RepoId }),
    res: z.object({ undo: z.object({ label: z.string() }).nullable(), redo: z.object({ label: z.string() }).nullable() })
  },
  'repo:undo': {
    req: z.object({ repoId: RepoId, action: z.enum(['undo', 'redo']) }),
    res: z.object({ ms: z.number() })
  },
  /** «Delete» de un tag: local, remoto o los dos. */
  'repo:deleteTag': {
    req: z.object({
      repoId: RepoId,
      name: BranchNameSchema,
      scope: z.enum(['local', 'remote', 'both']),
      remote: BranchNameSchema.optional()
    }),
    res: z.object({ ms: z.number() })
  },
  /** «Push tag» de un tag que solo está en local. */
  'repo:pushTag': {
    req: z.object({ repoId: RepoId, name: BranchNameSchema, remote: BranchNameSchema.optional() }),
    res: z.object({ ms: z.number() })
  },
  /** Qué tags tiene ya el remoto (consulta de red; sin conexión, lista vacía). */
  'repo:tagsOnRemote': {
    req: z.object({ repoId: RepoId }),
    res: z.object({ names: z.array(z.string()), remote: z.string().nullable() })
  },
  /** «Restore file from this commit»: el archivo vuelve a como estaba en el commit, solo en el árbol de trabajo. */
  'wip:restore': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/), paths: z.array(z.string().min(1).max(4096)).min(1).max(500) }),
    res: z.object({ ms: z.number() })
  },
  /** Remotos del repo con su URL de pull y la de push si es otra. */
  'repo:remotes': {
    req: z.object({ repoId: RepoId }),
    res: z.object({ remotes: z.array(z.object({ name: z.string(), pullUrl: z.string(), pushUrl: z.string().nullable() })) })
  },
  /** «Add Remote». */
  'remote:add': {
    req: z.object({ repoId: RepoId, name: z.string().min(1).max(100), pullUrl: z.string().max(2048), pushUrl: z.string().max(2048).nullable().optional() }),
    res: z.object({ ms: z.number() })
  },
  /** «Edit Remote»: nombre, URL de pull y de push (null = sin URL de push aparte). */
  'remote:edit': {
    req: z.object({ repoId: RepoId, name: z.string().min(1).max(100), newName: z.string().min(1).max(100), pullUrl: z.string().max(2048), pushUrl: z.string().max(2048).nullable() }),
    res: z.object({ ms: z.number() })
  },
  /** «Remove {remoto}»: quita el remoto y sus ramas de seguimiento. */
  'remote:remove': {
    req: z.object({ repoId: RepoId, name: z.string().min(1).max(100) }),
    res: z.object({ ms: z.number() })
  },
  /** «Fetch {remoto}». */
  'remote:fetch': {
    req: z.object({ repoId: RepoId, name: z.string().min(1).max(100) }),
    res: z.object({ ms: z.number() })
  },
  /** «Remove this worktree» (con o sin su rama) y «Lock / Unlock this worktree». */
  'worktree:remove': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(4096), deleteBranch: z.boolean() }),
    res: z.object({ ms: z.number() })
  },
  'worktree:lock': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(4096), lock: z.boolean() }),
    res: z.object({ ms: z.number() })
  },
  /** «Add Submodule» (URL + carpeta) y «Initialize» / «Update» de uno existente. */
  'submodule:add': {
    req: z.object({ repoId: RepoId, url: z.string().max(2048), path: z.string().max(1024) }),
    res: z.object({ ms: z.number() })
  },
  'submodule:edit': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(1024), url: z.string().max(2048), newPath: z.string().max(1024) }),
    res: z.object({ ms: z.number() })
  },
  'submodule:delete': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(1024) }),
    res: z.object({ ms: z.number() })
  },
  'submodule:update': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(1024), init: z.boolean() }),
    res: z.object({ ms: z.number() })
  },
  /** Fetch de todos los remotos (H10); `auto` = autofetch sin ventanas de inicio de sesión. */
  'repo:fetch': {
    req: z.object({ repoId: RepoId, auto: z.boolean().optional() }),
    res: z.object({ changed: z.boolean(), ms: z.number() })
  },
  /** Navegar por la rama (H12): fila del primer padre o del hijo que sigue la rama; null si no hay. */
  'graph:neighbor': {
    req: z.object({ repoId: RepoId, index: z.number().int().min(0), dir: z.enum(['parent', 'child']) }),
    res: z.object({ index: z.number().int().nullable() })
  },
  /** Panel de ramas (H16) con ahead/behind (H17). */
  'refs:list': {
    req: z.object({ repoId: RepoId }),
    res: RefsListSchema
  },
  /** Fila de un commit en el grafo cargado (clic en una rama del panel); null si no está a la vista. */
  'graph:find': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/) }),
    res: z.object({ index: z.number().int().nullable() })
  },
  /** A2: filas del grafo que coinciden con la búsqueda (mensaje, autor, SHA, o `archivo:` + ruta), en orden. */
  'graph:search': {
    req: z.object({ repoId: RepoId, query: z.string().max(1000) }),
    res: z.object({ indices: z.array(z.number().int()) })
  },
  /** B11: filas del grafo que son de una rama (herencia por primer padre), en orden. */
  'graph:branchRows': {
    req: z.object({ repoId: RepoId, ref: z.string().regex(/^refs\/(heads|remotes)\//).max(512) }),
    res: z.object({ indices: z.array(z.number().int()) })
  },
  /** Detalle de commit (H18): mensaje completo, coautores y archivos contra el primer padre. */
  'commit:detail': {
    req: z.object({
      repoId: RepoId,
      hash: z.string().regex(/^[0-9a-f]{7,64}$/),
      /** fila agrupada: comparar contra el padre del más viejo del grupo (o el árbol vacío) */
      base: z.string().regex(/^[0-9a-f]{7,64}$/).optional()
    }),
    res: CommitDetailSchema
  },
  /** Todos los archivos del commit («ver todos los archivos», C19). */
  'commit:tree': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/) }),
    res: z.object({ paths: z.array(z.string()) })
  },
  /** Diff de un archivo del commit contra el primer padre (H19); `full` = archivo completo, `ignoreSpace` = C17. */
  'commit:diff': {
    req: z.object({
      repoId: RepoId,
      hash: z.string().regex(/^[0-9a-f]{7,64}$/),
      path: z.string().min(1).max(4096),
      oldPath: z.string().min(1).max(4096).optional(),
      full: z.boolean(),
      ignoreSpace: z.boolean(),
      base: z.string().regex(/^[0-9a-f]{7,64}$/).optional()
    }),
    res: FileDiffSchema
  },
  /** A1: archivos del repo cuyo nombre o ruta contiene el texto (caja «Buscar archivo»). */
  'file:search': {
    req: z.object({ repoId: RepoId, query: z.string().max(4096) }),
    res: z.object({ paths: z.array(z.string()) })
  },
  /** A1: commits que tocaron el archivo, siguiendo renombres, del más nuevo al más viejo. */
  'file:history': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(4096) }),
    res: z.object({ entries: z.array(FileHistoryEntrySchema) })
  },
  /** A1: quién escribió cada línea del archivo en HEAD. */
  'file:blame': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(4096) }),
    res: z.object({ lines: z.array(BlameLineSchema) })
  },
  /** B2: archivos que cambiaron entre un commit y el directorio de trabajo (`git diff <commit>`); B3: con `to`, entre dos commits. */
  'commit:compare': {
    req: z.object({ repoId: RepoId, hash: z.string().regex(/^[0-9a-f]{7,64}$/), to: z.string().regex(/^[0-9a-f]{7,64}$/).optional() }),
    res: z.object({ files: z.array(FileChangeSchema) })
  },
  /** B2: diff de un archivo entre el commit y el directorio de trabajo; B3: con `to`, entre dos commits. */
  'commit:compareDiff': {
    req: z.object({
      repoId: RepoId,
      hash: z.string().regex(/^[0-9a-f]{7,64}$/),
      to: z.string().regex(/^[0-9a-f]{7,64}$/).optional(),
      path: z.string().min(1).max(4096),
      oldPath: z.string().min(1).max(4096).optional(),
      full: z.boolean(),
      ignoreSpace: z.boolean()
    }),
    res: FileDiffSchema
  },
  /** H23: página web de un commit, una rama o sus PR en el remoto; null si no es GitHub ni Azure DevOps. */
  'web:url': {
    req: z.object({ repoId: RepoId, target: WebTargetSchema }),
    res: z.object({ url: z.string().nullable() })
  },
  /** Abrir en el navegador del sistema (main); solo https de GitHub o Azure DevOps. */
  'app:openUrl': {
    req: z.object({ url: z.string().max(4096) }),
    res: z.object({ ok: z.boolean() })
  },
  /** Abrir la carpeta del repo en la terminal, el Explorador o el editor (menú Archivo); main valida la carpeta. */
  'app:openIn': {
    req: z.object({ target: OpenInSchema, path: z.string().min(1).max(1024) }),
    res: z.object({ ok: z.boolean() })
  },
  /** Archivo del repo con el programa predeterminado (`open`) o seleccionado en el Explorador (`folder`). */
  'app:openFile': {
    req: z.object({ path: z.string().min(1).max(4096), mode: z.enum(['open', 'folder']) }),
    res: z.object({ ok: z.boolean() })
  },
  /** Cambios sin commit (fila WIP): archivos en stage y sin stage. */
  'wip:files': {
    req: z.object({ repoId: RepoId }),
    res: WipFilesSchema
  },
  /** Stage de archivos (o de todo, sin `paths`). */
  'wip:stage': {
    req: z.object({ repoId: RepoId, paths: WipPathsSchema }),
    res: z.object({ ok: z.literal(true) })
  },
  /** Quitar archivos del stage (o todo, sin `paths`). */
  'wip:unstage': {
    req: z.object({ repoId: RepoId, paths: WipPathsSchema }),
    res: z.object({ ok: z.literal(true) })
  },
  /** Último commit, para precargar el amend; null si el repo no tiene commits. */
  'wip:lastCommit': {
    req: z.object({ repoId: RepoId }),
    res: z.object({ last: LastCommitSchema.nullable() })
  },
  /** Commit de lo que está en stage, o amend del último. */
  'wip:commit': {
    req: z.object({ repoId: RepoId, message: z.string().min(1).max(100_000), amend: z.boolean() }),
    res: z.object({ hash: z.string() })
  },
  /** Stash de los cambios sin commit (o solo de `paths`); `message` es el texto del campo WIP. */
  'repo:stash': {
    req: z.object({
      repoId: RepoId,
      message: z.string().max(10_000).optional(),
      paths: WipPathsSchema,
      includeUntracked: z.boolean()
    }),
    res: z.object({ hash: z.string(), ms: z.number() })
  },
  /** Aplica un stash y lo conserva (`apply`) o lo borra al terminar (`pop`); se identifica por su hash. */
  'repo:stashApply': {
    req: z.object({ repoId: RepoId, hash: StashHash, pop: z.boolean(), paths: WipPathsSchema }),
    res: z.object({ ms: z.number() })
  },
  'repo:stashDrop': {
    req: z.object({ repoId: RepoId, hash: StashHash }),
    res: z.object({ ms: z.number() })
  },
  /** Cambia el mensaje de un stash (git no lo renombra: se borra y se guarda de nuevo el mismo commit). */
  'repo:stashRename': {
    req: z.object({ repoId: RepoId, hash: StashHash, message: z.string().min(1).max(10_000) }),
    res: z.object({ ms: z.number() })
  },
  /** Descarta cambios (permanente): archivos, todo, o un bloque (`patch`, en forma de diff). */
  'wip:discard': {
    req: z.object({ repoId: RepoId, paths: WipPathsSchema, patch: z.string().min(1).max(5_000_000).optional() }),
    res: z.object({ ok: z.literal(true) })
  },
  /** Stage (o unstage con `reverse`) de un bloque o de líneas sueltas, a partir de un patch. */
  'wip:stagePatch': {
    req: z.object({ repoId: RepoId, patch: z.string().min(1).max(5_000_000), reverse: z.boolean() }),
    res: z.object({ ok: z.literal(true) })
  },
  /** Agrega una regla al `.gitignore` de la raíz; `stopTracking` además saca el archivo del índice. */
  'wip:ignore': {
    req: z.object({ repoId: RepoId, pattern: z.string().min(1).max(4096), stopTracking: z.boolean().optional() }),
    res: z.object({ added: z.boolean() })
  },
  /** Crea un archivo vacío; una «/» en el nombre crea las carpetas. */
  'wip:createFile': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(4096) }),
    res: z.object({ path: z.string() })
  },
  /** Borra un archivo del árbol de trabajo (el diálogo de confirmación es de la UI). */
  'wip:deleteFile': {
    req: z.object({ repoId: RepoId, path: z.string().min(1).max(4096) }),
    res: z.object({ ok: z.literal(true) })
  },
  /** Diff de un archivo sin commit; `area` dice contra qué se compara. */
  'wip:diff': {
    req: z.object({
      repoId: RepoId,
      path: z.string().min(1).max(4096),
      oldPath: z.string().min(1).max(4096).optional(),
      area: WipAreaSchema,
      full: z.boolean(),
      ignoreSpace: z.boolean()
    }),
    res: FileDiffSchema
  },
  /** A4: PR abiertos del remoto (GitHub o Azure DevOps), con el token que guarda GCM pedido en memoria. */
  'repo:pullRequests': {
    req: z.object({ repoId: RepoId }),
    res: z.object({ provider: z.enum(['github', 'azure']).nullable(), prs: z.array(PullRequestSchema), needsLogin: z.boolean() })
  },
  /** A12: cuentas que guarda Git Credential Manager (GitHub y organizaciones de Azure DevOps). */
  'accounts:list': {
    req: z.object({}),
    res: AccountsInfoSchema
  },
  /** A12: «Iniciar sesión con GitHub»: GCM abre el navegador. */
  'accounts:githubLogin': {
    req: z.object({}),
    res: z.object({ ok: z.literal(true) })
  },
  /** A12: «Cerrar sesión» de una cuenta de GitHub (nombres de GitHub: letras, números y guiones, sin guion al inicio). */
  'accounts:githubLogout': {
    req: z.object({ account: GithubAccountSchema }),
    res: z.object({ ok: z.literal(true) })
  },
  /** Cuenta de GitHub con que trabaja el repo (avatar arriba a la derecha) y las que guarda GCM. */
  'repo:account': {
    req: z.object({ repoId: RepoId }),
    res: RepoAccountSchema
  },
  /** Datos del formulario «Crear pull request» (GitHub): ramas, plantillas, personas, etiquetas, regla de la rama. */
  'pr:prepare': {
    req: z.object({ repoId: RepoId, head: z.string().min(1).max(255).optional(), base: RemoteBranchSchema.optional() }),
    res: PrPrepareSchema
  },
  /** Crea el pull request en GitHub con la cuenta del repo. */
  'pr:create': {
    req: PrCreateRequestSchema.extend({ repoId: RepoId, remote: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/) }),
    res: z.object({ number: z.number().int(), url: z.string(), warning: z.string().nullable() })
  },
  /** Prueba cada cuenta de GCM contra el remoto del repo, sin abrir ventanas. */
  'repo:accountAccess': {
    req: z.object({ repoId: RepoId }),
    res: z.object({ access: z.record(z.string(), AccountAccessSchema) })
  },
  /** Fija la cuenta en el .git/config del repo; null = que GCM elija. */
  'repo:setAccount': {
    req: z.object({ repoId: RepoId, account: GithubAccountSchema.nullable() }),
    res: z.object({ ok: z.literal(true) })
  },
  /** Tras autorizar el SSO en el navegador: GCM cierra y vuelve a abrir la sesión de esa cuenta. */
  'accounts:relogin': {
    req: z.object({ account: GithubAccountSchema }),
    res: z.object({ ok: z.literal(true) })
  },
  /** Muestra el archivo del registro de errores en el Explorador (lo mismo que Ayuda ▸ Registro de errores). */
  'app:openErrorLog': {
    req: z.object({}),
    res: z.object({ ok: z.literal(true) })
  },
  /** A12: «Probar» la credencial con el remoto del repo abierto; si falta, GCM pide iniciar sesión. */
  'accounts:test': {
    req: z.object({ repoId: RepoId, remote: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/) }),
    res: z.object({ ms: z.number() })
  },
  /** A11: la carga inicial terminó (grafo pintado o nada que abrir): main cierra la pantalla de carga. */
  /** «Acerca de Fluxo»: versiones de Electron, Chromium y Node con que corre la app. */
  'app:versions': {
    req: z.object({}),
    res: z.object({ electron: z.string(), chrome: z.string(), node: z.string() })
  },
  /** B13: temas de la carpeta de temas; los que no se pudieron leer van aparte, con el motivo. */
  'themes:list': {
    req: z.object({}),
    res: z.object({ dir: z.string(), themes: z.array(ThemeSchema), errors: z.array(z.object({ file: z.string(), message: z.string() })) })
  },
  /** B13: abre la carpeta de temas en el Explorador (la crea si no existe). */
  'themes:openFolder': {
    req: z.object({}),
    res: z.object({ ok: z.literal(true) })
  },
  'app:ready': {
    req: z.object({}),
    res: z.object({ ok: z.literal(true) })
  },
  /** Copiar texto al portapapeles (main: el renderer no tiene permisos). */
  'app:copy': {
    req: z.object({ text: z.string().max(4096) }),
    res: z.object({ ok: z.literal(true) })
  },
  /** Carpeta donde clonar (main, diálogo nativo). */
  'app:pickFolder': {
    req: z.object({}),
    res: z.object({ path: z.string().nullable() })
  },
  /** Clona por HTTPS (H09) dentro de `parent`; progreso por evento `clone:progress`; responde la carpeta del clon. */
  'repo:clone': {
    req: z.object({ url: z.string().min(1).max(2048), parent: z.string().min(1).max(1024) }),
    res: z.object({ path: z.string() })
  },
  /** «Initialize a Repo»: carpeta nueva con README, rama, .gitignore/licencia opcionales y commit inicial. */
  'repo:init': {
    req: z.object({
      name: z.string().min(1).max(200),
      parent: z.string().min(1).max(1024),
      branch: z.string().max(255).optional(),
      gitignore: z.string().max(100).optional(),
      license: z.string().max(100).optional()
    }),
    res: z.object({ path: z.string() })
  },
  /** «Create Repository and Clone» en GitHub o Azure DevOps: crea el repo en el servidor y, si se pide, lo inicializa y sube. */
  'repo:createRemote': {
    req: z.object({
      provider: z.enum(['github', 'azure']),
      account: z.string().min(1).max(200),
      org: z.string().max(100).optional(),
      project: z.string().max(200).optional(),
      name: z.string().min(1).max(200),
      description: z.string().max(350).optional(),
      private: z.boolean().optional(),
      parent: z.string().min(1).max(1024).optional(),
      branch: z.string().max(255).optional(),
      gitignore: z.string().max(100).optional(),
      license: z.string().max(100).optional()
    }),
    res: z.object({ path: z.string().nullable(), url: z.string(), webUrl: z.string() })
  },
  /** Proyectos de una organización de Azure DevOps. */
  'azure:projects': {
    req: z.object({ org: z.string().min(1).max(100), account: z.string().min(1).max(200) }),
    res: z.object({ projects: z.array(z.string()) })
  }
} as const

export type Channel = keyof typeof contracts
export type Req<C extends Channel> = z.infer<(typeof contracts)[C]['req']>
export type Res<C extends Channel> = z.infer<(typeof contracts)[C]['res']>

/** Canales que atiende main directamente (necesitan APIs de ventana). */
export const MAIN_CHANNELS: ReadonlySet<Channel> = new Set<Channel>([
  'app:pickRepo',
  'app:pickFolder',
  'app:ready',
  'app:versions',
  'themes:list',
  'themes:openFolder',
  'app:copy',
  'app:openUrl',
  'app:openErrorLog',
  'app:openIn',
  'prefs:get',
  'prefs:set',
  'recents:get',
  'recents:add',
  'recents:remove',
  'recents:pin'
])

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(contracts, value)
}

export const RpcResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: AppErrorSchema })
])
export type RpcResult<T = unknown> = { ok: true; data: T } | { ok: false; error: z.infer<typeof AppErrorSchema> }

/** Eventos push backend → renderer. */
export const AppEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('graph:full'),
    repoId: RepoId,
    version: z.number().int(),
    total: z.number().int(),
    maxLanes: z.number().int(),
    gitMs: z.number(),
    buildMs: z.number()
  }),
  z.object({ type: z.literal('graph:error'), repoId: RepoId, error: AppErrorSchema }),
  /** main → renderer: preferencias cambiadas fuera del diálogo (zoom por teclado). */
  z.object({ type: z.literal('prefs:changed'), prefs: PreferencesSchema }),
  z.object({ type: z.literal('clone:progress'), phase: z.string(), percent: z.number().min(0).max(100) }),
  /** H20: git cambió fuera de Fluxo; `graph` = estado nuevo del grafo */
  z.object({
    type: z.literal('repo:changed'),
    repoId: RepoId,
    kinds: z.array(z.enum(['refs', 'head', 'index', 'operation', 'worktree'])),
    graph: GraphInfoSchema,
    /** H21: operación en curso tras el cambio */
    operation: OperationSchema
  }),
  /** A2: la vigilancia cambió de modo (fs.watch sordo → sondeo) */
  z.object({ type: z.literal('repo:watch'), repoId: RepoId, mode: WatchModeSchema }),
  /** A4: el repo ya no está en su carpeta */
  z.object({ type: z.literal('repo:gone'), repoId: RepoId, root: z.string() }),
  /** main → renderer: entrada del menú de la aplicación que resuelve la ventana */
  z.object({ type: z.literal('menu'), action: MenuActionSchema }),
  /** backend → main: una escritura terminó; main la escribe en el registro y no la pasa a la ventana */
  z.object({ type: z.literal('op:journal'), entry: OpEntrySchema })
])
export type AppEvent = z.infer<typeof AppEventSchema>

/** Mensajes entre main y backend (utilityProcess). */
export type BackendRequest = { id: number; channel: Channel; payload: unknown }
export type BackendResponse = { id: number; result: RpcResult }
export type BackendEvent = { event: AppEvent }
