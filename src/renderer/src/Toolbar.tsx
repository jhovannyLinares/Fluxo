import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { Recent } from '@shared/recents'
import { DEFAULT_PULL, PullDefaultSchema, type PullDefault, type PullMode } from '@shared/pull'
import { usePrefs } from './prefs'

/** Opciones del menú Pull ▾. */
const PULL_LABELS: Record<PullDefault, string> = {
  fetch: 'Fetch All',
  ff: 'Pull (fast-forward if possible)',
  'ff-only': 'Pull (fast-forward only)',
  rebase: 'Pull (rebase)'
}
const PULL_KEY = 'fluxo.pull.default'
const readPullDefault = (): PullDefault => {
  try {
    const v = PullDefaultSchema.safeParse(localStorage.getItem(PULL_KEY))
    return v.success ? v.data : DEFAULT_PULL
  } catch {
    return DEFAULT_PULL
  }
}

type Icon ='undo' | 'redo' | 'fetch' | 'push' | 'branch' | 'stash' | 'pop' | 'terminal' | 'web'

const svg = (children: ReactElement) => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

/** Íconos de 20 px de la barra (trazo del color del texto). */
// mientras corre, el icono se cambia por un arco que gira: girar la flecha se leía como «actualizar»
const SPINNER = svg(<path d="M10 3a7 7 0 1 1-7 7" />)

const ICONS: Record<Icon, ReactElement> = {
  undo: svg(<path d="M5 8a6 6 0 1 1 1.2 6M5 3.5V8h4.5" />),
  redo: svg(<path d="M15 8a6 6 0 1 0-1.2 6M15 3.5V8h-4.5" />),
  fetch: svg(<path d="M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16.5h12" />),
  push: svg(<path d="M10 14V4M5.5 8.5 10 4l4.5 4.5M4 16.5h12" />),
  branch: svg(
    <>
      <circle cx="6" cy="4.5" r="1.8" />
      <circle cx="6" cy="15.5" r="1.8" />
      <circle cx="14" cy="7" r="1.8" />
      <path d="M6 6.3v7.4M14 8.8c0 3-8 2.5-8 5" />
    </>
  ),
  stash: svg(<path d="M3 11v5h14v-5M10 3v8M7 8l3 3 3-3M3 11h4l1 2h4l1-2h4" />),
  pop: svg(<path d="M3 11v5h14v-5M10 11V3M7 6l3-3 3 3M3 11h4l1 2h4l1-2h4" />),
  terminal: svg(<path d="M4 6l4 4-4 4M10 15h6" />),
  web: svg(
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M3 10h14M10 3c2.2 2.2 2.2 11.8 0 14M10 3c-2.2 2.2-2.2 11.8 0 14" />
    </>
  )
}

/**
 * Barra de herramientas (48 px): a la izquierda repo y rama con su rótulo chico;
 * al centro los mismos botones y en el mismo orden (Undo, Redo · Pull, Push · Branch · Stash, Pop · Terminal).
 * Los que escriben en el repo se ven en gris con el aviso «llega en la v1.2»; Fetch va en el lugar de Pull,
 * Terminal abre la carpeta del repo y Web (propio de Fluxo) abre la rama en el navegador.
 */
