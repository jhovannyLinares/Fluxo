import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { GraphFilter } from '@shared/graph-types'
import {
  buildRefTree,
  matchesRefFilter,
  type LocalBranch,
  type RefTreeNode,
  type RefsList,
  type SimpleRef
} from '@shared/refs'
import type { PullRequest } from '@shared/pull-requests'
import type { WebTarget } from '@shared/web-links'
import { isFiltered } from '../graph/filter-store'
import { usePrefs } from '../prefs'
import type { Submodule } from '@shared/refs'

type Branch = LocalBranch | SimpleRef

/** Acciones del panel: de vista o de copiar, salvo el checkout con doble clic (C20). */
export interface RefsPanelActions {
  goTo: (hash: string) => void
  /** doble clic en una rama local o remota: cambiar a ella (nombre completo) */
  checkout: (ref: string) => void
  copy: (text: string) => void
  setFilter: (f: GraphFilter) => void
  /** H23: abrir en el navegador */
  openWeb: (target: WebTarget) => void
  /** ‹: plegar el panel (Ctrl+J lo vuelve a mostrar) */
  collapse: () => void
  /** abrir otro worktree del repo en una pestaña */
  openWorktree: (path: string) => void
  /** «+» de la sección SUBMODULES y menú de un submódulo (Initialize, Update, Open) */
  submoduleAdd: () => void
  submoduleOp: (op: 'init' | 'update' | 'stage' | 'commit' | 'edit' | 'open' | 'delete', s: Submodule) => void
  /** menú de un worktree: abrir, abrir en pestaña, quitar (con o sin su rama), bloquear */
  worktreeOp: (op: 'open' | 'openTab' | 'remove' | 'removeBranch' | 'removeBranchRemote' | 'lock' | 'unlock', w: { path: string; branch: string | null }) => void
  /** A4: abrir la página del PR en el navegador */
  openPr: (url: string) => void
  /** A4: sin credencial, ir a Preferencias ▸ Cuentas */
  openAccounts: () => void
  /** «⋮» de una rama: abre el menú completo del commit de esa rama; false si el commit no está en el grafo cargado */
  branchMenu: (ref: string, hash: string, x: number, y: number) => Promise<boolean>
  /** «+» de la sección REMOTE y menú de un remoto (Fetch, Edit, Remove) */
  remoteAdd: () => void
  remoteOp: (op: 'fetch' | 'edit' | 'remove', name: string) => void
  /** tags que el remoto ya tiene (consulta de red) y operaciones sobre un tag */
  tagsOnRemote: () => Promise<{ names: string[]; remote: string | null }>
  tagOp: (op: 'delete' | 'deleteRemote' | 'deleteBoth' | 'push', name: string, remote: string | null) => void
  /** menú de un stash del panel: Apply, Pop, Delete y Edit message */
  stashOp: (op: 'apply' | 'pop' | 'drop' | 'rename', s: { hash: string; message: string }) => void
  /** B11: rama bajo el ratón (nombre completo), o null al salir */
  hoverBranch: (ref: string | null) => void
  /** Rename y Delete desde el menú «⋮»; Delete recibe una o varias ramas locales (Shift/Ctrl) */
  renameBranch: (name: string) => void
  deleteBranches: (names: string[]) => void
}

/** Íconos de 12 px de las secciones y filas. */
const ico = (d: ReactElement) => (
  <svg className="refs-ico" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.1">
    {d}
  </svg>
)
const ICON = {
  local: ico(<path d="M2.5 3h7v4.5h-7zM1 9.5h10" />),
  remote: ico(<path d="M3.5 9h5.2a2.3 2.3 0 0 0 .3-4.6A3 3 0 0 0 3.3 5 2 2 0 0 0 3.5 9z" />),
  worktree: ico(<path d="M6 1.5v9M6 4l-3-1.5M6 6l3-1.5M3.5 10.5h5" />),
  submodule: ico(<path d="M2 3.5h8v2H2zM2 6.5h8v2H2z" />),
  stash: ico(<path d="M1.5 6.5v3.5h9V6.5M1.5 6.5h2.5l.8 1.3h2.4l.8-1.3h2.5M6 1.5v4M4.5 4 6 5.5 7.5 4" />),
  pr: ico(
    <>
      <circle cx="3" cy="2.5" r="1.1" />
      <circle cx="3" cy="9.5" r="1.1" />
      <circle cx="9" cy="9.5" r="1.1" />
      <path d="M3 3.6v4.8M9 8.4V5a1.5 1.5 0 0 0-1.5-1.5H5.5M6.5 2.5l-1 1 1 1" />
    </>
  ),
  tag: ico(<path d="M1.5 1.5h4.2l4.8 4.8-4.2 4.2-4.8-4.8zM4 4h.01" />),
  branch: ico(
    <>
      <circle cx="3.5" cy="2.5" r="1.1" />
      <circle cx="3.5" cy="9.5" r="1.1" />
      <circle cx="8.5" cy="4" r="1.1" />
      <path d="M3.5 3.6v4.8M8.5 5.1c0 2-5 1.5-5 3.3" />
    </>
  )
}

