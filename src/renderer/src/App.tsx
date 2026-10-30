import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { SUPERSEDED } from '@shared/errors'
import type { GraphRow } from '@shared/graph-types'
import type { Res } from '@shared/ipc-contracts'
import type { PullRequest } from '@shared/pull-requests'
import { LOCALES } from '@shared/i18n'
import type { Recent } from '@shared/recents'
import { DEFAULT_FILTER, WIP_HASH, type GraphFilter } from '@shared/graph-types'
import { hideRefs, loadFilter, saveFilter } from './graph/filter-store'
import { RefsMenu } from './graph/RefsMenu'
import { checkoutTarget, groupRefs, type DisplayRef } from './graph/refs-display'
import type { RefsList, Submodule } from '@shared/refs'
import { RefsPanel } from './panels/RefsPanel'
import { CommitDetailView } from './panels/CommitDetailView'
import type { CommitDetail, FileChange } from '@shared/commit'
import { ConflictEditor } from './panels/ConflictEditor'
import { DiffView } from './panels/DiffView'
import type { Operation } from '@shared/operation'
import type { WebTarget } from '@shared/web-links'
import type { MenuAction } from '@shared/menu'
import { Toolbar } from './Toolbar'
import { useAsk } from './dialogs/ask'
import { InteractiveRebase, type RebaseChoice, type RebaseRow } from './dialogs/InteractiveRebase'
import { RemoteDialog, type RemoteForm } from './dialogs/RemoteDialog'
import { TabsBar } from './TabsBar'
import { CommitMenu } from './graph/CommitMenu'
import { DropMenu } from './graph/DropMenu'
import { RepoManager } from './panels/RepoManager'
import { ReposScreen } from './panels/ReposScreen'
import { PushDialogs, type PushDialog } from './dialogs/PushDialogs'
import type { PushRequest } from '@shared/push'
import { APP_VERSION } from './version'
import type { PullMode } from '@shared/pull'
import { WipDetailView } from './panels/WipDetailView'
import type { WipArea, WipFiles } from '@shared/wip'
import { activeTab, closeTab, cycleTab, initialTabs, loadTabs, newTab, reopenClosed, saveTabs, showRepo, tabAt, type Tabs } from './tabs'
import { ApiError, call, onAppEvent } from './api'
import { scheduleAutoFetch } from './autofetch'
import { CloneDialog } from './dialogs/CloneDialog'
import { InitDialog } from './dialogs/InitDialog'
import { SubmoduleDialog } from './dialogs/SubmoduleDialog'
import { WorktreeDialog } from './dialogs/WorktreeDialog'
import { PullRequestDialog } from './dialogs/PullRequestDialog'
import { prMenuEntry } from '@shared/pr-menu'
import { EnvironmentDialog } from './dialogs/EnvironmentDialog'
import { PreferencesView } from './panels/PreferencesView'
import { AccountMenu } from './AccountMenu'
import type { AccountAccess, RepoAccount } from '@shared/accounts'
import { ShortcutsDialog } from './dialogs/ShortcutsDialog'
import { FileSearchDialog } from './dialogs/FileSearchDialog'
import { FileHistoryView } from './panels/FileHistoryView'
import { FileMenu } from './panels/FileMenu'
import { CompareView } from './panels/CompareView'
import { CommandPalette } from './dialogs/CommandPalette'
import { HelpDialog } from './dialogs/HelpDialog'
import { AboutDialog } from './dialogs/AboutDialog'
import { actionItems, type PaletteItem } from './palette'
import { CommitSearch } from './graph/CommitSearch'
import { Splitter } from './Splitter'
import { clampWidth, DEFAULT_WIDTHS, fitWidths, loadWidths, saveWidths, type PanelWidths } from './layout'
import { GraphView } from './graph/GraphView'
import { columnsFor } from './graph/draw'
import { effectiveStyle } from './graph/palettes'
import { clampColumn, loadColumnSizes, saveColumnSizes, type ColumnId, type ColumnSizes } from './graph/column-widths'
import type { Theme } from '@shared/themes'
import { usePrefs } from './prefs'

type Env = Res<'env:check'>
type Repo = Res<'repo:open'>
type Graph = Res<'graph:load'>

interface Metrics {
  gitMs: number
  buildMs: number
  firstPaintMs: number | null
  fullMs: number | null
}

/** Árbol vacío de git: el «padre» del primer commit al comparar desde él (B3). */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

// A11: avisa a main una sola vez que terminó la carga inicial, para cerrar la pantalla de carga
let readySent = false
const appReady = () => {
  if (readySent) return
  readySent = true
  call('app:ready', {}).catch(() => {})
}