export function Toolbar(p: {
  repo: { name: string; root: string } | null
  branch: string | null
  recents: Recent[] | null
  blocked: boolean
  fetching: boolean
  onOpenPath: (path: string) => void
  onOpen: () => void
  onClone: () => void
  onInit: () => void
  onFetch: () => void
  /** ramas locales para el selector de la barra (clic en la rama actual) */
  locals: { name: string; ref: string; current: boolean }[]
  onCheckoutBranch: (ref: string) => void
  /** botón Branch: crea una rama en el commit elegido */
  onCreateBranch: () => void
  branchNeedsCommit: boolean
  /** Undo y Redo del reflog: lo que harían (para el tooltip) o null si no hay nada */
  undo: { label: string } | null
  redo: { label: string } | null
  onUndo: () => void
  onRedo: () => void
  /** Stash de todo y Pop del último; `stashCount` apaga Pop si no hay */
  onStash: () => void
  onPop: () => void
  stashCount: number
  onWeb: () => void
  /** abre la carpeta del repo en la terminal (no escribe en el repo) */
  onTerminal: () => void
  /** pull de la rama actual con la variante elegida */
  onPull: (mode: PullMode) => void
  pulling: boolean
  /** push de la rama actual (sin upstream abre el diálogo de destino) */
  onPush: () => void
  pushing: boolean
  /** motivo por el que Push está en gris; null = se puede */
  pushWhy: string | null
  /** a dónde sube, en el texto al pasar el ratón */
  pushTitle: string
  /** avatar con la cuenta de GitHub del repo, arriba a la derecha (solo con remoto GitHub) */
  account?: ReactElement | null
}) {
  const { t, prefs } = usePrefs()
  const [repoMenu, setRepoMenu] = useState(false)
  const [pullMenu, setPullMenu] = useState(false)
  const [branchMenu, setBranchMenu] = useState(false)
  const [branchQuery, setBranchQuery] = useState('')
  const branchRef = useRef<HTMLDivElement>(null)
  const [pullDefault, setPullDefault] = useState<PullDefault>(readPullDefault)
  const busyPull = p.fetching || p.pulling
  const runPull = () => (pullDefault === 'fetch' ? p.onFetch() : p.onPull(pullDefault))
  // elegir en el menú cambia lo que hace el botón y se recuerda; no ejecuta nada hasta el clic en Pull
  const choosePull = (op: PullDefault) => {
    setPullDefault(op)
    setPullMenu(false)
    try {
      localStorage.setItem(PULL_KEY, op)
    } catch {
      // solo se pierde lo recordado
    }
  }
  const menuRef = useRef<HTMLDivElement>(null)
  const pullRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!repoMenu && !pullMenu && !branchMenu) return
    const close = (e: Event) => {
      const inside =
        menuRef.current?.contains(e.target as Node) || pullRef.current?.contains(e.target as Node) || branchRef.current?.contains(e.target as Node)
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !inside) {
        setRepoMenu(false)
        setPullMenu(false)
        setBranchMenu(false)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [repoMenu, pullMenu, branchMenu])

  // botón que escribe en el repo: se ve en su lugar, apagado hasta la v1.2
  const soon = (key: Icon, label: string) => (
    <button key={key} type="button" className="tb-btn soon" disabled title={t('toolbar.soon', { action: label })} aria-label={label}>
      {ICONS[key]}
      <span>{label}</span>
    </button>
  )
  const button = (key: Icon, label: string, onClick: () => void, disabled: boolean, title?: string) => (
    <button
      key={key}
      type="button"
      className={`tb-btn${(key === 'fetch' && busyPull) || (key === 'push' && p.pushing) ? ' spinning' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
    >
      {(key === 'fetch' && busyPull) || (key === 'push' && p.pushing) ? SPINNER : ICONS[key]}
      <span>{label}</span>
    </button>
  )
  const choose = (fn: () => void) => () => {
    setRepoMenu(false)
    fn()
  }

  return (
    <header className={`toolbar${prefs.toolbarLabels ? '' : ' no-labels'}`}>
      <div className="crumb" ref={menuRef}>
        {/* C23: el nombre no basta (worktrees, clones de agentes): la ruta va en el texto al pasar el ratón */}
        <button type="button" className="crumb-opt" title={p.repo?.root} aria-expanded={repoMenu} onClick={() => setRepoMenu((v) => !v)}>
          <span className="crumb-help">{t('toolbar.repo')}</span>
          <span className="crumb-name">
            {p.repo ? p.repo.name : t('toolbar.noRepo')} <small>▾</small>
          </span>
        </button>
        {repoMenu && (
          <div className="crumb-menu" role="menu">
            <button type="button" role="menuitem" disabled={p.blocked} onClick={choose(p.onOpen)}>
              {t('menu.open')}
            </button>
            <button type="button" role="menuitem" disabled={p.blocked} onClick={choose(p.onClone)}>
              {t('menu.clone')}
            </button>
            <button type="button" role="menuitem" disabled={p.blocked} onClick={choose(p.onInit)}>
              {t('menu.init')}
            </button>
            {p.recents && p.recents.length > 0 && <div className="crumb-menu-title">{t('recents.title')}</div>}
            {p.recents?.map((r) => (
              <button key={r.path} type="button" role="menuitem" title={r.path} disabled={p.blocked} onClick={choose(() => p.onOpenPath(r.path))}>
                <strong>{r.name}</strong> <span className="muted">{r.path}</span>
              </button>
            ))}
          </div>
        )}
        {/* selector de rama como GitKraken: desplegable con buscador, solo ramas locales, la actual resaltada */}
        <div className="crumb-branch" ref={branchRef}>
          <button
            type="button"
            className="crumb-opt"
            disabled={!p.branch}
            aria-expanded={branchMenu}
            title={p.branch ?? undefined}
            onClick={() => {
              setBranchQuery('')
              setBranchMenu((v) => !v)
            }}
          >
            <span className="crumb-help">{t('toolbar.branch')}</span>
            <span className="crumb-name">
              {p.branch ?? '—'} <small>▾</small>
            </span>
          </button>
          {branchMenu && (
            <div className="crumb-menu branch-menu" role="menu">
              <input
                className="input"
                data-autofocus
                autoFocus
                spellCheck={false}
                placeholder={t('branchSel.search')}
                value={branchQuery}
                onChange={(e) => setBranchQuery(e.target.value)}
              />
              {(() => {
                const q = branchQuery.trim().toLowerCase()
                const list = p.locals.filter((b) => b.name.toLowerCase().includes(q))
                if (!list.length) return <p className="muted">{t('branchSel.empty')}</p>
                return list.map((b) => (
                  <button
                    key={b.ref}
                    type="button"
                    role="menuitem"
                    className={b.current ? 'on' : ''}
                    onClick={() => {
                      setBranchMenu(false)
                      if (!b.current) p.onCheckoutBranch(b.ref)
                    }}
                  >
                    {b.current && <span className="ref-current">✓</span>} {b.name}
                  </button>
                ))
              })()}
            </div>
          )}
        </div>
      </div>
      <div className="tb-buttons">
        {button('undo', 'Undo', p.onUndo, !p.repo || !p.undo, p.undo ? t('toolbar.undoTip', { label: p.undo.label }) : t('toolbar.cannotUndo'))}
        {button('redo', 'Redo', p.onRedo, !p.repo || !p.redo, p.redo ? t('toolbar.redoTip', { label: p.redo.label }) : t('toolbar.noRedo'))}
        <span className="tb-sep" />
        {/* Pull ▾: el botón hace la operación marcada en el menú (por defecto, fast-forward si se puede) */}
        <span className="tb-split" ref={pullRef}>
          {/* el backend ya pone las escrituras en fila; aquí solo se evita encolar una sobre otra a ciegas */}
          {button('fetch', 'Pull', runPull, !p.repo || busyPull || p.pushing, busyPull ? t('fetch.running') : p.pushing ? t('toolbar.waitFor', { op: 'Push' }) : PULL_LABELS[pullDefault])}
          <button type="button" className="tb-caret" aria-label={t('toolbar.pullMenu')} aria-expanded={pullMenu} disabled={!p.repo} onClick={() => setPullMenu((v) => !v)}>
            ▾
          </button>
          {pullMenu && (
            <div className="tb-menu" role="menu">
              <p>{t('toolbar.pullMenu')}</p>
              {(Object.keys(PULL_LABELS) as PullDefault[]).map((op) => (
                <label key={op} className={op === pullDefault ? 'on' : ''}>
                  <input type="radio" name="pull-op" checked={op === pullDefault} onChange={() => choosePull(op)} /> {PULL_LABELS[op]}
                </label>
              ))}
            </div>
          )}
        </span>
        {button(
          'push',
          'Push',
          p.onPush,
          !p.repo || p.pushing || busyPull || p.pushWhy !== null,
          p.pushing ? t('push.running') : busyPull ? t('toolbar.waitFor', { op: p.pulling ? 'Pull' : 'Fetch' }) : p.pushWhy || p.pushTitle
        )}
        <span className="tb-sep" />
        {button('branch', 'Branch', p.onCreateBranch, !p.repo || p.branchNeedsCommit, p.branchNeedsCommit ? t('toolbar.branchNeedsCommit') : t('toolbar.branchBtn'))}
        <span className="tb-sep" />
        {button('stash', 'Stash', p.onStash, !p.repo, t('toolbar.stash'))}
        {button('pop', 'Pop', p.onPop, !p.repo || p.stashCount === 0, p.stashCount === 0 ? t('toolbar.noStash') : t('toolbar.pop'))}
        <span className="tb-line" />
        {button('terminal', 'Terminal', p.onTerminal, !p.repo, t('menu.openTerminal'))}
        {button('web', t('toolbar.web'), p.onWeb, !p.branch, t('web.branch'))}
      </div>
      <span className="legend">
        <span className="dot ai" /> {t('legend.ai')} <span className="dot human" /> {t('legend.human')}
      </span>
      {p.account}
    </header>
  )
}