/**
 * Panel de ramas (H16): locales en árbol por prefijo (C6), remotas, tags y stash, con filtro único (C8),
 * ojo para ocultar y contador (C21), ahead/behind (H17, C7) y menú «⋮» solo de lectura (C20).
 */
export function RefsPanel({
  refs,
  filter,
  viewing,
  prs,
  actions
}: {
  refs: RefsList | null
  filter: GraphFilter
  viewing: { visible: number; total: number } | null
  /** A4: PR abiertos del remoto; null = el remoto no es de GitHub ni de Azure DevOps (sin sección) */
  prs: { list: PullRequest[]; needsLogin: boolean } | null
  actions: RefsPanelActions
}) {
  const { t } = usePrefs()
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set(['tags', 'stashes', 'worktrees', 'submodules']))
  // como GitKraken: al agregar un submódulo la sección se abre sola
  const subCount = refs ? refs.submodules.length : null
  const prevSubs = useRef<number | null>(null)
  useEffect(() => {
    if (subCount === null) return
    if (prevSubs.current !== null && subCount > prevSubs.current) setClosed((c) => (c.has('submodules') ? new Set([...c].filter((k) => k !== 'submodules')) : c))
    prevSubs.current = subCount
  }, [subCount])
  const [menu, setMenu] = useState<{ ref: Branch; x: number; y: number; remoteTags?: { names: string[]; remote: string | null } } | null>(null)
  // clic derecho en el título de una sección; `maximized` deja abierta solo esa
  const [sectionMenu, setSectionMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const [maximized, setMaximized] = useState<string | null>(null)
  const [remoteMenu, setRemoteMenu] = useState<{ x: number; y: number; name: string } | null>(null)
  const [stashMenu, setStashMenu] = useState<{ x: number; y: number; hash: string; message: string } | null>(null)
  const [submoduleMenu, setSubmoduleMenu] = useState<{ x: number; y: number; sub: Submodule } | null>(null)
  const [worktreeMenu, setWorktreeMenu] = useState<{ x: number; y: number; path: string; branch: string | null; locked: boolean; current: boolean } | null>(null)
  // Shift/Ctrl + clic en ramas locales: selección para borrarlas de una vez
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  // el menú del stash y el del remoto se cierran con un clic fuera o con cualquier tecla
  useEffect(() => {
    if (!stashMenu && !remoteMenu && !worktreeMenu && !submoduleMenu) return
    const close = () => (setStashMenu(null), setRemoteMenu(null), setWorktreeMenu(null), setSubmoduleMenu(null))
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [stashMenu, remoteMenu, worktreeMenu, submoduleMenu])

  // Ctrl+Alt+F lleva al filtro
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        filterRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!refs) return <aside className="refs-panel" aria-label={t('refs.title')} />

  const toggle = (key: string) =>
    setClosed((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const hidden = new Set(filter.hidden)
  const allBranchRefs = [...refs.local.map((b) => b.ref), ...refs.remote.map((b) => b.ref)]
  const setHidden = (ref: string, hide: boolean) => {
    const next = new Set(filter.hidden)
    if (hide) next.add(ref)
    else next.delete(ref)
    actions.setFilter({ ...filter, mode: 'all', hidden: [...next] })
  }

  const row = (b: Branch, label: string, depth: number) => {
    const local = 'current' in b ? b : null
    const isHidden = hidden.has(b.ref)
    return (
      <li
        key={b.ref}
        className={`ref-row${isHidden ? ' hidden' : ''}${local?.current ? ' current' : ''}${picked.has(b.ref) ? ' picked' : ''}`}
        aria-selected={picked.has(b.ref)}
        style={{ paddingLeft: 8 + depth * 15 }}
        onMouseEnter={() => actions.hoverBranch(b.ref)}
        onMouseLeave={() => actions.hoverBranch(null)}
      >
        <button
          type="button"
          className="ref-eye"
          aria-label={t(isHidden ? 'refs.show' : 'refs.hide', { name: b.name })}
          title={t(isHidden ? 'refs.show' : 'refs.hide', { name: b.name })}
          onClick={() => setHidden(b.ref, !isHidden)}
        >
          {isHidden ? '◌' : '●'}
        </button>
        <button
          type="button"
          className="ref-name"
          title={b.name}
          onClick={(e) => {
            if (local && (e.ctrlKey || e.shiftKey)) {
              const order = refs.local.map((x) => x.ref)
              if (e.shiftKey && anchor.current && order.includes(anchor.current)) {
                const a = order.indexOf(anchor.current)
                const z = order.indexOf(b.ref)
                setPicked(new Set(order.slice(Math.min(a, z), Math.max(a, z) + 1)))
              } else {
                setPicked((s) => {
                  const n = new Set(s)
                  if (n.has(b.ref)) n.delete(b.ref)
                  else n.add(b.ref)
                  return n
                })
                anchor.current = b.ref
              }
              return
            }
            setPicked(new Set())
            anchor.current = b.ref
            actions.goTo(b.hash)
          }}
          onDoubleClick={() => {
            if (local ? !local.current : b.ref.startsWith('refs/remotes/')) actions.checkout(b.ref)
          }}
        >
          {local?.current && <span className="ref-current">✓</span>}
          {ICON.branch}
          <span className="ref-label">{label}</span>
          {filter.pinned === b.ref && (
            <span className="ref-pin" title={t('filter.pinned', { name: b.name })}>
              📌
            </span>
          )}
        </button>
        {local && (local.ahead > 0 || local.behind > 0) && (
          <span className="ref-track" title={t('refs.track', { ahead: local.ahead, behind: local.behind, upstream: local.upstream ?? '' })}>
            {local.ahead > 0 && `${local.ahead}↑`}
            {local.behind > 0 && ` ${local.behind}↓`}
          </span>
        )}
        {local?.gone && (
          <span className="ref-track gone" title={t('refs.goneHint', { upstream: local.upstream ?? '' })}>
            {t('refs.gone')}
          </span>
        )}
        <button
          type="button"
          className="ref-more"
          aria-label={t('refs.more', { name: b.name })}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            if (b.ref.startsWith('refs/tags/')) {
              void actions.tagsOnRemote().then((remoteTags) => setMenu({ ref: b, x: r.right, y: r.bottom, remoteTags }))
              return
            }
            // con varias ramas elegidas (Ctrl/Shift) el menú es el de la selección: borrarlas juntas
            if (picked.size > 1 && picked.has(b.ref)) {
              setMenu({ ref: b, x: r.right, y: r.bottom })
              return
            }
            // el menú completo del grafo; si el commit no está cargado, el menú corto de vista
            void actions.branchMenu(b.ref, b.hash, r.right, r.bottom).then((ok) => {
              if (!ok) setMenu({ ref: b, x: r.right, y: r.bottom })
            })
          }}
        >
          ⋮
        </button>
      </li>
    )
  }

  const tree = (nodes: RefTreeNode<Branch>[], depth: number, keyPrefix: string): ReactElement[] =>
    nodes.flatMap((n) => {
      if (n.item) return [row(n.item, n.label, depth)]
      const key = `${keyPrefix}:${n.path}`
      const open = !closed.has(key)
      return [
        <li
          key={key}
          className="ref-folder"
          style={{ paddingLeft: 8 + depth * 15 }}
          onContextMenu={
            keyPrefix === 'remote' && depth === 0
              ? (e) => {
                  e.preventDefault()
                  setRemoteMenu({ x: e.clientX, y: e.clientY, name: n.label })
                }
              : undefined
          }
        >
          <button type="button" aria-expanded={open} onClick={() => toggle(key)}>
            <span className="rf-chev">{open ? '▾' : '▸'}</span>
            <span className="ref-label">{n.label}</span>
          </button>
        </li>,
        ...(open ? tree(n.children, depth + 1, keyPrefix) : [])
      ]
    })

  // título de sección: mayúsculas, flecha e ícono a la izquierda y contador a la derecha
  const sectionTitle = (key: string, icon: ReactElement, title: string, count: number, open: boolean) => (
    <button
      type="button"
      className="refs-section-title"
      aria-expanded={open}
      onClick={() => toggle(key)}
      onContextMenu={(e) => {
        e.preventDefault()
        setSectionMenu({ key, x: e.clientX, y: e.clientY })
      }}
    >
      <span className="rs-chev">{open ? '▾' : '▸'}</span>
      <span className="rs-ico">{icon}</span>
      <span className="rs-title">{title}</span>
      <span className="refs-count">{count}</span>
    </button>
  )

  // las secciones plegadas bajan al fondo del panel
  const section = (key: string, icon: ReactElement, title: string, items: Branch[], asTree: boolean) => {
    const shown = items.filter((b) => matchesRefFilter(b.name, query))
    if (query && shown.length === 0) return null
    // con texto en el filtro las secciones se abren solas
    const open = !!query || !closed.has(key)
    return (
      <section key={key} data-section={key} className={`refs-section${open ? '' : ' closed'}`}>
        <div className="refs-section-head">
          {sectionTitle(key, icon, title, shown.length, open)}
          {key === 'remote' && (
            <button type="button" className="refs-section-add" title={t('remote.add')} aria-label={t('remote.add')} onClick={() => actions.remoteAdd()}>
              +
            </button>
          )}
        </div>
        {open && (
          <ul>{asTree ? tree(buildRefTree(shown, (b) => b.name), 0, key) : shown.map((b) => row(b, b.name, 0))}</ul>
        )}
      </section>
    )
  }

  const sectionTitles: Record<string, string> = {
    local: t('refs.local'),
    remote: t('refs.remote'),
    tags: t('refs.tags'),
    stashes: t('refs.stashSection'),
    worktrees: t('refs.worktrees'),
    submodules: t('refs.submodules'),
    prs: t('refs.prs')
  }
  // solo las secciones de ramas y tags se ocultan del grafo; las demás solo se maximizan
  const sectionRefs: Record<string, string[]> = {
    local: refs.local.map((b) => b.ref),
    remote: refs.remote.map((b) => b.ref),
    tags: refs.tags.map((b) => b.ref),
    ...(refs.stashes.length ? { stashes: ['refs/stash'] } : {})
  }
  const stashes = refs.stashes.filter((s) => matchesRefFilter(s.message, query))
  const stashOpen = !!query || !closed.has('stashes')
  const worktreesOpen = !closed.has('worktrees')
  const submodulesOpen = !closed.has('submodules')
  const prsOpen = !closed.has('prs')
  const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
  // Solo deja visible una rama (y su upstream): el panel lo avisa en naranja con «Stop Soloing»
  const soloing = !!viewing && isFiltered(filter) && viewing.visible <= 2 && viewing.total >= 3
  return (
    <aside className="refs-panel" aria-label={t('refs.title')}>
      {/* cabecera de 60 px: ‹ y filtro arriba; «Viendo N/M», «Mostrar todo» y modo de vista abajo */}
      <div className="refs-head">
        <div className="refs-head-top">
          <button type="button" className="refs-collapse" title={t('refs.collapse')} aria-label={t('refs.collapse')} onClick={actions.collapse}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M7.5 2.5 4 6l3.5 3.5" />
            </svg>
          </button>
          <div className="refs-seg" role="tablist">
            <button type="button" role="tab" aria-selected="true" className="on">
              {t('refs.list')}
            </button>
            <button type="button" role="tab" aria-selected="false" disabled title={t('toolbar.soon', { action: t('refs.agents') })}>
              {t('refs.agents')}
            </button>
          </div>
        </div>
        <div className={`refs-viewing${soloing ? ' soloing' : ''}`} style={soloing ? { background: 'rgba(255, 152, 0, 0.18)', color: '#ffb74d' } : undefined}>
          {viewing &&
            (soloing ? (
              <span>{t('refs.soloing', { visible: viewing.visible, total: viewing.total })}</span>
            ) : isFiltered(filter) ? (
              <span>{`${t('refs.viewing')} ${viewing.visible}/${viewing.total}`}</span>
            ) : (
              <>
                <span>{t('refs.viewing')}</span>
                <span className="refs-viewing-n" title={t('filter.viewing', { visible: viewing.visible, total: viewing.total })}>
                  {viewing.visible}
                </span>
              </>
            ))}
          {isFiltered(filter) && (
            <button type="button" className="link" onClick={() => actions.setFilter({ ...filter, mode: 'all', hidden: [] })}>
              {soloing ? t('refs.stopSolo') : t('filter.showAll')}
            </button>
          )}
          <select
            className="refs-mode"
            aria-label={t('filter.mode')}
            value={filter.mode}
            onChange={(e) => actions.setFilter({ ...filter, mode: e.target.value as GraphFilter['mode'] })}
          >
            <option value="all">{t('filter.all')}</option>
            <option value="current">{t('filter.current')}</option>
          </select>
        </div>
        <input
          ref={filterRef}
          type="search"
          className="input"
          placeholder={t('refs.filterShortcut')}
          aria-label={t('refs.filter')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="refs-body">
        {section('local', ICON.local, t('refs.local'), refs.local, true)}
        {section('remote', ICON.remote, t('refs.remote'), refs.remote, true)}
        <span className="refs-spacer" />
        <section className={`refs-section${worktreesOpen ? '' : ' closed'}`}>
          {sectionTitle('worktrees', ICON.worktree, t('refs.worktrees'), refs.worktrees.length, worktreesOpen)}
          {worktreesOpen && (
            <ul>
              {refs.worktrees.map((w) => (
                <li
                  key={w.path}
                  className={`ref-row${w.current ? ' current' : ''}`}
                  style={{ paddingLeft: 8 }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setWorktreeMenu({ x: e.clientX, y: e.clientY, path: w.path, branch: w.branch, locked: !!w.locked, current: w.current })
                  }}
                >
                  <button
                    type="button"
                    className="ref-name"
                    title={w.path}
                    onClick={() => !w.current && actions.openWorktree(w.path)}
                  >
                    {w.current && <span className="ref-current">✓</span>}
                    <span className="wt-main">
                      <span className="ref-label">{w.branch ?? w.hash.slice(0, 7)}</span>
                      <span className="muted wt-folder">
                        <span aria-hidden="true">🗀</span> {base(w.path)}
                      </span>
                    </span>
                    {w.locked && <span className="muted"> 🔒</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`refs-section${stashOpen ? '' : ' closed'}`}>
          {sectionTitle('stashes', ICON.stash, t('refs.stashSection'), stashes.length, stashOpen)}
          {stashOpen && (
            <ul>
              {stashes.map((s) => (
                <li
                  key={s.name}
                  className="ref-row"
                  style={{ paddingLeft: 8 }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setStashMenu({ x: e.clientX, y: e.clientY, hash: s.hash, message: s.message })
                  }}
                >
                  <button type="button" className="ref-name" title={`${s.name}: ${s.message}`} onClick={() => actions.goTo(s.hash)}>
                    {s.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {prs && (
          <section className={`refs-section${prsOpen ? '' : ' closed'}`}>
            {sectionTitle('prs', ICON.pr, t('refs.prs'), prs.list.length, prsOpen)}
            {prsOpen && (
              <ul>
                {prs.needsLogin && (
                  <li className="ref-row" style={{ paddingLeft: 8 }}>
                    <button type="button" className="ref-name muted" onClick={actions.openAccounts}>
                      {t('refs.prsLogin')}
                    </button>
                  </li>
                )}
                {prs.list.map((pr) => {
                  // clic: el commit de la rama de origen si está entre las remotas conocidas
                  const head = refs.remote.find((r) => r.name.endsWith(`/${pr.head}`))
                  return (
                    <li key={pr.id} className="ref-row" style={{ paddingLeft: 8 }}>
                      <button
                        type="button"
                        className="ref-name"
                        title={`#${pr.id} ${pr.title}\n${pr.head} → ${pr.base} · ${pr.author}${head ? '' : `\n${t('refs.prsNoBranch')}`}`}
                        onClick={() => head && actions.goTo(head.hash)}
                      >
                        <span className="muted">#{pr.id}</span> {pr.draft && <span className="muted">[{t('refs.prsDraft')}]</span>} {pr.title}
                      </button>
                      <button type="button" className="ref-eye" title={t('refs.prsOpen')} aria-label={t('refs.prsOpen')} onClick={() => actions.openPr(pr.url)}>
                        ↗
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
        {section('tags', ICON.tag, t('refs.tags'), refs.tags, false)}
        {refs.submodules.length > 0 && (
          <section className={`refs-section${submodulesOpen ? '' : ' closed'}`}>
            <div className="refs-section-head">
              {sectionTitle('submodules', ICON.submodule, t('refs.submodules'), refs.submodules.length, submodulesOpen)}
              <button type="button" className="refs-section-add" title={t('submodule.add')} aria-label={t('submodule.add')} onClick={() => actions.submoduleAdd()}>
                +
              </button>
            </div>
            {submodulesOpen && (
              <ul>
                {refs.submodules.map((s) => (
                  <li
                    key={s.path}
                    className="ref-row"
                    style={{ paddingLeft: 8 + 15 }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSubmoduleMenu({ x: e.clientX, y: e.clientY, sub: s })
                    }}
                  >
                    <button
                      type="button"
                      className="ref-name"
                      title={t('submodule.tip', { path: s.path, url: s.url })}
                      onClick={() => s.state !== 'uninitialized' && actions.submoduleOp('open', s)}
                    >
                      <span className="muted ref-state" title={t(`submodule.state.${s.state}` as const)}>
                        {s.state === 'ok' ? '' : s.state === 'uncommitted' ? '+ ' : s.state === 'uninitialized' ? '○ ' : s.state === 'outOfSync' ? '↻ ' : '⚠ '}
                      </span>
                      {ICON.submodule}
                      <span className="ref-label">{s.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      {menu && (
        <RefMenu
          {...menu}
          name={menu.ref.name}
          pinned={filter.pinned === menu.ref.ref}
          isHidden={hidden.has(menu.ref.ref)}
          onClose={() => setMenu(null)}
          onCopyName={() => actions.copy(menu.ref.name)}
          onCopySha={() => actions.copy(menu.ref.hash)}
          onToggleHidden={() => setHidden(menu.ref.ref, !hidden.has(menu.ref.ref))}
          tag={
            menu.ref.ref.startsWith('refs/tags/') && menu.remoteTags
              ? { onRemote: menu.remoteTags.names.includes(menu.ref.name), remote: menu.remoteTags.remote, op: (op) => actions.tagOp(op, menu.ref.name, menu.remoteTags!.remote) }
              : null
          }
          onRename={'current' in menu.ref ? () => actions.renameBranch(menu.ref.name) : null}
          onDelete={
            'current' in menu.ref
              ? () => {
                  const many = picked.size > 1 && picked.has(menu.ref.ref) ? refs.local.filter((x) => picked.has(x.ref)).map((x) => x.name) : [menu.ref.name]
                  actions.deleteBranches(many)
                }
              : null
          }
          deleteCount={'current' in menu.ref && picked.size > 1 && picked.has(menu.ref.ref) ? picked.size : 1}
          onSolo={() => {
            const keep = new Set([menu.ref.ref])
            const up = 'upstream' in menu.ref && menu.ref.upstream ? `refs/remotes/${menu.ref.upstream}` : null
            if (up) keep.add(up)
            actions.setFilter({ ...filter, mode: 'all', hidden: allBranchRefs.filter((r) => !keep.has(r)) })
          }}
          onPin={() => actions.setFilter({ ...filter, pinned: filter.pinned === menu.ref.ref ? null : menu.ref.ref })}
          onWeb={menu.ref.ref.startsWith('refs/tags/') ? null : (kind) => actions.openWeb({ kind, ref: menu.ref.ref })}
        />
      )}
      {remoteMenu && (
        <div className="refs-menu" role="menu" style={{ left: remoteMenu.x, top: remoteMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {(['fetch', 'edit', 'remove'] as const).map((op) => (
            <button
              key={op}
              type="button"
              role="menuitem"
              onClick={() => {
                actions.remoteOp(op, remoteMenu.name)
                setRemoteMenu(null)
              }}
            >
              {t(`remote.${op}` as const, { name: remoteMenu.name })}
            </button>
          ))}
        </div>
      )}
      {worktreeMenu && (
        <div className="refs-menu" role="menu" style={{ left: worktreeMenu.x, top: worktreeMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {(
            [
              ['open', 'worktree.open', !worktreeMenu.current],
              ['openTab', 'worktree.openTab', !worktreeMenu.current],
              ['remove', 'worktree.remove', !worktreeMenu.current && !worktreeMenu.locked],
              ['removeBranch', 'worktree.removeBranch', !worktreeMenu.current && !worktreeMenu.locked && !!worktreeMenu.branch],
              ['removeBranchRemote', 'worktree.removeBranchRemote', !worktreeMenu.current && !worktreeMenu.locked && !!worktreeMenu.branch && refs.remote.some((r) => r.name.endsWith(`/${worktreeMenu.branch}`))],
              [worktreeMenu.locked ? 'unlock' : 'lock', worktreeMenu.locked ? 'worktree.unlock' : 'worktree.lock', !worktreeMenu.current]
            ] as const
          ).map(([op, label, enabled]) => (
            <button
              key={op}
              type="button"
              role="menuitem"
              disabled={!enabled}
              onClick={() => {
                actions.worktreeOp(op, { path: worktreeMenu.path, branch: worktreeMenu.branch })
                setWorktreeMenu(null)
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>
      )}
      {submoduleMenu && (
        <div className="refs-menu" role="menu" style={{ left: submoduleMenu.x, top: submoduleMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {(
            [
              ['init', 'submodule.init', submoduleMenu.sub.state === 'uninitialized'],
              ['commit', 'submodule.commit', submoduleMenu.sub.state === 'uncommitted' || submoduleMenu.sub.state === 'outOfSync'],
              ['stage', 'submodule.stage', submoduleMenu.sub.state === 'outOfSync'],
              ['update', 'submodule.update', submoduleMenu.sub.state !== 'uninitialized' && submoduleMenu.sub.state !== 'uncommitted'],
              ['edit', 'submodule.edit', true],
              ['open', 'submodule.open', submoduleMenu.sub.state !== 'uninitialized'],
              ['delete', 'submodule.delete', true]
            ] as const
          ).map(([op, label, enabled]) => (
            <button
              key={op}
              type="button"
              role="menuitem"
              disabled={!enabled}
              onClick={() => {
                actions.submoduleOp(op, submoduleMenu.sub)
                setSubmoduleMenu(null)
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>
      )}
      {stashMenu && (
        <div
          className="refs-menu"
          role="menu"
          style={{ left: stashMenu.x, top: stashMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {(['apply', 'pop', 'drop', 'rename'] as const).map((op) => (
            <button
              key={op}
              type="button"
              role="menuitem"
              onClick={() => {
                actions.stashOp(op, { hash: stashMenu.hash, message: stashMenu.message })
                setStashMenu(null)
              }}
            >
              {t(op === 'apply' ? 'stash.apply' : op === 'pop' ? 'stash.pop' : op === 'drop' ? 'stash.drop' : 'stash.edit')}
            </button>
          ))}
        </div>
      )}
      {sectionMenu && (
        <SectionMenu
          x={sectionMenu.x}
          y={sectionMenu.y}
          title={sectionTitles[sectionMenu.key] ?? sectionMenu.key}
          sectionRefs={sectionRefs[sectionMenu.key] ?? null}
          hiddenNow={(sectionRefs[sectionMenu.key] ?? []).some((r) => hidden.has(r))}
          maximized={maximized === sectionMenu.key}
          onClose={() => setSectionMenu(null)}
          onHideAll={(on) => {
            const next = new Set(filter.hidden)
            for (const r of sectionRefs[sectionMenu.key] ?? []) on ? next.add(r) : next.delete(r)
            actions.setFilter({ ...filter, mode: 'all', hidden: [...next] })
          }}
          onMaximize={() => {
            const key = sectionMenu.key
            if (maximized === key) {
              setMaximized(null)
              setClosed(new Set(['tags', 'stashes', 'worktrees', 'submodules']))
            } else {
              setMaximized(key)
              setClosed(new Set(Object.keys(sectionTitles).filter((k) => k !== key)))
            }
          }}
        />
      )}
    </aside>
  )
}

/** Menú «⋮» de una rama (C20): solo lectura y vista. */
function RefMenu(p: {
  x: number
  y: number
  name: string
  pinned: boolean
  isHidden: boolean
  onClose: () => void
  onCopyName: () => void
  onCopySha: () => void
  onToggleHidden: () => void
  /** menú de un tag: borrar (local, remoto o los dos) y Push tag si solo está en local */
  tag: { onRemote: boolean; remote: string | null; op: (op: 'delete' | 'deleteRemote' | 'deleteBoth' | 'push') => void } | null
  onRename: (() => void) | null
  onDelete: (() => void) | null
  deleteCount: number
  onSolo: () => void
  onPin: () => void
  /** H23: abrir la rama o sus PR en la web; null en tags */
  onWeb: ((kind: 'branch' | 'prs') => void) | null
}) {
  const { t } = usePrefs()
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = p
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [onClose])
  const item = (label: string, fn: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        fn()
        onClose()
      }}
    >
      {label}
    </button>
  )
  return (
    <div ref={ref} className="refs-menu" role="menu" style={{ left: p.x, top: p.y }}>
      {item(t('refs.copyName'), p.onCopyName)}
      {item(t('refs.copySha'), p.onCopySha)}
      {item(p.isHidden ? t('refs.showShort') : t('filter.hide'), p.onToggleHidden)}
      {p.tag && !p.tag.onRemote && item(t('tag.delete', { name: p.name }), () => p.tag!.op('delete'))}
      {p.tag && !p.tag.onRemote && p.tag.remote && item(t('tag.push'), () => p.tag!.op('push'))}
      {p.tag && p.tag.onRemote && item(t('tag.delete', { name: p.name }), () => p.tag!.op('delete'))}
      {p.tag && p.tag.onRemote && item(t('tag.deleteRemote', { remote: p.tag.remote ?? 'origin', name: p.name }), () => p.tag!.op('deleteRemote'))}
      {p.tag && p.tag.onRemote && item(t('tag.deleteBoth', { remote: p.tag.remote ?? 'origin', name: p.name }), () => p.tag!.op('deleteBoth'))}
      {p.onRename && p.deleteCount === 1 && item(t('refs.renameBranch', { name: p.name }), p.onRename)}
      {p.onDelete && item(p.deleteCount > 1 ? t('refs.deleteMany', { n: p.deleteCount }) : t('refs.deleteBranch', { name: p.name }), p.onDelete)}
      {item(t('refs.solo'), p.onSolo)}
      {item(p.pinned ? t('filter.unpin') : t('filter.pin'), p.onPin)}
      {p.onWeb && item(t('web.branch'), () => p.onWeb!('branch'))}
      {p.onWeb && item(t('web.prs'), () => p.onWeb!('prs'))}
    </div>
  )
}

/** Clic derecho en el título de una sección: Hide all · Show all (en gris si no hay nada oculto) · Maximize this section. */
function SectionMenu(p: {
  x: number
  y: number
  title: string
  /** refs que oculta o muestra; null = esta sección solo se maximiza */
  sectionRefs: string[] | null
  hiddenNow: boolean
  maximized: boolean
  onClose: () => void
  onHideAll: (hide: boolean) => void
  onMaximize: () => void
}) {
  const { t } = usePrefs()
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = p
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [onClose])
  const item = (label: string, fn: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        fn()
        onClose()
      }}
    >
      {label}
    </button>
  )
  const section = p.title.toLowerCase()
  return (
    <div ref={ref} className="refs-menu" role="menu" style={{ left: p.x, top: p.y }}>
      {p.sectionRefs && item(t('refs.hideAll', { section }), () => p.onHideAll(true), p.sectionRefs.length === 0)}
      {p.sectionRefs && item(t('refs.showAll', { section }), () => p.onHideAll(false), !p.hiddenNow)}
      {item(p.maximized ? t('refs.restore') : t('refs.maximize'), p.onMaximize)}
    </div>
  )
}
