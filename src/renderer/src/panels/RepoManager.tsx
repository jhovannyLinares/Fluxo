import { useEffect, useState } from 'react'
import type { Recent } from '@shared/recents'
import type { RepoSummary } from '@shared/summary'
import { matchesRefFilter } from '@shared/refs'
import { call } from '../api'
import { usePrefs } from '../prefs'

interface Row {
  path: string
  name: string
}

const WIP_KEY = 'fluxo.repos.wipSummary'
const readWip = () => {
  try {
    return localStorage.getItem(WIP_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Gestión de repositorios (ícono de carpeta de las pestañas): Abrir, Clonar e Init
 * (en gris, v1.2), búsqueda, «Resumen WIP» y las secciones Repositorios abiertos y Recientes. Cada fila: nombre,
 * rama, ↑↓ y cambios sin commit; a la derecha, abrir en el Explorador y ✕ (cerrar la pestaña o quitar de recientes).
 */
export function RepoManager(p: {
  open: Row[]
  recents: Recent[]
  blocked: boolean
  onOpen: (path: string) => void
  onBrowse: () => void
  onClone: () => void
  onInit: () => void
  onCloseTab: (path: string) => void
  onCloseAllTabs: () => void
  onRemoveRecent: (path: string) => void
  onRemoveAllRecents: () => void
  onExplorer: (path: string) => void
  onClose: () => void
}) {
  const { t } = usePrefs()
  const [query, setQuery] = useState('')
  const [wip, setWip] = useState(readWip)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [summaries, setSummaries] = useState<Record<string, RepoSummary | null>>({})
  const { onClose } = p

  // un `git status` por repo, todos a la vez; las filas se pintan antes y el resumen llega después
  const paths = [...new Set([...p.open.map((r) => r.path), ...p.recents.map((r) => r.path)])]
  const pathsKey = paths.join('\n')
  useEffect(() => {
    let live = true
    for (const path of pathsKey.split('\n').filter(Boolean)) {
      call('repo:summary', { path }).then(
        (r) => live && setSummaries((s) => ({ ...s, [path]: r.summary })),
        () => live && setSummaries((s) => ({ ...s, [path]: null }))
      )
    }
    return () => {
      live = false
    }
  }, [pathsKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (key: string) =>
    setClosed((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const row = (r: Row, onRemove: () => void, removeLabel: string) => {
    const s = summaries[r.path]
    return (
      <li key={r.path} className="rm-row">
        <button type="button" className="rm-name" title={r.path} disabled={p.blocked} onClick={() => p.onOpen(r.path)}>
          {r.name}
        </button>
        <span className="rm-info">
          {s === undefined ? (
            <span className="muted">…</span>
          ) : s === null ? (
            <span className="muted">{t('repos.missing')}</span>
          ) : (
            <>
              <span className="rm-pill">⑂ {s.branch ?? 'HEAD'}</span>
              {(s.ahead > 0 || s.behind > 0) && (
                <span className="rm-pill track">
                  {s.ahead > 0 && `↑${s.ahead}`} {s.behind > 0 && `↓${s.behind}`}
                </span>
              )}
              {wip && (s.modified > 0 || s.added > 0) && (
                <span className="rm-pill wip">
                  {s.modified > 0 && <span className="mod">✎ {s.modified}</span>} {s.added > 0 && <span className="add">+ {s.added}</span>}
                </span>
              )}
            </>
          )}
        </span>
        <span className="rm-actions">
          <button type="button" title={t('menu.openExplorer')} aria-label={t('menu.openExplorer')} onClick={() => p.onExplorer(r.path)}>
            ↗
          </button>
          <button type="button" title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
            ✕
          </button>
        </span>
      </li>
    )
  }

  const section = (key: string, title: string, rows: Row[], action: { label: string; run: () => void }, remove: (path: string) => void, removeLabel: string) => {
    const shown = rows.filter((r) => matchesRefFilter(`${r.name} ${r.path}`, query))
    const open = !closed.has(key)
    return (
      <section className="rm-section">
        <header>
          <button type="button" className="rm-title" aria-expanded={open} onClick={() => toggle(key)}>
            {open ? '▾' : '▸'} {title} <span className="rm-count">{shown.length}</span>
          </button>
          {rows.length > 0 && (
            <button type="button" className="rm-section-action" onClick={action.run}>
              ✕ {action.label}
            </button>
          )}
        </header>
        {open && (shown.length ? <ul>{shown.map((r) => row(r, () => remove(r.path), removeLabel))}</ul> : <p className="rm-empty">{t('repos.noMatches')}</p>)}
      </section>
    )
  }

  return (
    <div className="repo-manager" aria-label={t('repos.manager')}>
      <h1>{t('repos.manager')}</h1>
      <div className="rm-actions-bar">
        <button type="button" className="btn" disabled={p.blocked} onClick={p.onBrowse}>
          📂 {t('repos.open')}
        </button>
        <button type="button" className="btn" disabled={p.blocked} onClick={p.onClone}>
          ⤓ {t('repos.clone')}
        </button>
        <button type="button" className="btn" disabled={p.blocked} onClick={p.onInit}>
          + {t('repos.init')}
        </button>
      </div>
      <div className="rm-tools">
        <button type="button" className="link" onClick={() => setClosed(new Set(['open', 'recent']))}>
          {t('repos.collapse')}
        </button>
        <button type="button" className="link" onClick={() => setClosed(new Set())}>
          {t('repos.expand')}
        </button>
        <input className="input" type="search" placeholder={t('repos.search')} aria-label={t('repos.search')} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <label className="check">
          <input
            type="checkbox"
            checked={wip}
            onChange={(e) => {
              setWip(e.target.checked)
              try {
                localStorage.setItem(WIP_KEY, e.target.checked ? '1' : '0')
              } catch {
                // solo se pierde lo recordado
              }
            }}
          />
          {t('repos.wipSummary')}
        </label>
      </div>
      {section('open', t('repos.openRepos'), p.open, { label: t('repos.closeAllTabs'), run: p.onCloseAllTabs }, p.onCloseTab, t('menu.closeTab'))}
      {section(
        'recent',
        t('repos.recentRepos'),
        p.recents.map((r) => ({ path: r.path, name: r.name })),
        { label: t('repos.removeAll'), run: p.onRemoveAllRecents },
        p.onRemoveRecent,
        t('repos.removeRecent')
      )}
    </div>
  )
}