export function App() {
  const [env, setEnv] = useState<Env | null>(null)
  const [repo, setRepo] = useState<Repo | null>(null)
  const [graph, setGraph] = useState<Graph | null>(null)
  const [selected, setSelected] = useState<GraphRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError['info'] | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [dialog, setDialog] = useState<
    'prefs' | 'shortcuts' | 'env' | 'clone' | 'init' | 'submodule' | 'repos' | 'fileSearch' | 'palette' | 'guide' | 'releaseNotes' | 'about' | null
  >(null)
  // A1: historial o blame de un archivo en lugar del grafo; menú del clic derecho en un archivo del detalle
  const [fileHist, setFileHist] = useState<{ path: string; mode: 'history' | 'blame' } | null>(null)
  const [fileMenu, setFileMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  // B2: commit comparado con el directorio de trabajo, en lugar del grafo
  const [compare, setCompare] = useState<{ from: string; to?: string; title: string } | null>(null)
  // B1: anchos del panel izquierdo y del detalle, con divisores que se arrastran; se guardan al soltar
  const [widths, setWidths] = useState<PanelWidths>(loadWidths)
  // ancho medido del grafo: la cabecera alinea sus columnas con él
  const [graphWidth, setGraphWidth] = useState(800)
  const [colSizes, setColSizes] = useState(loadColumnSizes)
  useEffect(() => saveColumnSizes(colSizes), [colSizes])
  // B13: temas de la carpeta de temas; se vuelven a leer al cerrar un diálogo (por ejemplo, Personalización)
  const [themes, setThemes] = useState<Theme[]>([])
  useEffect(() => {
    if (dialog !== null) return
    call('themes:list', {}).then((r) => setThemes(r.themes), () => {})
  }, [dialog])
  const widthsRef = useRef(widths)
  widthsRef.current = widths
  const resize = (side: keyof PanelWidths) => ({
    // la referencia se actualiza aquí y no en el render: al soltar se guarda el último ancho, no el anterior
    onResize: (want: number) => {
      const w = widthsRef.current
      const next = { ...w, [side]: clampWidth(side, want, side === 'left' ? w.right : w.left, window.innerWidth) }
      widthsRef.current = next
      setWidths(next)
    },
    onDone: () => saveWidths(widthsRef.current),
    onReset: () => {
      const next = { ...widthsRef.current, [side]: DEFAULT_WIDTHS[side] }
      widthsRef.current = next
      setWidths(next)
      saveWidths(next)
    }
  })

  // A2: caja «Buscar commits» sobre el grafo; el número cambia con cada Ctrl+F para devolverle el foco
  const [search, setSearch] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)
  const [recents, setRecents] = useState<Recent[] | null>(null)
  const [fetchState, setFetchState] = useState<{ running: boolean; at: number | null; error: string | null }>({
    running: false,
    at: null,
    error: null
  })
  // H15: filtro de ramas del repo abierto; la ref deja que fetch y recargas usen siempre el vigente
  const [filter, setFilterState] = useState<GraphFilter>(DEFAULT_FILTER)
  const filterRef = useRef<GraphFilter>(DEFAULT_FILTER)
  const [refsMenu, setRefsMenu] = useState<{ x: number; y: number; refs: DisplayRef[] } | null>(null)
  const [commitMenu, setCommitMenu] = useState<{ x: number; y: number; row: GraphRow; ref?: string } | null>(null)
  // filas seleccionadas en el grafo (Shift/Ctrl + clic), de arriba abajo
  const [multi, setMulti] = useState<{ index: number; row: GraphRow }[]>([])
  // H16: panel de ramas y salto al commit de una rama
  const [refsList, setRefsList] = useState<RefsList | null>(null)
  // carpeta recién clonada: al abrirse se ofrece inicializar sus submódulos
  const cloneOffer = useRef<string | null>(null)
  // una respuesta vieja de refs:list nunca pisa a una más nueva (el estado de submódulos tarda varios segundos)
  const refsSeq = useRef(0)
  const loadRefs = useCallback((repoId: string) => {
    const seq = ++refsSeq.current
    return call('refs:list', { repoId }).then((l) => seq === refsSeq.current && setRefsList(l), () => {})
  }, [])
  const [submoduleEdit, setSubmoduleEdit] = useState<Submodule | null>(null)
  const [jump, setJump] = useState<{ index: number; n: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // H18: detalle del commit seleccionado; openFile = archivo con diff abierto (H19)
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)
  const [openFile, setOpenFile] = useState<FileChange | null>(null)
  const [conflictFile, setConflictFile] = useState<string | null>(null)
  const [wipFiles, setWipFiles] = useState<WipFiles | null>(null)
  const [wipArea, setWipArea] = useState<WipArea | null>(null)
  // H20: vigilancia en vivo; keep = fila del commit seleccionado tras una recarga (sin mover la vista)
  const [watchMode, setWatchMode] = useState<Res<'repo:watch'>['mode'] | null>(null)
  const [gone, setGone] = useState<string | null>(null)
  const [keep, setKeep] = useState<{ index: number; n: number } | null>(null)
  // H21: merge, rebase, cherry-pick, revert o bisect a medio hacer
  const [operation, setOperation] = useState<Operation>(null)
  // pestañas de repos; la ref deja leer las vigentes dentro de callbacks
  const [tabs, setTabsState] = useState<Tabs>(initialTabs)
  const tabsRef = useRef(tabs)
  const setTabs = useCallback((next: Tabs | ((s: Tabs) => Tabs)) => {
    tabsRef.current = typeof next === 'function' ? next(tabsRef.current) : next
    setTabsState(tabsRef.current)
  }, [])
  // menú Ver: mostrar u ocultar el panel izquierdo (Ctrl+J) y el detalle (Ctrl+K)
  const [showLeft, setShowLeft] = useState(true)
  const [showDetail, setShowDetail] = useState(true)
  // con la ventana chica los paneles se encogen (el grafo conserva su mínimo); al agrandarla vuelven a su ancho
  const [viewW, setViewW] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setViewW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const eff = fitWidths(widths, viewW, { left: showLeft, right: showDetail })
  const selectedRef = useRef<GraphRow | null>(null)
  selectedRef.current = selected
  const loadStart = useRef(0)
  const reopened = useRef(false)
  const { prefs, update, lang, t } = usePrefs()
  // B11: filas de la rama bajo el ratón en el panel; hoverSeq descarta respuestas de una rama que ya se dejó
  const [branchHi, setBranchHi] = useState<ReadonlySet<number> | null>(null)
  const hoverSeq = useRef(0)
  const hoverBranch = (ref: string | null) => {
    const seq = ++hoverSeq.current
    if (!ref || !repo || !prefs.highlightRowsOnRefHover || !/^refs\/(heads|remotes)\//.test(ref)) {
      setBranchHi(null)
      return
    }
    call('graph:branchRows', { repoId: repo.repoId, ref })
      .then((r) => seq === hoverSeq.current && setBranchHi(new Set(r.indices)))
      .catch(() => seq === hoverSeq.current && setBranchHi(null))
  }
  // los índices son del grafo cargado: otro repo u otra versión los invalida
  useEffect(() => {
    hoverSeq.current++
    setBranchHi(null)
  }, [repo?.repoId, graph?.version])

  // menú de la aplicación (main): Ctrl+/ y los demás atajos llegan como acción; zoom lo atiende main.
  // La ref apunta siempre al manejador del último render, que conoce el repo y el filtro vigentes
  const onMenu = useRef<(action: MenuAction) => void>(() => {})
  useEffect(
    () =>
      onAppEvent((ev) => {
        if (ev.type === 'menu') onMenu.current(ev.action)
      }),
    []
  )

  // cambios sin commit (fila WIP): la lista se pide al elegir la fila WIP y otra vez cuando sus
  // conteos cambian en vivo (H20); el diff abierto se queda
  const wipKey = selected?.kind === 'wip' && selected.wip ? JSON.stringify(selected.wip) : null
  useEffect(() => {
    if (!repo || !wipKey) return setWipFiles(null)
    let live = true
    call('wip:files', { repoId: repo.repoId }).then(
      (f) => live && setWipFiles(f),
      () => live && setWipFiles(null)
    )
    return () => {
      live = false
    }
  }, [repo, wipKey])

  // H20: tras una recarga en vivo, la selección sigue al mismo commit (o a la fila WIP con sus conteos nuevos)
  const reselect = useCallback(async (repoId: string) => {
    const cur = selectedRef.current
    if (!cur) return
    const index = cur.hash === WIP_HASH ? 0 : (await call('graph:find', { repoId, hash: cur.hash })).index
    const row = index === null ? null : ((await call('graph:rows', { repoId, offset: index, limit: 1 })).rows[0] ?? null)
    if (selectedRef.current?.hash !== cur.hash) return // el usuario eligió otra fila entretanto
    if (!row || row.hash !== cur.hash) {
      setSelected(null)
      setKeep({ index: -1, n: Date.now() })
    } else {
      setSelected(row)
      setKeep({ index: index!, n: Date.now() })
    }
  }, [])

  // historial completo llega por evento tras primera página
  useEffect(
    () =>
      onAppEvent((ev) => {
        if (ev.type === 'prefs:changed' || ev.type === 'clone:progress' || ev.type === 'menu' || ev.type === 'op:journal' || !repo || ev.repoId !== repo.repoId) return
        if (ev.type === 'graph:full') {
          setGraph((g) => (g ? { ...g, total: ev.total, maxLanes: ev.maxLanes, partial: false, version: ev.version } : g))
          setMetrics((m) => (m ? { ...m, fullMs: performance.now() - loadStart.current } : m))
        } else if (ev.type === 'repo:changed') {
          setGraph(ev.graph)
          setOperation(ev.operation)
          if (ev.kinds.includes('refs') || ev.kinds.includes('head')) {
            loadRefs(ev.repoId)
          }
          void reselect(ev.repoId).catch(() => {})
        } else if (ev.type === 'repo:watch') {
          setWatchMode(ev.mode)
        } else if (ev.type === 'repo:gone') {
          setGone(ev.root)
          setWatchMode('closed')
        } else {
          setError(ev.error)
        }
      }),
    [repo, reselect]
  )

  const checkEnv = useCallback(async (first: boolean) => {
    setChecking(true)
    try {
      const r = await call('env:check', {})
      setEnv(r)
      // primer arranque sin git usable: la pantalla de entorno dice qué instalar (H05)
      if (first && r.checks.some((c) => c.status === 'error')) setDialog('env')
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.info : { code: 'INTERNAL', message: String(e) })
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void checkEnv(true)
  }, [checkEnv])

  // otro repo u otra pestaña: el historial abierto era del anterior
  const repoKey = repo?.repoId ?? null
  useEffect(() => {
    setFileHist(null)
    setSearch(null)
    setCompare(null)
  }, [repoKey])

  // H18: al cambiar de commit se pide su detalle; una respuesta tardía de otro commit se descarta.
  // Depende del hash, no de la fila: tras una recarga en vivo (H20) el mismo commit no cierra el diff abierto
  const selectedHash = selected?.hash ?? null
  // fila agrupada: archivos y diffs contra el padre del más viejo del grupo, así suman todos sus commits
  const selectedBase = selected?.group ? (selected.group.parents[0] ?? EMPTY_TREE) : undefined
  useEffect(() => {
    setOpenFile(null)
    if (!repo || !selectedHash || selectedHash === WIP_HASH) return setCommitDetail(null)
    let live = true
    call('commit:detail', { repoId: repo.repoId, hash: selectedHash, base: selectedBase }).then(
      (d) => live && setCommitDetail(d),
      () => live && setCommitDetail(null)
    )
    return () => {
      live = false
    }
  }, [repo, selectedHash, selectedBase])

  const showError = (e: unknown) => setError(e instanceof ApiError ? e.info : { code: 'INTERNAL', message: String(e) })

  useEffect(() => {
    call('recents:get', {}).then(setRecents, () => setRecents([]))
  }, [])

  // pestañas instantáneas: lo último visto de cada repo abierto en esta sesión; openSeq descarta una apertura
  // que terminó después de que el usuario ya pasó a otra pestaña
  const snaps = useRef(new Map<string, { repo: Res<'repo:open'>; refs: RefsList | null }>())
  const openSeq = useRef(0)
  useEffect(() => {
    if (repo) snaps.current.set(repo.root.toLowerCase(), { repo, refs: refsList })
  }, [repo, refsList])

  const openPath = useCallback(async (path: string) => {
    const seq = ++openSeq.current
    const stale = () => seq !== openSeq.current
    setError(null)
    setBusy(true)
    try {
      // repo ya visto: se muestra con lo que había y repo:open (cabeza y operación al día) corre detrás
      const snap = snaps.current.get(path.toLowerCase())
      const opening = call('repo:open', { path })
      const r = snap?.repo ?? (await opening)
      if (stale()) return
      // la pestaña activa pasa a mostrar este repo (o se activa la que ya lo tenía)
      setTabs((s) => showRepo(s, s.active, r.root, r.name))
      // repo antes de cargar: evento de historial completo debe encontrarlo
      setRepo(r)
      setOperation(r.operation)
      setGraph(null)
      setSelected(null)
      call('recents:add', { path: r.root, name: r.name }).then(setRecents, () => {})
      const f = loadFilter(r.root)
      filterRef.current = f
      setFilterState(f)
      loadStart.current = performance.now()
      // reuse (N12): un repo ya cargado vuelve al instante; vigilado y completo, ni siquiera se recarga
      setRefsList(snap?.refs ?? null)
      call('refs:list', { repoId: r.repoId }).then((l) => !stale() && setRefsList(l), () => {})
      if (snap) {
        opening.then(
          (fresh) => {
            if (stale()) return
            setRepo(fresh)
            setOperation(fresh.operation)
          },
          () => {}
        )
      }
      const g = await call('graph:load', { repoId: r.repoId, reuse: true, filter: f })
      if (stale()) return
      setGraph(g)
      setMetrics({ gitMs: g.gitMs, buildMs: g.buildMs, firstPaintMs: null, fullMs: g.partial ? null : 0 })
      // H20: desde aquí, lo que cambie en git fuera de Fluxo llega solo
      setGone(null)
      setWatchMode(null)
      call('repo:watch', { repoId: r.repoId }).then(
        (w) => !stale() && setWatchMode(w.mode),
        () => !stale() && setWatchMode('closed')
      )
    } catch (e) {
      if (!stale()) showError(e)
    } finally {
      if (!stale()) setBusy(false)
    }
  }, [])

  // las pestañas de fondo siguen vigiladas; al cerrar una (o cambiarle el repo) su vigilancia se cierra
  const tabRoots = tabs.tabs.flatMap((tab) => (tab.path ? [tab.path] : [])).join('\n')
  useEffect(() => {
    call('repo:watchKeep', { roots: tabRoots ? tabRoots.split('\n') : [] }).catch(() => {})
  }, [tabRoots])

  // H15: cambiar el filtro guarda la vista del repo y recarga el grafo con ella
  const applyFilter = useCallback(
    async (f: GraphFilter) => {
      if (!repo) return
      filterRef.current = f
      setFilterState(f)
      saveFilter(repo.root, f)
      setSelected(null)
      try {
        setGraph(await call('graph:load', { repoId: repo.repoId, filter: f }))
      } catch (e) {
        showError(e)
      }
    },
    [repo]
  )

  // H16: clic en una rama del panel = ir a su commit en el grafo
  const goToCommit = useCallback(
    async (hash: string) => {
      if (!repo) return
      setNotice(null)
      const r = await call('graph:find', { repoId: repo.repoId, hash })
      if (r.index === null) setNotice(t('refs.notVisible'))
      else setJump({ index: r.index, n: Date.now() })
    },
    [repo, t]
  )

  // H23: página del commit, la rama o sus PR en GitHub o Azure DevOps, en el navegador del sistema
  const openWeb = useCallback(
    async (target: WebTarget) => {
      if (!repo) return
      setNotice(null)
      try {
        const { url } = await call('web:url', { repoId: repo.repoId, target })
        if (url) await call('app:openUrl', { url })
        else setNotice(t(target.kind === 'prs' ? 'web.noPrs' : 'web.unsupported'))
      } catch (e) {
        showError(e)
      }
    },
    [repo, t]
  )

  const openRepo = async () => {
    try {
      const picked = await call('app:pickRepo', {})
      if (picked.path) await openHere(picked.path)
    } catch (e) {
      showError(e)
    }
  }

  // A4: PR del remoto, al abrir el repo y después de cada fetch (no en cada cambio en vivo: la API tiene límite)
  const [prs, setPrs] = useState<{ list: PullRequest[]; needsLogin: boolean; provider: 'github' | 'azure' } | null>(null)
  const [prForm, setPrForm] = useState<{ head: string; base: string | undefined } | null>(null)
  // sube al cambiar la cuenta del repo (avatar): los PR se piden de nuevo con la cuenta nueva
  const [accountRev, setAccountRev] = useState(0)
  const prRepo = repo?.repoId ?? null
  useEffect(() => {
    setPrs(null)
    if (!prRepo) return
    let alive = true
    call('repo:pullRequests', { repoId: prRepo })
      .then((r) => alive && setPrs(r.provider ? { list: r.prs, needsLogin: r.needsLogin, provider: r.provider } : null))
      .catch(() => alive && setPrs(null))
    return () => {
      alive = false
    }
  }, [prRepo, fetchState.at, accountRev])

  // H10: fetch manual o automático; si trajo refs nuevas se recarga el grafo
  const doFetch = useCallback(
    async (auto: boolean) => {
      if (!repo) return
      setFetchState((s) => ({ ...s, running: true }))
      try {
        const r = await call('repo:fetch', { repoId: repo.repoId, auto })
        setFetchState({ running: false, at: Date.now(), error: null })
        if (r.changed) {
          const g = await call('graph:load', { repoId: repo.repoId, filter: filterRef.current })
          setGraph(g)
          loadRefs(repo.repoId)
        }
      } catch (e) {
        const info = e instanceof ApiError ? e.info : { code: 'INTERNAL' as const, message: String(e) }
        setFetchState((s) => ({ ...s, running: false, error: info.message }))
        // el autofetch no interrumpe con alertas: su error queda en la barra de estado
        if (!auto) {
          retry.current = () => void doFetch(false)
          setError(info)
        }
      }
    },
    [repo]
  )

  // botón Pull: primera escritura de Fluxo; si mueve algo, se recargan grafo y ramas
  // (la vigilancia en vivo también lo vería). Un fallo, incluidos los conflictos, sale en el aviso de error
  const [pulling, setPulling] = useState(false)
  const doPull = useCallback(
    async (mode: PullMode) => {
      if (!repo) return
      setPulling(true)
      try {
        const r = await call('repo:pull', { repoId: repo.repoId, mode })
        if (r.changed) {
          setGraph(await call('graph:load', { repoId: repo.repoId, filter: filterRef.current }))
          loadRefs(repo.repoId)
        }
      } catch (e) {
        retry.current = () => void doPull(mode)
        showError(e)
      } finally {
        setPulling(false)
      }
    },
    [repo]
  )

  // cuenta de GitHub del repo (avatar arriba a la derecha); el acceso de cada cuenta se prueba al abrir el menú
  // o cuando un pull, push o fetch falla por acceso. retry = la última operación de red, para «… y reintentar»
  const [account, setAccount] = useState<RepoAccount | null>(null)
  const [access, setAccess] = useState<Record<string, AccountAccess> | null>(null)
  const retry = useRef<(() => void) | null>(null)
  const accountRepo = repo?.repoId ?? null
  const loadAccount = useCallback(() => {
    if (!accountRepo) return setAccount(null)
    call('repo:account', { repoId: accountRepo }).then(setAccount, () => setAccount(null))
  }, [accountRepo])
  useEffect(() => {
    setAccess(null)
    loadAccount()
  }, [loadAccount])
  const checkAccess = useCallback(() => {
    if (!accountRepo) return
    call('repo:accountAccess', { repoId: accountRepo }).then((r) => setAccess(r.access), () => {})
  }, [accountRepo])
  // un pull, push o fetch rechazado por acceso: se prueban las cuentas para ofrecer la que sí entra
  const accessError = !!error && /Repository not found|SAML SSO|re-authorize|error: 40[13]|Authentication failed|could not read Username/i.test(error.gitOutput ?? '')
  useEffect(() => {
    if (accessError) checkAccess()
  }, [accessError, checkAccess])
  const okAccounts = access ? Object.keys(access).filter((a) => access[a] === 'ok') : []
  const fixAccount = okAccounts.find((a) => a !== account?.current) ?? null
  const ssoAccount = !fixAccount && access ? (Object.keys(access).find((a) => access[a] === 'sso') ?? null) : null
  const [accountMenuAt, setAccountMenuAt] = useState(0)
  const pickAccount = useCallback(
    async (name: string | null, then?: () => void) => {
      if (!accountRepo) return
      try {
        await call('repo:setAccount', { repoId: accountRepo, account: name })
        loadAccount()
        setAccountRev((n) => n + 1)
        then?.()
      } catch (e) {
        showError(e)
      }
    },
    [accountRepo, loadAccount]
  )

  // Push como GitKraken: al upstream sin preguntar; sin upstream, diálogo de destino; rechazado, Pull o force
  const [pushing, setPushing] = useState(false)
  const [pushDlg, setPushDlg] = useState<PushDialog | null>(null)
  const doPush = useCallback(
    async (req: PushRequest = {}) => {
      if (!repo) return
      setPushing(true)
      try {
        if (!req.to && !req.forceExpected) {
          const target = await call('repo:pushTarget', { repoId: repo.repoId })
          if (!target.upstream) {
            setPushDlg({ kind: 'publish', target })
            return
          }
        }
        const r = await call('repo:push', { repoId: repo.repoId, ...req })
        setPushDlg(r.status === 'rejected' ? { kind: 'rejected', r } : null)
        // el rechazo trajo la rama remota: también cambia el grafo
        if (r.status === 'rejected' || r.changed) {
          setGraph(await call('graph:load', { repoId: repo.repoId, filter: filterRef.current }))
          loadRefs(repo.repoId)
        }
      } catch (e) {
        setPushDlg(null)
        retry.current = () => void doPush(req)
        showError(e)
      } finally {
        setPushing(false)
      }
    },
    [repo]
  )

  // cambiar de rama con doble clic sobre su etiqueta (grafo o panel); si cambió algo, se recargan grafo y ramas
  const doCheckout = useCallback(
    async (ref: string) => {
      if (!repo) return
      try {
        const r = await call('repo:checkout', { repoId: repo.repoId, ref })
        if (r.changed) {
          setGraph(await call('graph:load', { repoId: repo.repoId, filter: filterRef.current }))
          loadRefs(repo.repoId)
        }
      } catch (e) {
        showError(e)
      }
    },
    [repo]
  )

  // cherry pick sobre la rama actual (segunda escritura de Fluxo); la vigilancia en vivo también vería el cambio
  const doCherryPick = useCallback(
    async (hashes: string[]) => {
      if (!repo) return
      try {
        await call('repo:cherryPick', { repoId: repo.repoId, hashes })
        setGraph(await call('graph:load', { repoId: repo.repoId, filter: filterRef.current }))
        loadRefs(repo.repoId)
      } catch (e) {
        showError(e)
      }
    },
    [repo]
  )

  const ask = useAsk()
  const [irebase, setIrebase] = useState<{ ref: string; onto: string; current: string; commits: RebaseRow[] } | null>(null)
  const reloadAfterWrite = useCallback(async () => {
    if (!repo) return
    // refs y WIP primero: si el grafo lo reemplaza una carga más reciente (error «Carga reemplazada»), el panel no queda viejo
    loadRefs(repo.repoId)
    call('wip:files', { repoId: repo.repoId }).then(setWipFiles, () => {})
    setGraph(await call('graph:load', { repoId: repo.repoId, filter: filterRef.current }))
  }, [repo])

  // «Crear rama aquí» (menú del commit y botón Branch): pide el nombre y crea la rama sin cambiarse a ella
  const doCreateBranch = useCallback(
    async (at: string) => {
      if (!repo) return
      const name = await ask.askText({
        title: t('ask.branchTitle'),
        label: t('ask.branchLabel', { sha: at.slice(0, 7) }),
        ok: t('ask.branchOk')
      })
      if (!name) return
      try {
        await call('repo:createBranch', { repoId: repo.repoId, name, at })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askText, reloadAfterWrite, t]
  )

  // Pull / Push de una rama que no es la actual
  const doOtherBranch = useCallback(
    async (kind: 'pull' | 'push', branch: string) => {
      if (!repo) return
      try {
        await call(kind === 'pull' ? 'repo:pullBranch' : 'repo:pushBranch', { repoId: repo.repoId, branch })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, reloadAfterWrite]
  )

  // Interactive Rebase: se piden los commits de la rama actual que no están en la otra y se abre la lista
  const openInteractiveRebase = useCallback(
    async (b: { name: string; ref: string }, current: string) => {
      if (!repo) return
      try {
        const r = await call('repo:rebasePlan', { repoId: repo.repoId, ref: b.ref })
        setIrebase({ ref: b.ref, onto: b.name, current, commits: r.commits })
      } catch (e) {
        showError(e)
      }
    },
    [repo]
  )
  const startInteractiveRebase = useCallback(
    async (steps: RebaseChoice[]) => {
      if (!repo || !irebase) return
      const ref = irebase.ref
      setIrebase(null)
      try {
        const r = await call('repo:rebaseInteractive', { repoId: repo.repoId, ref, steps })
        if (r.status === 'conflict') setNotice(t('notice.conflict'))
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, irebase, reloadAfterWrite, t]
  )

  // Checkout de un commit, worktree, editar mensaje y quitar commit
  const doCheckoutCommit = useCallback(
    async (hash: string) => {
      if (!repo) return
      try {
        await call('repo:checkoutCommit', { repoId: repo.repoId, hash })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, reloadAfterWrite]
  )
  // «Create worktree from…»: panel con la referencia, la rama nueva opcional y la carpeta
  const [worktreeForm, setWorktreeForm] = useState<{ hash: string; ref: string | null } | null>(null)
  const doWorktree = useCallback((hash: string, ref: string | null) => setWorktreeForm({ hash, ref }), [])
  const doEditMessage = useCallback(
    async (hash: string, subject: string) => {
      if (!repo) return
      const message = await ask.askText({
        title: t('ask.editMsgTitle'),
        label: t('ask.editMsgLabel', { sha: hash.slice(0, 7) }),
        initial: subject,
        ok: t('ask.editMsgOk'),
        multiline: true
      })
      if (!message || message === subject) return
      try {
        await call('repo:editMessage', { repoId: repo.repoId, hash, message })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askText, reloadAfterWrite, t]
  )
  const doDrop = useCallback(
    async (hash: string, subject: string) => {
      if (!repo) return
      if (!(await ask.askConfirm({ title: t('ask.dropTitle'), body: t('ask.dropBody', { subject }), ok: t('ask.dropOk') }))) return
      try {
        const r = await call('repo:dropCommit', { repoId: repo.repoId, hash })
        if (r.status === 'conflict') setNotice(t('notice.conflict'))
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askConfirm, reloadAfterWrite, t]
  )

  const doMove = useCallback(
    async (hash: string, dir: 'up' | 'down') => {
      if (!repo) return
      try {
        const r = await call('repo:moveCommit', { repoId: repo.repoId, hash, dir })
        if (r.status === 'conflict') setNotice(t('notice.conflict'))
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, reloadAfterWrite, t]
  )

  // Remotos: agregar, editar, quitar y fetch de uno
  const [remoteForm, setRemoteForm] = useState<RemoteForm | null>(null)
  const doRemoteSave = useCallback(
    async (f: RemoteForm) => {
      if (!repo) return
      try {
        const pushUrl = f.pushUrl || null
        if (f.editing) await call('remote:edit', { repoId: repo.repoId, name: f.editing, newName: f.name, pullUrl: f.pullUrl, pushUrl })
        else await call('remote:add', { repoId: repo.repoId, name: f.name, pullUrl: f.pullUrl, pushUrl })
        setRemoteForm(null)
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, reloadAfterWrite]
  )
  const doRemoteOp = useCallback(
    async (op: 'fetch' | 'edit' | 'remove', name: string) => {
      if (!repo) return
      try {
        if (op === 'edit') {
          const r = (await call('repo:remotes', { repoId: repo.repoId })).remotes.find((x) => x.name === name)
          if (r) setRemoteForm({ editing: name, name, pullUrl: r.pullUrl, pushUrl: r.pushUrl ?? '' })
          return
        }
        if (op === 'remove') {
          if (!(await ask.askConfirm({ title: t('ask.removeRemoteTitle'), body: t('ask.removeRemoteBody', { name }), ok: t('ask.removeRemoteOk') }))) return
          await call('remote:remove', { repoId: repo.repoId, name })
        } else {
          await call('remote:fetch', { repoId: repo.repoId, name })
        }
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askConfirm, reloadAfterWrite, t]
  )

  // Borrar / subir un tag desde el panel
  const doTagOp = useCallback(
    async (op: 'delete' | 'deleteRemote' | 'deleteBoth' | 'push', name: string, remote: string | null) => {
      if (!repo) return
      try {
        if (op === 'push') {
          await call('repo:pushTag', { repoId: repo.repoId, name, ...(remote ? { remote } : {}) })
        } else {
          const what = op === 'delete' ? name : op === 'deleteRemote' ? `${remote ?? 'origin'}/${name}` : `${name} + ${remote ?? 'origin'}/${name}`
          if (!(await ask.askConfirm({ title: t('ask.deleteTagTitle'), body: t('ask.deleteTagBody', { what }), ok: t('ask.deleteOk') }))) return
          await call('repo:deleteTag', { repoId: repo.repoId, name, scope: op === 'delete' ? 'local' : op === 'deleteRemote' ? 'remote' : 'both', ...(remote ? { remote } : {}) })
        }
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askConfirm, reloadAfterWrite, t]
  )
  const doRestoreFile = useCallback(
    async (hash: string, file: string) => {
      if (!repo) return
      if (!(await ask.askConfirm({ title: t('ask.restoreTitle'), body: t('ask.restoreBody', { file, sha: hash.slice(0, 7) }), ok: t('ask.restoreOk') }))) return
      try {
        await call('wip:restore', { repoId: repo.repoId, hash, paths: [file] })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askConfirm, reloadAfterWrite, t]
  )

  // Undo / Redo de la barra: se piden de nuevo cuando cambia el repo (los eventos en vivo ya recargan refs)
  const [undoInfo, setUndoInfo] = useState<{ undo: { label: string } | null; redo: { label: string } | null }>({ undo: null, redo: null })
  useEffect(() => {
    if (!repo) return setUndoInfo({ undo: null, redo: null })
    call('repo:undoInfo', { repoId: repo.repoId }).then(setUndoInfo, () => setUndoInfo({ undo: null, redo: null }))
  }, [repo, refsList, operation])
  const doUndo = useCallback(
    async (action: 'undo' | 'redo') => {
      if (!repo) return
      try {
        await call('repo:undo', { repoId: repo.repoId, action })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, reloadAfterWrite]
  )
  // Ctrl+Z / Ctrl+Y (o Ctrl+Mayús+Z) fuera de los campos de texto, como en GitKraken
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (!e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey && undoInfo.undo) (e.preventDefault(), void doUndo('undo'))
      else if ((k === 'y' || (k === 'z' && e.shiftKey)) && undoInfo.redo) (e.preventDefault(), void doUndo('redo'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoInfo, doUndo])

  // Reset / Revert / Create tag desde el menú del commit
  const doReset = useCallback(
    async (hash: string, mode: 'soft' | 'mixed' | 'hard', branch: string) => {
      if (!repo) return
      if (mode === 'hard' && !(await ask.askConfirm({ title: t('ask.resetHardTitle'), body: t('ask.resetHardBody', { branch, sha: hash.slice(0, 7) }), ok: t('ask.resetHardOk') }))) return
      try {
        await call('repo:reset', { repoId: repo.repoId, hash, mode })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askConfirm, reloadAfterWrite, t]
  )
  const doRevert = useCallback(
    async (hash: string) => {
      if (!repo) return
      try {
        const r = await call('repo:revert', { repoId: repo.repoId, hash })
        if (r.status === 'conflict') setNotice(t('notice.conflict'))
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, reloadAfterWrite, t]
  )
  const doTag = useCallback(
    async (hash: string, annotated: boolean) => {
      if (!repo) return
      const name = await ask.askText({ title: t('ask.tagTitle'), label: t('ask.tagLabel', { sha: hash.slice(0, 7) }), ok: t('ask.tagOk') })
      if (!name) return
      let message: string | undefined
      if (annotated) {
        const m = await ask.askText({ title: t('ask.tagTitle'), label: t('ask.tagMessageLabel'), ok: t('ask.tagOk'), multiline: true })
        if (!m) return
        message = m
      }
      try {
        await call('repo:createTag', { repoId: repo.repoId, hash, name, ...(message ? { message } : {}) })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askText, reloadAfterWrite, t]
  )

  // Fast-forward / Merge / Rebase / Rename / Delete / Set Upstream desde el menú de la rama
  const doIntegrate = useCallback(
    async (kind: 'ff' | 'merge' | 'rebase', b: { name: string; ref: string }, current: string) => {
      if (!repo) return
      try {
        const r = await call('repo:integrate', { repoId: repo.repoId, kind, ref: b.ref })
        setNotice(r.status === 'done' ? t('notice.integrated', { other: b.name, current }) : t('notice.conflict'))
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, reloadAfterWrite, t]
  )
  const doOperation = useCallback(
    async (action: 'abort' | 'continue' | 'skip') => {
      if (!repo) return
      try {
        await call('repo:operation', { repoId: repo.repoId, action })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, reloadAfterWrite]
  )
  const doRename = useCallback(
    async (name: string) => {
      if (!repo) return
      const to = await ask.askText({ title: t('ask.renameTitle'), label: t('ask.renameLabel', { branch: name }), initial: name, ok: t('ask.renameOk') })
      if (!to || to === name) return
      try {
        await call('repo:renameBranch', { repoId: repo.repoId, from: name, to })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askText, reloadAfterWrite, t]
  )
  const doDeleteBranch = useCallback(
    async (b: { name: string; ref: string; remoteOnly?: boolean }, scope: 'local' | 'remote' | 'both', remote: string | null) => {
      if (!repo) return
      const what = scope === 'local' ? b.name : scope === 'remote' ? (remote ?? b.name) : `${b.name} + ${remote ?? ''}`
      if (!(await ask.askConfirm({ title: t('ask.deleteBranchTitle'), body: t('ask.deleteBranchBody', { what }), ok: t('ask.deleteOk') }))) return
      // remoto: `origin/feat` → remoto `origin`, rama `feat`
      const full = scope === 'local' ? null : b.remoteOnly ? b.name : remote
      const slash = full ? full.indexOf('/') : -1
      try {
        await call('repo:deleteBranch', {
          repoId: repo.repoId,
          name: scope === 'remote' && full ? full.slice(slash + 1) : b.name,
          scope,
          ...(full && slash > 0 ? { remote: full.slice(0, slash) } : {})
        })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askConfirm, reloadAfterWrite, t]
  )
  const doSetUpstream = useCallback(
    async (name: string, current: string | null) => {
      if (!repo) return
      const value = await ask.askText({
        title: t('ask.upstreamTitle'),
        label: t('ask.upstreamLabel', { branch: name }),
        initial: current ?? `origin/${name}`,
        ok: t('ask.upstreamOk')
      })
      if (!value) return
      const slash = value.indexOf('/')
      if (slash < 1 || slash === value.length - 1) {
        setNotice(t('ask.upstreamBad', { branch: name }))
        return
      }
      try {
        await call('repo:setUpstream', { repoId: repo.repoId, branch: name, remote: value.slice(0, slash), remoteBranch: value.slice(slash + 1) })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askText, reloadAfterWrite, t]
  )

  // Borrar varias ramas locales de una vez (Shift/Ctrl en el panel); la actual no se borra
  const doDeleteMany = useCallback(
    async (names: string[]) => {
      if (!repo) return
      const current = refsList?.local.find((b) => b.current)?.name
      const list = names.filter((n) => n !== current)
      if (list.length === 0) {
        setNotice(t('cm.deleteCurrent'))
        return
      }
      const body = list.length === 1 ? t('ask.deleteBranchBody', { what: list[0]! }) : t('ask.deleteManyBody', { n: String(list.length), names: list.join('\n') })
      if (!(await ask.askConfirm({ title: t('ask.deleteBranchTitle'), body, ok: t('ask.deleteOk') }))) return
      try {
        for (const name of list) await call('repo:deleteBranch', { repoId: repo.repoId, name, scope: 'local' })
      } catch (e) {
        showError(e)
      }
      await reloadAfterWrite()
    },
    [repo, refsList, ask.askConfirm, reloadAfterWrite, t]
  )

  // Soltar una rama sobre otra: menú con Fast-forward, Merge, Rebase e Interactive Rebase
  const [dropMenu, setDropMenu] = useState<{ x: number; y: number; from: { name: string; ref: string }; to: { name: string; ref: string } } | null>(null)
  const branchOfRow = useCallback(
    (row: { hash: string }) => {
      const here = refsList?.local.filter((b) => b.hash === row.hash) ?? []
      const b = here.find((x) => x.current) ?? here[0]
      return b ? { name: b.name, ref: b.ref } : null
    },
    [refsList]
  )
  const runDrop = useCallback(
    async (kind: 'ff' | 'merge' | 'rebase' | 'interactive' | 'push') => {
      if (!repo || !dropMenu) return
      const { from, to } = dropMenu
      if (kind === 'push') {
        // «Push X to origin/Y»: sube X a la rama remota de Y (sin cambiarse de rama, sin force)
        const up = refsList?.local.find((b) => b.ref === to.ref)?.upstream
        const slash = up ? up.indexOf('/') : -1
        if (!up || slash < 1) return
        try {
          await call('repo:pushBranch', { repoId: repo.repoId, branch: from.name, to: { remote: up.slice(0, slash), branch: up.slice(slash + 1) } })
          await reloadAfterWrite()
        } catch (e) {
          showError(e)
        }
        return
      }
      // la rama sobre la que se actúa tiene que estar activa: se cambia a ella antes (si choca con tus cambios, git lo dice)
      const actOn = kind === 'ff' || kind === 'merge' ? to : from
      try {
        if (refsList?.local.find((b) => b.current)?.ref !== actOn.ref) {
          await call('repo:checkout', { repoId: repo.repoId, ref: actOn.ref })
          await reloadAfterWrite()
        }
        if (kind === 'ff') await doIntegrate('ff', from, to.name)
        else if (kind === 'merge') await doIntegrate('merge', from, to.name)
        else if (kind === 'rebase') await doIntegrate('rebase', to, from.name)
        else await openInteractiveRebase(to, from.name)
      } catch (e) {
        showError(e)
      }
    },
    [repo, dropMenu, refsList, reloadAfterWrite, doIntegrate, openInteractiveRebase]
  )

  // Stash de la barra (todo) o de archivos sueltos; el mensaje se pide en un cuadro
  const doStash = useCallback(
    async (paths?: string[]) => {
      if (!repo) return
      const message = await ask.askText({ title: t('ask.stashTitle'), label: t('ask.stashLabel'), ok: t('ask.stashOk'), allowEmpty: true })
      if (message === null) return
      try {
        await call('repo:stash', { repoId: repo.repoId, message: message || undefined, paths, includeUntracked: true })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askText, reloadAfterWrite, t]
  )

  const doStashOp = useCallback(
    async (op: 'apply' | 'pop' | 'drop' | 'rename', s: { hash: string; message: string }) => {
      if (!repo) return
      try {
        if (op === 'drop') {
          if (!(await ask.askConfirm({ title: t('ask.dropStashTitle'), body: t('ask.dropStashBody', { message: s.message }), ok: t('ask.deleteOk') }))) return
          await call('repo:stashDrop', { repoId: repo.repoId, hash: s.hash })
        } else if (op === 'rename') {
          const message = await ask.askText({ title: t('ask.stashEditTitle'), label: t('ask.stashLabel'), initial: s.message, ok: t('ask.stashOk') })
          if (!message) return
          await call('repo:stashRename', { repoId: repo.repoId, hash: s.hash, message })
        } else {
          await call('repo:stashApply', { repoId: repo.repoId, hash: s.hash, pop: op === 'pop' })
        }
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
        void reloadAfterWrite()
      }
    },
    [repo, ask.askText, ask.askConfirm, reloadAfterWrite, t]
  )

  // comandos de la paleta que escriben en el repo
  const runCommand = async (id: string) => {
    if (!repo) return
    try {
      if (id === 'stashCreate') await doStash()
      else if (id === 'stageAll' || id === 'unstageAll') {
        await call(id === 'stageAll' ? 'wip:stage' : 'wip:unstage', { repoId: repo.repoId })
        await reloadAfterWrite()
      }
      else if (id === 'stashApply' && refsList?.stashes[0]) await doStashOp('apply', refsList.stashes[0])
      else if (id === 'createFile') {
        const path = await ask.askText({ title: t('ask.fileTitle'), label: t('ask.fileLabel'), ok: t('ask.fileOk') })
        if (path) {
          await call('wip:createFile', { repoId: repo.repoId, path })
          await reloadAfterWrite()
        }
      } else if (id === 'discardAll') {
        if (await ask.askConfirm({ title: t('ask.discardTitle'), body: t('ask.discardAllBody'), ok: t('ask.discardOk') })) {
          await call('wip:discard', { repoId: repo.repoId })
          await reloadAfterWrite()
        }
      }
    } catch (e) {
      showError(e)
    }
  }

  const stageAllRef = useRef<() => void>(() => {})
  stageAllRef.current = () => void runCommand('stageAll')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        stageAllRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const doSquash = useCallback(
    async (hashes: string[]) => {
      if (!repo) return
      try {
        await call('repo:squash', { repoId: repo.repoId, hashes })
        setGraph(await call('graph:load', { repoId: repo.repoId, filter: filterRef.current }))
        loadRefs(repo.repoId)
      } catch (e) {
        showError(e)
      }
    },
    [repo]
  )

  useEffect(() => {
    if (!repo) return
    return scheduleAutoFetch(prefs.autoFetchMinutes, () => void doFetch(true))
  }, [repo, prefs.autoFetchMinutes, doFetch])

  const removeFromRecents = (path: string) => {
    call('recents:remove', { path }).then(setRecents, showError)
  }

  const envProblem = env && (!env.gitFound || !env.gitVersionOk)

  // pestaña nueva o sin repo: la vista vuelve a «Repositorios»
  const clearRepo = useCallback(() => {
    setRepo(null)
    setGraph(null)
    setSelected(null)
    setRefsList(null)
    setOperation(null)
    setWatchMode(null)
    setGone(null)
    setMetrics(null)
    setError(null)
  }, [])

  /** Cambia a otro estado de pestañas y muestra el repo de la activa. */
  const switchTabs = useCallback(
    (next: Tabs) => {
      const before = activeTab(tabsRef.current)
      setTabs(next)
      const tab = activeTab(next)
      if (tab.id === before.id && tab.path === before.path) return
      if (tab.path) void openPath(tab.path)
      else clearRepo()
    },
    [openPath, clearRepo, setTabs]
  )

  /** Abre un repo: en la pestaña activa si está vacía; si no, en una nueva. */
  const openHere = useCallback(
    (path: string) => {
      if (activeTab(tabsRef.current).path !== null) setTabs(newTab(tabsRef.current))
      return openPath(path)
    },
    [openPath, setTabs]
  )

  // Menú de un worktree del panel: abrir, quitar (con o sin su rama) y bloquear
  const doWorktreeOp = useCallback(
    async (op: 'open' | 'openTab' | 'remove' | 'removeBranch' | 'removeBranchRemote' | 'lock' | 'unlock', w: { path: string; branch: string | null }) => {
      if (!repo) return
      try {
        if (op === 'open') return void (await openPath(w.path))
        if (op === 'openTab') return void (await openHere(w.path))
        if (op === 'lock' || op === 'unlock') {
          await call('worktree:lock', { repoId: repo.repoId, path: w.path, lock: op === 'lock' })
        } else {
          const withBranch = (op === 'removeBranch' || op === 'removeBranchRemote') && !!w.branch
          // «local y remota»: la copia de la rama en el remoto que la sigue (origin/rama)
          const remoteRef = op === 'removeBranchRemote' && w.branch ? refsList?.remote.find((r) => r.name.endsWith(`/${w.branch}`))?.name : undefined
          const body = remoteRef
            ? t('ask.removeWorktreeRemoteBody', { path: w.path, branch: w.branch ?? '', remote: remoteRef })
            : withBranch
              ? t('ask.removeWorktreeBranchBody', { path: w.path, branch: w.branch ?? '' })
              : t('ask.removeWorktreeBody', { path: w.path })
          if (!(await ask.askConfirm({ title: t('ask.removeWorktreeTitle'), body, ok: t('ask.removeWorktreeOk') }))) return
          await call('worktree:remove', { repoId: repo.repoId, path: w.path, deleteBranch: withBranch })
          if (remoteRef && w.branch) await call('repo:deleteBranch', { repoId: repo.repoId, name: w.branch, scope: 'remote', remote: remoteRef.slice(0, remoteRef.indexOf('/')) })
        }
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, ask.askConfirm, reloadAfterWrite, t, openPath, openHere, refsList]
  )

  // Menú de un submódulo del panel: Initialize, Update y abrirlo como repo en una pestaña
  const doSubmoduleOp = useCallback(
    async (op: 'init' | 'update' | 'stage' | 'commit' | 'edit' | 'open' | 'delete', s: Submodule) => {
      if (!repo) return
      try {
        if (op === 'open') return void (await openHere(`${repo.root.replace(/[\/]+$/, '')}/${s.path}`))
        if (op === 'edit') return void setSubmoduleEdit(s)
        if (op === 'commit') {
          // como GitKraken: commit del puntero; si ya hay otros cambios en stage, pregunta si van también
          const staged = (await call('wip:files', { repoId: repo.repoId })).staged
          const others = staged.filter((f) => f.path !== s.path && f.path !== '.gitmodules')
          if (others.length > 0 && !(await ask.askConfirm({ title: t('ask.commitStagedTitle'), body: t('ask.commitStagedBody'), ok: t('ask.commitStagedOk') }))) return
          if (!staged.some((f) => f.path === s.path)) await call('wip:stage', { repoId: repo.repoId, paths: [s.path] })
          await call('wip:commit', { repoId: repo.repoId, message: `${s.state === 'uncommitted' ? 'Added' : 'Updated'} submodule ${s.name}`, amend: false })
          await reloadAfterWrite()
          return
        }
        if (op === 'delete') {
          if (!(await ask.askConfirm({ title: t('ask.deleteSubmoduleTitle'), body: t('ask.deleteSubmoduleBody', { path: s.path }), ok: t('ask.deleteSubmoduleOk'), danger: true }))) return
          await call('submodule:delete', { repoId: repo.repoId, path: s.path })
        } else if (op === 'stage') await call('wip:stage', { repoId: repo.repoId, paths: [s.path] })
        else await call('submodule:update', { repoId: repo.repoId, path: s.path, init: op === 'init' })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    },
    [repo, reloadAfterWrite, openHere, ask.askConfirm, t]
  )

  useEffect(() => {
    const path = cloneOffer.current
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const same = (a: string, b: string) => norm(a) === norm(b)
    if (!path || !repo || !refsList || !same(repo.root, path)) return
    cloneOffer.current = null
    const pending = refsList.submodules.filter((s) => s.state === 'uninitialized')
    if (pending.length === 0) return
    void (async () => {
      if (!(await ask.askConfirm({ title: t('ask.submodulesTitle'), body: t('ask.submodulesBody', { n: pending.length }), ok: t('ask.submodulesOk') }))) return
      try {
        for (const s of pending) await call('submodule:update', { repoId: repo.repoId, path: s.path, init: true })
        await reloadAfterWrite()
      } catch (e) {
        showError(e)
      }
    })()
  }, [refsList, repo, ask.askConfirm, reloadAfterWrite, t])

  // H08 y «Remember tabs»: al arrancar, con git listo, vuelven las pestañas guardadas o el último repo
  useEffect(() => {
    if (reopened.current || !env || envProblem || recents === null) return
    reopened.current = true
    const saved = loadTabs()
    if (saved) switchTabs(saved)
    else if (recents[0]) void openHere(recents[0].path)
    // nada que abrir: la pantalla de carga se cierra ya (si hay repo, al pintar el grafo)
    const opening = saved ? !!saved.tabs.find((tab) => tab.id === saved.active)?.path : !!recents[0]
    if (!opening) appReady()
  }, [env, envProblem, recents, switchTabs, openHere])

  // A11: git con problemas o un error al abrir también cierran la pantalla de carga, para que se vea el aviso
  useEffect(() => {
    if (envProblem || error) appReady()
  }, [envProblem, error])

  // se guardan solo después de restaurarlas: la pestaña vacía inicial no pisa las guardadas
  useEffect(() => {
    if (reopened.current) saveTabs(tabs)
  }, [tabs])

  const fetchRows = useCallback(
    async (offset: number, limit: number) => {
      if (!repo) return { version: -1, rows: [] }
      return call('graph:rows', { repoId: repo.repoId, offset, limit })
    },
    [repo]
  )

  const findNeighbor = useCallback(
    async (index: number, dir: 'parent' | 'child') => {
      if (!repo) return null
      return (await call('graph:neighbor', { repoId: repo.repoId, index, dir })).index
    },
    [repo]
  )

  const onFirstPaint = useCallback(() => {
    setMetrics((m) => (m ? { ...m, firstPaintMs: performance.now() - loadStart.current } : m))
    appReady()
  }, [])

  // menú de la aplicación: lo que no puede hacer main porque depende del repo y del filtro abiertos
  onMenu.current = (action) => {
    const blocked = busy || !!envProblem
    const outside = (target: 'terminal' | 'explorer' | 'editor') => {
      if (repo) void call('app:openIn', { target, path: repo.root }).catch(showError)
      else setNotice(t('menu.needRepo'))
    }
    if (action === 'open') {
      if (!blocked) void openRepo()
    } else if (action === 'clone') {
      if (!blocked) setDialog('clone')
    } else if (action === 'init') {
      if (!blocked) setDialog('init')
    } else if (action === 'addSubmodule') {
      if (repo && !blocked) setDialog('submodule')
      else setNotice(t('menu.needRepo'))
    } else if (action === 'prefs') setDialog('prefs')
    else if (action === 'shortcuts') setDialog((d) => (d === 'shortcuts' ? null : 'shortcuts'))
    else if (action === 'env') setDialog('env')
    else if (action === 'palette') setDialog((d) => (d === 'palette' ? null : 'palette'))
    else if (action === 'guide' || action === 'releaseNotes' || action === 'about') setDialog(action)
    else if (action === 'findCommits') {
      if (repo && graph) setSearch(Date.now())
      else setNotice(t('menu.needRepo'))
    } else if (action === 'fileHistory') {
      if (repo) setDialog('fileSearch')
      else setNotice(t('menu.needRepo'))
    }
    else if (action === 'viewAll') void applyFilter({ ...filterRef.current, mode: 'all' })
    else if (action === 'viewCurrent') void applyFilter({ ...filterRef.current, mode: 'current' })
    else if (action === 'toggleLeft') setShowLeft((v) => !v)
    else if (action === 'toggleDetail') setShowDetail((v) => !v)
    else if (action === 'openTerminal') outside('terminal')
    else if (action === 'openExplorer') outside('explorer')
    else if (action === 'openEditor') outside('editor')
    else if (action === 'newTab') switchTabs(newTab(tabsRef.current))
    else if (action === 'closeTab') switchTabs(closeTab(tabsRef.current, tabsRef.current.active))
    else if (action === 'reopenTab') {
      const r = reopenClosed(tabsRef.current)
      if (r.path) {
        setTabs(r.tabs)
        void openPath(r.path)
      }
    } else if (action === 'nextTab') switchTabs(cycleTab(tabsRef.current, 1))
    else if (action === 'prevTab') switchTabs(cycleTab(tabsRef.current, -1))
    else switchTabs(tabAt(tabsRef.current, Number(action.slice(3))))
  }

  // rama de HEAD según el panel de ramas (se recarga en vivo, H20)
  const currentBranch = refsList?.local.find((b) => b.current) ?? null
  // Push en gris con su motivo (null = se puede) y el destino en el texto al pasar el ratón
  const pushWhy = !repo ? '' : !repo.head ? t('push.detached') : currentBranch?.upstream && !currentBranch.gone && currentBranch.ahead === 0 ? t('push.nothing') : null
  const pushTitle = currentBranch?.upstream
    ? t('push.to', { branch: currentBranch.name, upstream: currentBranch.upstream, n: currentBranch.ahead })
    : currentBranch
      ? t('push.publish')
      : 'Push'

  // menú del commit: rama local que apunta a esa fila (la actual primero)
  const menuBranch = (() => {
    if (!commitMenu || !refsList) return null
    const here = refsList.local.filter((b) => b.hash === commitMenu.row.hash)
    const b = here.find((x) => x.ref === commitMenu.ref) ?? here.find((x) => x.current) ?? here[0]
    if (b) return { name: b.name, ref: b.ref, current: b.current }
    // sin rama local en el commit: una remota (`origin/X`) tiene su propio menú
    const r = refsList.remote.find((x) => x.hash === commitMenu.row.hash && !x.name.endsWith('/HEAD'))
    return r ? { name: r.name, ref: r.ref, current: false, remoteOnly: true } : null
  })()

  // «Start a pull request»: solo con remoto de GitHub y sobre una rama
  const prEntry =
    prs?.provider === 'github' && menuBranch && currentBranch
      ? prMenuEntry(menuBranch, refsList?.local.find((b) => b.ref === menuBranch.ref)?.upstream ?? null, currentBranch.name)
      : null

  // cherry pick: la selección si el clic derecho cayó dentro de ella; si no, solo ese commit. Del más viejo
  // (más abajo en el grafo) al más nuevo
  const pickRows = !commitMenu
    ? []
    : multi.some((m) => m.row.hash === commitMenu.row.hash)
      ? [...multi].sort((a, b) => b.index - a.index).map((m) => m.row)
      : [commitMenu.row]

  // commits que ya están en la rama actual: el cherry pick se ve en gris con el motivo (undefined = consultando);
  // con dos o más, también se pregunta si se puede hacer squash
  const pickKey = pickRows.map((r) => r.hash).join(',')
  const [pickInHistory, setPickInHistory] = useState<string | null | undefined>(undefined)
  const [squashWhy, setSquashWhy] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    setPickInHistory(undefined)
    setSquashWhy(undefined)
    if (!pickKey || !repo) return
    let alive = true
    const hashes = pickKey.split(',')
    call('repo:inHistory', { repoId: repo.repoId, hashes })
      .then((r) => alive && setPickInHistory(r.hash))
      .catch(() => alive && setPickInHistory(null))
    if (hashes.length > 1) {
      call('repo:squashCheck', { repoId: repo.repoId, hashes })
        .then((r) => alive && setSquashWhy(r.why))
        .catch((e) => alive && setSquashWhy(e instanceof Error ? e.message : String(e)))
    }
    return () => {
      alive = false
    }
  }, [pickKey, repo])

  /** Copiar el enlace web de un commit o una rama (menú del commit). */
  const copyLink = async (target: WebTarget) => {
    if (!repo) return
    try {
      const { url } = await call('web:url', { repoId: repo.repoId, target })
      if (!url) return setNotice(t('web.unsupported'))
      await call('app:copy', { text: url })
      setNotice(t('cm.linkCopied'))
    } catch (e) {
      showError(e)
    }
  }

  return (
    <div className="app">
      <TabsBar
        tabs={tabs}
        reposOpen={dialog === 'repos'}
        onSelect={(id) => {
          if (dialog === 'repos') setDialog(null)
          switchTabs({ ...tabsRef.current, active: id })
        }}
        onClose={(id) => switchTabs(closeTab(tabsRef.current, id))}
        onNew={() => {
          if (dialog === 'repos') setDialog(null)
          switchTabs(newTab(tabsRef.current))
        }}
        onRepos={() => setDialog((d) => (d === 'repos' ? null : 'repos'))}
      />
      {/* la pestaña nueva no tiene barra de herramientas */}
      {repo && (
      <Toolbar
        repo={repo}
        branch={currentBranch?.name ?? (repo?.head ? repo.head.replace('refs/heads/', '') : null)}
        recents={recents}
        blocked={busy || !!envProblem}
        fetching={fetchState.running}
        onOpenPath={(path) => void openHere(path)}
        onOpen={() => void openRepo()}
        onClone={() => setDialog('clone')}
        onInit={() => setDialog('init')}
        onFetch={() => void doFetch(false)}
        locals={(refsList?.local ?? []).map((b) => ({ name: b.name, ref: b.ref, current: b.current }))}
        onCheckoutBranch={(ref) => void doCheckout(ref)}
        onCreateBranch={() => void doCreateBranch(selected && selected.kind !== 'wip' ? selected.hash : (currentBranch?.hash ?? ''))}
        branchNeedsCommit={!selected && !currentBranch}
        undo={undoInfo.undo}
        redo={undoInfo.redo}
        onUndo={() => void doUndo('undo')}
        onRedo={() => void doUndo('redo')}
        onStash={() => void doStash()}
        onPop={() => refsList?.stashes[0] && void doStashOp('pop', refsList.stashes[0])}
        stashCount={refsList?.stashes.length ?? 0}
        onWeb={() => currentBranch && void openWeb({ kind: 'branch', ref: currentBranch.ref })}
        onTerminal={() => onMenu.current('openTerminal')}
        onPull={(mode) => void doPull(mode)}
        pulling={pulling}
        onPush={() => void doPush()}
        pushing={pushing}
        pushWhy={pushWhy}
        pushTitle={pushTitle}
        account={
          account?.remote ? (
            <AccountMenu
              account={account}
              access={access}
              openAt={accountMenuAt}
              onOpen={checkAccess}
              onPick={(name) => void pickAccount(name)}
              onLogin={() => call('accounts:githubLogin', {}).then(loadAccount, showError)}
              onPrefs={() => setDialog('prefs')}
            />
          ) : null
        }
      />
      )}
      {pushDlg && (
        <PushDialogs
          dlg={pushDlg}
          busy={pushing}
          onPublish={(remote, branch) => void doPush({ to: { remote, branch } })}
          onPull={() => {
            setPushDlg(null)
            void doPull('ff')
          }}
          onForceAsk={() => setPushDlg((d) => (d && d.kind === 'rejected' ? { kind: 'force', r: d.r } : d))}
          onForce={(expected) => void doPush({ forceExpected: expected })}
          onClose={() => setPushDlg(null)}
        />
      )}

      {/* una carga reemplazada por otra (cambio rápido de pestaña) no es un error para el usuario */}
      {error && error.message !== SUPERSEDED && (
        <div role="alert" className="alert">
          <strong>{error.message}</strong>
          {accessError && account?.remote ? (
            <span> {t('account.triedWith', { account: account.current ?? t('account.auto') })}</span>
          ) : (
            error.suggestion && <span> {error.suggestion}</span>
          )}
          {error.gitOutput && <pre>{error.gitOutput}</pre>}
          <div className="alert-actions">
            {accessError && fixAccount && (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setError(null)
                  void pickAccount(fixAccount, () => retry.current?.())
                }}
              >
                {t('account.useRetry', { account: fixAccount })}
              </button>
            )}
            {accessError && ssoAccount && account?.owner && (
              <>
                <button type="button" className="btn primary" onClick={() => void call('app:openUrl', { url: `https://github.com/orgs/${account.owner}/sso` })}>
                  {t('account.ssoOpen', { org: account.owner })}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void call('accounts:relogin', { account: ssoAccount }).then(() => {
                      setError(null)
                      void pickAccount(ssoAccount, () => retry.current?.())
                    }, showError)
                  }
                >
                  {t('account.ssoRelogin', { account: ssoAccount })}
                </button>
              </>
            )}
            {accessError && account?.remote && (
              <button type="button" className="btn" onClick={() => setAccountMenuAt(Date.now())}>
                {t('account.choose')}
              </button>
            )}
            <button type="button" className="btn" onClick={() => void call('app:openErrorLog', {})}>
              {t('alert.openLog')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setError(null)}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {envProblem && (
        <div role="alert" className="alert">
          <strong>
            {env.gitFound
              ? t('env.gitOld', { version: env.gitVersion ?? '', min: env.minGitVersion })
              : t('env.gitMissing')}
          </strong>{' '}
          {t('env.install')}
          <button type="button" className="btn ghost" onClick={() => setDialog('env')}>
            {t('env.open')}
          </button>
        </div>
      )}

      <div className="body" style={{ '--left-w': `${eff.left}px`, '--right-w': `${eff.right}px` } as CSSProperties}>
        {repo && showLeft && (
          <RefsPanel
            refs={refsList}
            filter={filter}
            viewing={graph?.branches ?? null}
            prs={prs}
            actions={{
              goTo: (hash) => void goToCommit(hash),
              checkout: (ref) => void doCheckout(ref),
              copy: (text) => void call('app:copy', { text }),
              setFilter: (f) => void applyFilter(f),
              openWeb: (target) => void openWeb(target),
              collapse: () => setShowLeft(false),
              openWorktree: (path) => void openHere(path),
              worktreeOp: (op, w) => void doWorktreeOp(op, w),
              submoduleAdd: () => setDialog('submodule'),
              submoduleOp: (op, s) => void doSubmoduleOp(op, s),
              openPr: (url) => void call('app:openUrl', { url }).catch(showError),
              openAccounts: () => setDialog('prefs'),
              hoverBranch,
              renameBranch: (name) => void doRename(name),
              stashOp: (op, s) => void doStashOp(op, s),
              remoteAdd: () => setRemoteForm({ editing: null, name: '', pullUrl: '', pushUrl: '' }),
              remoteOp: (op, name) => void doRemoteOp(op, name),
              tagsOnRemote: () => (repo ? call('repo:tagsOnRemote', { repoId: repo.repoId }) : Promise.resolve({ names: [], remote: null })),
              tagOp: (op, name, remote) => void doTagOp(op, name, remote),
              branchMenu: async (ref, hash, x, y) => {
                if (!repo) return false
                try {
                  const f = await call('graph:find', { repoId: repo.repoId, hash })
                  if (f.index === null) return false
                  const r = await call('graph:rows', { repoId: repo.repoId, offset: f.index, limit: 1 })
                  const row = r.rows[0]
                  if (!row) return false
                  setCommitMenu({ x, y, row, ref })
                  return true
                } catch {
                  return false
                }
              },
              deleteBranches: (names) => void doDeleteMany(names)
            }}
          />
        )}
        {repo && showLeft && <Splitter width={eff.left} dir={1} {...resize('left')} />}
        <main className="graph-pane">
          {operation && repo && (
            <div role="status" className="notice operation">
              <strong>{t(`op.${operation.kind}`)}</strong>
              {operation.conflicts > 0 && <span>{t('op.conflicts', { n: operation.conflicts })}</span>}
              {operation.kind === 'bisect' ? (
                <span>{t('op.hint', { cmd: 'git bisect reset' })}</span>
              ) : (
                <>
                  <button type="button" onClick={() => void doOperation('abort')}>{t('op.abort')}</button>
                  <button type="button" disabled={operation.conflicts > 0} onClick={() => void doOperation('continue')}>{t('op.continue')}</button>
                  {operation.kind === 'rebase' && <button type="button" onClick={() => void doOperation('skip')}>{t('op.skip')}</button>}
                </>
              )}
            </div>
          )}
          {gone && (
            <div role="alert" className="notice">
              {t('watch.gone', { root: gone })}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button type="button" className="btn ghost" onClick={() => setNotice(null)}>
                {t('common.close')}
              </button>
            </div>
          )}
          {graph && repo && graph.total === 0 && !graph.partial ? (
            <div className="empty">
              <h1>{repo.name}</h1>
              <p>{t('empty.noCommits')}</p>
            </div>
          ) : graph && repo ? (
            <>
              <GraphHeader
                maxLanes={graph.maxLanes}
                width={graphWidth}
                theme={themes.find((x) => x.file === prefs.graphTheme) ?? null}
                sizes={colSizes}
                onSizes={setColSizes}
                collapse={!!filter.collapse}
                onCollapse={() => void applyFilter({ ...filterRef.current, collapse: !filterRef.current.collapse })}
              />
              <GraphView
                repoId={repo.repoId}
                version={graph.version}
                total={graph.total}
                maxLanes={graph.maxLanes}
                fetchRows={fetchRows}
                findNeighbor={findNeighbor}
                onSelect={setSelected}
                onFirstPaint={onFirstPaint}
                onRefsMenu={(row, x, y) => setRefsMenu({ x, y, refs: groupRefs(row.refs) })}
                onRefsDoubleClick={(row) => {
                  const ref = checkoutTarget(groupRefs(row.refs))
                  if (ref) void doCheckout(ref)
                }}
                onRefsDrop={(a, b, x, y) => {
                  const from = branchOfRow(a)
                  const to = branchOfRow(b)
                  if (from && to && from.ref !== to.ref) setDropMenu({ x, y, from, to })
                }}
                onRowMenu={(row, x, y) => setCommitMenu({ x, y, row })}
                onMultiSelect={setMulti}
                jumpTo={jump}
                keepSelection={keep}
                onWidth={setGraphWidth}
                theme={themes.find((x) => x.file === prefs.graphTheme) ?? null}
                branchRows={branchHi}
                columnSizes={colSizes}
              />
              {search !== null && (
                <CommitSearch
                  repoId={repo.repoId}
                  graphKey={`${graph.version}:${graph.total}`}
                  focusKey={search}
                  onJump={(index) => setJump({ index, n: Date.now() })}
                  onClose={() => setSearch(null)}
                />
              )}
            </>
          ) : busy && activeTab(tabs).path ? (
            // pestaña con repo cargándose (al cambiar de pestaña): no es una pestaña nueva, no va «Repositorios»
            <div className="empty">
              <p className="muted">{t('toolbar.loading')}</p>
            </div>
          ) : (
            // pestaña nueva: «Repositorios» con Abrir y Clonar, fijados y recientes
            <ReposScreen
              recents={recents}
              blocked={busy || !!envProblem}
              busy={busy}
              onBrowse={() => void openRepo()}
              onClone={() => setDialog('clone')}
              onInit={() => setDialog('init')}
              onOpen={(path) => void openHere(path)}
              onRemove={removeFromRecents}
              onPin={(path, pinned) => void call('recents:pin', { path, pinned }).then(setRecents, showError)}
              onOpenIn={(target, path) => void call('app:openIn', { target, path }).catch(showError)}
              onCopy={(text) => void call('app:copy', { text })}
            />
          )}
          {conflictFile && repo && (
            <ConflictEditor
              key={conflictFile}
              repoId={repo.repoId}
              path={conflictFile}
              onClose={() => setConflictFile(null)}
              onSaved={() => void reloadAfterWrite()}
              onError={showError}
            />
          )}
          {openFile && repo && selected && (
            <DiffView
              repoId={repo.repoId}
              hash={selected.hash}
              groupBase={selectedBase}
              file={openFile}
              wipArea={selected.kind === 'wip' ? (wipArea ?? undefined) : undefined}
              onWrote={() => void call('wip:files', { repoId: repo.repoId }).then(setWipFiles, () => {})}
              onClose={() => setOpenFile(null)}
            />
          )}
          {fileHist && repo && (
            <FileHistoryView
              key={fileHist.path}
              repoId={repo.repoId}
              path={fileHist.path}
              initialMode={fileHist.mode}
              onGoTo={(hash) => {
                setFileHist(null)
                void goToCommit(hash)
              }}
              onClose={() => setFileHist(null)}
            />
          )}
          {compare && repo && !fileHist && (
            <CompareView
              key={`${compare.from}..${compare.to ?? ''}`}
              repoId={repo.repoId}
              hash={compare.from}
              to={compare.to}
              title={compare.title}
              onClose={() => setCompare(null)}
            />
          )}
        </main>

        {showDetail && repo && !fileHist && !compare && <Splitter width={eff.right} dir={-1} {...resize('right')} />}
        {/* con el historial de un archivo o una comparación abiertos, el diff usa también el ancho del detalle */}
        {showDetail && repo && !fileHist && !compare && (
        <aside className="detail" aria-label={t('detail.aria')}>
          {selected?.kind === 'wip' && selected.wip ? (
            <WipDetailView
              repoId={repo.repoId}
              onChanged={() => call('wip:files', { repoId: repo.repoId }).then(setWipFiles, () => {})}
              onError={showError}
              root={repo.root}
              onHistory={(path) => setFileHist({ path, mode: 'history' })}
              onBlame={(path) => setFileHist({ path, mode: 'blame' })}
              branch={currentBranch?.name ?? null}
              detached={!!refsList && !currentBranch}
              onOpenConflict={(path) => {
                setOpenFile(null)
                setConflictFile(path)
              }}
              currentName={currentBranch?.name ?? 'HEAD'}
              incomingName={t('conflict.incoming')}
              files={wipFiles}
              openFile={openFile && wipArea ? { path: openFile.path, area: wipArea } : null}
              onOpenFile={(f, area) => {
                setWipArea(area)
                setOpenFile(f)
              }}
            />
          ) : selected && repo ? (
            <CommitDetailView
              row={selected}
              detail={commitDetail?.hash === selected.hash ? commitDetail : null}
              loadTree={() => call('commit:tree', { repoId: repo.repoId, hash: selected.hash }).then((r) => r.paths)}
              onCopy={(text) => void call('app:copy', { text })}
              onOpenWeb={selected.kind === 'stash' ? null : () => void openWeb({ kind: 'commit', hash: selected.hash })}
              onGoTo={(hash) => void goToCommit(hash)}
              onOpenFile={(f) => {
                setWipArea(null)
                setOpenFile(f)
              }}
              onFileMenu={(path, x, y) => setFileMenu({ path, x, y })}
              openFile={openFile?.path ?? null}
            />
          ) : (
            <p className="muted">{t('detail.empty')}</p>
          )}
        </aside>
        )}
      </div>

      {/* barra de estado (26 px): vigilancia y fetch a la izquierda; grafo y zoom a la derecha */}
      <footer className="status">
        {repo && watchMode && watchMode !== 'closed' && (
          <span className={watchMode === 'polling' ? 'status-error' : undefined} title={t(`watch.${watchMode}.hint`)}>
            {t(`watch.${watchMode}`)}
          </span>
        )}
        {repo && (fetchState.error || fetchState.at) && (
          <span className={fetchState.error ? 'status-error' : undefined} title={fetchState.error ?? undefined}>
            {fetchState.error
              ? t('fetch.failed')
              : t('fetch.last', {
                  time: new Date(fetchState.at!).toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit' })
                })}
          </span>
        )}
        <span className="grow" />
        {env && envProblem && (
          <button type="button" className="status-warn" onClick={() => setDialog('env')}>
            {t('status.envProblem')}
          </button>
        )}
        {graph && metrics && (
          <span
            className="metrics"
            title={[
              t('status.git', { version: env?.gitVersion ?? t('status.gitMissing') }),
              metrics.firstPaintMs !== null ? t('status.firstPaint', { ms: Math.round(metrics.firstPaintMs) }) : '',
              metrics.fullMs ? t('status.full', { ms: Math.round(metrics.fullMs) }) : ''
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {t('status.commits', { total: graph.total.toLocaleString(LOCALES[lang]) })}
            {graph.partial && t('status.loadingFull')} · {t('status.lanes', { lanes: graph.maxLanes })}
          </span>
        )}
        {/* derecha de la barra de estado: atajos, zoom con lupa y versión */}
        <button type="button" className="status-icon" title={t('menu.shortcuts')} aria-label={t('menu.shortcuts')} onClick={() => setDialog('shortcuts')}>
          ⌨
        </button>
        <span className="status-zoom">
          <span aria-hidden="true">🔍</span>
          <select
            className="zoom-select"
            aria-label={t('status.zoom')}
            value={String(prefs.zoom)}
            onChange={(e) => update({ ...prefs, zoom: Number(e.target.value) })}
          >
            {ZOOM_STEPS.includes(prefs.zoom) ? null : <option value={String(prefs.zoom)}>{Math.round(prefs.zoom * 100)} %</option>}
            {ZOOM_STEPS.map((z) => (
              <option key={z} value={String(z)}>
                {Math.round(z * 100)} %
              </option>
            ))}
          </select>
        </span>
        <span className="status-version" title={t('menu.about')}>
          {APP_VERSION}
        </span>
      </footer>

      {dialog === 'prefs' && (
        <PreferencesView
          onClose={() => setDialog(null)}
          onEnvironment={() => setDialog('env')}
          repoId={repo?.repoId ?? null}
          // remoto del upstream de la rama actual; si no tiene, el primer remoto conocido
          remote={(currentBranch?.upstream ?? refsList?.remote[0]?.name ?? '').split('/')[0] || null}
        />
      )}
      {dialog === 'repos' && recents && (
        <RepoManager
          open={tabs.tabs.filter((tab) => tab.path).map((tab) => ({ path: tab.path!, name: tab.name ?? tab.path! }))}
          recents={recents}
          blocked={busy || !!envProblem}
          onOpen={(path) => {
            setDialog(null)
            const already = tabsRef.current.tabs.find((tab) => tab.path === path)
            if (already) switchTabs({ ...tabsRef.current, active: already.id })
            else void openHere(path)
          }}
          onBrowse={() => {
            setDialog(null)
            void openRepo()
          }}
          onClone={() => setDialog('clone')}
          onInit={() => setDialog('init')}
          onCloseTab={(path) => {
            const tab = tabsRef.current.tabs.find((x) => x.path === path)
            if (tab) switchTabs(closeTab(tabsRef.current, tab.id))
          }}
          onCloseAllTabs={() => switchTabs(tabsRef.current.tabs.reduce((s, tab) => closeTab(s, tab.id), tabsRef.current))}
          onRemoveRecent={removeFromRecents}
          onRemoveAllRecents={() => recents.forEach((r) => removeFromRecents(r.path))}
          onExplorer={(path) => void call('app:openIn', { target: 'explorer', path }).catch(showError)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {(dialog === 'guide' || dialog === 'releaseNotes') && <HelpDialog kind={dialog} onClose={() => setDialog(null)} />}
      {dialog === 'about' && (
        <AboutDialog
          git={env?.gitVersion ?? null}
          gcm={env?.checks.find((c) => c.id === 'gcm' && c.status === 'ok')?.value ?? null}
          onReleaseNotes={() => setDialog('releaseNotes')}
          onGuide={() => setDialog('guide')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'palette' && (
        <CommandPalette
          items={[
            ...actionItems(t),
            // comandos de cambios locales (spec fase 2): «Stash: Create», «Stash: Apply», «Create File», «Discard all changes»
            ...(repo
              ? [
                  { id: 'command:stashCreate', kind: 'command' as const, label: 'Stash: Create' },
                  ...(refsList?.stashes.length ? [{ id: 'command:stashApply', kind: 'command' as const, label: 'Stash: Apply' }] : []),
                  { id: 'command:createFile', kind: 'command' as const, label: t('file.create') },
                  { id: 'command:stageAll', kind: 'command' as const, label: 'Stage all changes' },
                  { id: 'command:unstageAll', kind: 'command' as const, label: 'Unstage all changes' },
                  { id: 'command:discardAll', kind: 'command' as const, label: t('wip.discardAll') }
                ]
              : []),
            // ramas del repo abierto: la actual primero, después locales y remotas
            ...[...(refsList?.local ?? [])]
              .sort((a, b) => Number(b.current) - Number(a.current))
              .map((b) => ({ id: `branch:${b.ref}`, kind: 'branch' as const, label: b.name, hint: t('palette.branch'), hash: b.hash })),
            ...(refsList?.remote ?? []).map((b) => ({ id: `branch:${b.ref}`, kind: 'branch' as const, label: b.name, hint: t('palette.remote'), hash: b.hash })),
            ...(recents ?? []).map((r) => ({ id: `repo:${r.path}`, kind: 'repo' as const, label: r.name, hint: r.path }))
          ]}
          onRun={(item) => {
            if (item.kind === 'action') onMenu.current(item.id.slice('action:'.length) as MenuAction)
            else if (item.kind === 'command') void runCommand(item.id.slice('command:'.length))
            else if (item.kind === 'branch') void goToCommit((item as PaletteItem & { hash: string }).hash)
            else void openHere(item.id.slice('repo:'.length))
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'fileSearch' && repo && (
        <FileSearchDialog repoId={repo.repoId} onPick={(path) => setFileHist({ path, mode: 'history' })} onClose={() => setDialog(null)} />
      )}
      {dropMenu && <DropMenu x={dropMenu.x} y={dropMenu.y} from={dropMenu.from.name} to={dropMenu.to.name} toRemote={refsList?.local.find((b) => b.ref === dropMenu.to.ref)?.upstream ?? null} onPick={(k) => void runDrop(k)} onClose={() => setDropMenu(null)} />}
      {fileMenu && (
        <FileMenu
          x={fileMenu.x}
          y={fileMenu.y}
          onHistory={() => setFileHist({ path: fileMenu.path, mode: 'history' })}
          onBlame={() => setFileHist({ path: fileMenu.path, mode: 'blame' })}
          onRestore={selected && selected.kind !== 'wip' && selected.kind !== 'stash' ? () => void doRestoreFile(selected.hash, fileMenu.path) : undefined}
          onApply={
            selected?.kind === 'stash' && repo
              ? () => {
                  const path = fileMenu.path
                  void call('repo:stashApply', { repoId: repo.repoId, hash: selected.hash, pop: false, paths: [path] })
                    .then(reloadAfterWrite)
                    .catch(showError)
                }
              : undefined
          }
          onClose={() => setFileMenu(null)}
        />
      )}
      {commitMenu && repo && (
        <CommitMenu
          x={commitMenu.x}
          y={commitMenu.y}
          row={commitMenu.row}
          branch={menuBranch}
          currentName={currentBranch?.name ?? null}
          remote={menuBranch ? (refsList?.local.find((b) => b.ref === menuBranch.ref)?.upstream ?? null) : null}
          pinned={!!menuBranch && filter.pinned === menuBranch.ref}
          onClose={() => setCommitMenu(null)}
          onPull={() => void doPull('ff')}
          onPush={() => void doPush()}
          pushWhy={pushing ? t('push.running') : pushWhy}
          onCopy={(text) => void call('app:copy', { text })}
          onCopyLink={(kind) => void copyLink(kind === 'commit' ? { kind, hash: commitMenu.row.hash } : { kind: 'branch', ref: menuBranch!.ref })}
          onPin={(ref) => void applyFilter({ ...filterRef.current, pinned: filter.pinned === ref ? null : ref })}
          pinnedRef={filter.pinned}
          count={pickRows.length}
          cherryWhy={
            pickRows.some((r) => r.group)
              ? t('cm.grouped')
              : pickRows.some((r) => r.parents.length > 1)
              ? t('cm.cherryMerge')
              : pickInHistory
                ? t('cm.cherryInBranch', { sha: pickInHistory.slice(0, 7) })
                : pickInHistory === undefined
                  ? t('cm.cherryChecking')
                  : null
          }
          onCreateBranch={() => void doCreateBranch(commitMenu.row.hash)}
          onCheckout={() => menuBranch && void doCheckout(menuBranch.ref)}
          onIntegrate={(kind) => menuBranch && currentBranch && void doIntegrate(kind, menuBranch, currentBranch.name)}
          onRename={() => menuBranch && void doRename(menuBranch.name)}
          onPullBranch={() => menuBranch && void doOtherBranch('pull', menuBranch.name)}
          onPushBranch={() => menuBranch && void doOtherBranch('push', menuBranch.name)}
          prLabel={prEntry ? (prEntry.to ? t('cm.startPr', { to: prEntry.to, from: prEntry.from }) : t('cm.startPrCurrent', { remote: prEntry.remote, from: prEntry.from })) : null}
          onPr={() => prEntry && currentBranch && setPrForm({ head: currentBranch.name, base: prEntry.base })}
          onInteractiveRebase={() => menuBranch && currentBranch && void openInteractiveRebase(menuBranch, currentBranch.name)}
          onCheckoutCommit={() => void doCheckoutCommit(commitMenu.row.hash)}
          onCheckoutRemote={() => {
            const up = menuBranch ? refsList?.local.find((x) => x.ref === menuBranch.ref)?.upstream : null
            if (up) void doCheckout(`refs/remotes/${up}`)
          }}
          onWorktree={(ref) => void doWorktree(commitMenu.row.hash, ref)}
          onEditMessage={() => void doEditMessage(commitMenu.row.hash, commitMenu.row.subject)}
          onDrop={() => void doDrop(commitMenu.row.hash, commitMenu.row.subject)}
          onMove={(dir) => void doMove(commitMenu.row.hash, dir)}
          plain={!!commitMenu.ref}
          onReset={(mode) => currentBranch && void doReset(commitMenu.row.hash, mode, currentBranch.name)}
          onRevert={() => void doRevert(commitMenu.row.hash)}
          onTag={(annotated) => void doTag(commitMenu.row.hash, annotated)}
          onSetUpstream={() => menuBranch && void doSetUpstream(menuBranch.name, refsList?.local.find((b) => b.ref === menuBranch.ref)?.upstream ?? null)}
          onDelete={(scope) => menuBranch && void doDeleteBranch(menuBranch, scope, refsList?.local.find((b) => b.ref === menuBranch.ref)?.upstream ?? null)}
          onStash={(op) => void doStashOp(op, { hash: commitMenu.row.hash, message: commitMenu.row.subject })}
          onCherryPick={() => void doCherryPick(pickRows.map((r) => r.hash))}
          squashWhy={pickRows.some((r) => r.group) ? t('cm.grouped') : squashWhy === undefined ? t('cm.squashChecking') : squashWhy}
          onSquash={() => void doSquash(pickRows.map((r) => r.hash))}
          onCompare={() => {
            setFileHist(null)
            const sha = commitMenu.row.hash
            setCompare({ from: sha, title: t('compare.title', { sha: sha.slice(0, 7) }) })
          }}
          onDiffRange={() => {
            // B3: del padre del más viejo al más nuevo; el primer commit del repo se compara con el árbol vacío.
            // Una fila agrupada incluye sus commits escondidos: se parte del padre del más viejo del grupo
            const oldest = pickRows[0]!
            const newest = pickRows[pickRows.length - 1]!
            setFileHist(null)
            setCompare({
              from: (oldest.group?.parents ?? oldest.parents)[0] ?? EMPTY_TREE,
              to: newest.hash,
              title: t('compare.rangeTitle', { n: String(pickRows.length), from: oldest.hash.slice(0, 7), to: newest.hash.slice(0, 7) })
            })
          }}
          onHide={() => menuBranch && void applyFilter({ ...filterRef.current, hidden: [...new Set([...(filterRef.current.hidden ?? []), menuBranch.ref])] })}
          onSolo={() => {
            if (!menuBranch || !refsList) return
            // Solo: se ocultan todas las ramas menos esta y su upstream (como «Solo esta rama» del panel)
            const up = refsList.local.find((b) => b.ref === menuBranch.ref)?.upstream
            const keep = new Set([menuBranch.ref, ...(up ? [`refs/remotes/${up}`] : [])])
            const all = [...refsList.local, ...refsList.remote].map((b) => b.ref)
            void applyFilter({ ...filterRef.current, mode: 'all', hidden: all.filter((r) => !keep.has(r)) })
          }}
        />
      )}
      {refsMenu && (
        <RefsMenu
          {...refsMenu}
          filter={filter}
          onClose={() => setRefsMenu(null)}
          onHide={(d) => {
            setRefsMenu(null)
            void applyFilter(hideRefs(filter, d.refs))
          }}
          onPin={(ref) => {
            setRefsMenu(null)
            void applyFilter({ ...filter, pinned: ref })
          }}
        />
      )}
      {prForm && repo && (
        <PullRequestDialog
          repoId={repo.repoId}
          head={prForm.head}
          base={prForm.base}
          onClose={() => setPrForm(null)}
          onCreated={(r) => {
            setPrForm(null)
            setNotice(t('pr.created', { n: r.number }) + (r.warning ? ` ${r.warning}` : ''))
            void call('app:openUrl', { url: r.url })
          }}
        />
      )}
      {worktreeForm && repo && (
        <WorktreeDialog
          repoRoot={repo.root}
          refName={worktreeForm.ref}
          hash={worktreeForm.hash}
          onClose={() => setWorktreeForm(null)}
          onSubmit={async (path, newBranch) => {
            await call('repo:addWorktree', { repoId: repo.repoId, path, ...(worktreeForm.ref ? { ref: worktreeForm.ref } : { hash: worktreeForm.hash }), ...(newBranch ? { newBranch } : {}) })
            setWorktreeForm(null)
            await reloadAfterWrite()
            // como GitKraken: tras crearlo, ofrece abrirlo ahora o en una pestaña nueva
            const open = await ask.askChoice({ title: t('worktree.openTitle'), body: t('worktree.openBody', { name: path.replace(/[\/]+$/, '').split(/[\/]/).pop() ?? path }), a: t('worktree.openNow'), b: t('worktree.openNewTab') })
            if (open === 'a') void openPath(path)
            else if (open === 'b') void openHere(path)
          }}
        />
      )}
      {submoduleEdit && repo && (
        <SubmoduleDialog
          repoId={repo.repoId}
          editing={submoduleEdit}
          onClose={() => setSubmoduleEdit(null)}
          onAdded={() => {
            setSubmoduleEdit(null)
            void reloadAfterWrite()
          }}
        />
      )}
      {dialog === 'submodule' && repo && (
        <SubmoduleDialog
          repoId={repo.repoId}
          onClose={() => setDialog(null)}
          onAdded={() => {
            setDialog(null)
            void reloadAfterWrite()
          }}
        />
      )}
      {dialog === 'init' && (
        <InitDialog
          defaultParent={recents?.[0]?.path.replace(/[\\/][^\\/]+[\\/]?$/, '') ?? ''}
          onClose={() => setDialog(null)}
          onCreated={(path) => {
            setDialog(null)
            void openHere(path)
          }}
        />
      )}
      {dialog === 'clone' && (
        <CloneDialog
          defaultParent={recents?.[0]?.path.replace(/[\\/][^\\/]+[\\/]?$/, '') ?? ''}
          onClose={() => setDialog(null)}
          onCloned={(path) => {
            setDialog(null)
            cloneOffer.current = path
            void openHere(path)
          }}
        />
      )}
      {ask.node}
      {remoteForm && <RemoteDialog form={remoteForm} onSave={(f) => void doRemoteSave(f)} onClose={() => setRemoteForm(null)} />}
      {irebase && (
        <InteractiveRebase current={irebase.current} onto={irebase.onto} commits={irebase.commits} onStart={(steps) => void startInteractiveRebase(steps)} onClose={() => setIrebase(null)} />
      )}
      {dialog === 'env' && env && (
        <EnvironmentDialog env={env} checking={checking} onRecheck={() => void checkEnv(false)} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

/** pasos del selector de zoom de la barra de estado */
const ZOOM_STEPS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

const HEADER_COLUMNS = ['author', 'date', 'sha'] as const
/** ancho mínimo que le queda al mensaje al arrastrar los divisores de columna */
const MIN_SUBJECT = 60

/**
 * Cabecera del grafo. Usa el ancho que mide el grafo (con paneles redimensionables, B1, ya no es fijo). B6: el
 * engranaje o el clic derecho abren el menú de columnas; cambia las mismas preferencias.
 */
function GraphHeader({
  maxLanes,
  width,
  theme,
  sizes,
  onSizes,
  collapse,
  onCollapse
}: {
  maxLanes: number
  width: number
  theme: Theme | null
  sizes: ColumnSizes
  onSizes: (next: ColumnSizes) => void
  /** commits seguidos del mismo autor en una sola fila (se guarda por repo con el filtro) */
  collapse: boolean
  onCollapse: () => void
}) {
  const { prefs, update, t } = usePrefs()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const cols = columnsFor(width, maxLanes, prefs.columns, prefs.date.mode, effectiveStyle(prefs.graphStyle, theme).laneW, sizes)

  // divisores de columna: los de rama y grafo están en su borde derecho; los de autor y fecha, que van pegados
  // a la derecha, en su borde izquierdo (el de autor es también el borde derecho del mensaje)
  const authorX = width - cols.shaW - cols.dateW - cols.authorW
  const handles: { id: ColumnId; x: number; value: number; dir: 1 | -1 }[] = [
    { id: 'refs', x: cols.refsW, value: cols.refsW, dir: 1 },
    { id: 'graph', x: cols.refsW + cols.graphW + 8, value: cols.graphW + 8, dir: 1 },
    ...(cols.authorW > 0 ? [{ id: 'author' as const, x: authorX, value: cols.authorW, dir: -1 as const }] : []),
    ...(cols.dateW > 0 ? [{ id: 'date' as const, x: authorX + cols.authorW, value: cols.dateW, dir: -1 as const }] : [])
  ]
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, h: (typeof handles)[number]) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    // ninguna columna crece a costa de dejar el mensaje por debajo de MIN_SUBJECT
    const room = Math.max(0, authorX - (cols.refsW + cols.graphW + 8) - MIN_SUBJECT)
    const move = (ev: PointerEvent) =>
      onSizes({ ...sizes, [h.id]: clampColumn(h.id, Math.min(h.value + room, h.value + h.dir * (ev.clientX - x0))) })
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.classList.remove('dragging')
    }
    el.classList.add('dragging')
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  return (
    <div
      className="graph-header"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <span style={{ width: cols.refsW }}>{t('graph.header.refs')}</span>
      <span style={{ width: cols.graphW + 8 }}>{t('graph.header.graph')}</span>
      <span className="grow">{t('graph.header.subject')}</span>
      {cols.authorW > 0 && <span style={{ width: cols.authorW }}>{t('graph.header.author')}</span>}
      {cols.dateW > 0 && <span style={{ width: cols.dateW }}>{t('graph.header.date')}</span>}
      {cols.shaW > 0 && <span style={{ width: cols.shaW }}>{t('graph.header.sha')}</span>}
      {handles.map((h) => (
        <div
          key={h.id}
          className="col-resize"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={h.value}
          title={t('layout.splitter')}
          style={{ left: h.x }}
          onPointerDown={(e) => startDrag(e, h)}
          onDoubleClick={() => {
            const { [h.id]: _, ...rest } = sizes
            onSizes(rest)
          }}
        />
      ))}
      <button
        type="button"
        className={`graph-header-collapse${collapse ? ' on' : ''}`}
        title={t('graph.header.collapse')}
        aria-label={t('graph.header.collapse')}
        aria-pressed={collapse}
        onClick={onCollapse}
      >
        ⊟
      </button>
      <button
        type="button"
        className="graph-header-gear"
        title={t('graph.header.columns')}
        aria-label={t('graph.header.columns')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.right - 160, y: r.bottom })
        }}
      >
        ⚙
      </button>
      {menu && (
        <div ref={menuRef} className="refs-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <div className="refs-menu-group">
            {HEADER_COLUMNS.map((c) => (
              <label key={c} className="graph-header-check" role="menuitemcheckbox" aria-checked={prefs.columns[c]}>
                <input type="checkbox" checked={prefs.columns[c]} onChange={(e) => update({ ...prefs, columns: { ...prefs.columns, [c]: e.target.checked } })} />
                {t(`graph.header.${c}`)}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
