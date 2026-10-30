import { useEffect, useRef, useState } from 'react'
import type { OpenIn } from '@shared/menu'
import { MAX_PINNED, type Recent } from '@shared/recents'
import { call } from '../api'
import { usePrefs } from '../prefs'

interface Actions {
  onBrowse: () => void
  onClone: () => void
  onInit: () => void
  onOpen: (path: string) => void
  onRemove: (path: string) => void
  onPin: (path: string, pinned: boolean) => void
  onOpenIn: (target: OpenIn, path: string) => void
  onCopy: (text: string) => void
}

/**
 * Pestaña nueva: «Repositorios» con Abrir y Clonar, los fijados arriba y los recientes debajo. Cada fila marca si la
 * carpeta ya no existe (un `git status` por repo, como la gestión de repositorios) y tiene clic derecho.
 */
export function ReposScreen(p: Actions & { recents: Recent[] | null; blocked: boolean; busy: boolean }) {
  const { t } = usePrefs()
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; recent: Recent } | null>(null)

  const pathsKey = (p.recents ?? []).map((r) => r.path).join('\n')
  useEffect(() => {
    let live = true
    for (const path of pathsKey.split('\n').filter(Boolean)) {
      call('repo:summary', { path }).then(
        (r) =>
          live &&
          setMissing((s) => {
            const n = new Set(s)
            if (r.summary) n.delete(path)
            else n.add(path)
            return n
          }),
        () => {}
      )
    }
    return () => {
      live = false
    }
  }, [pathsKey])

  const recents = p.recents ?? []
  const pinned = recents.filter((r) => r.pinned)
  const rest = recents.filter((r) => !r.pinned)
  const pinFull = pinned.length >= MAX_PINNED

  const row = (r: Recent) => {
    const gone = missing.has(r.path)
    return (
      <li
        key={r.path}
        className={gone ? 'missing' : undefined}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, recent: r })
        }}
      >
        <button type="button" className="recent-open" title={r.path} disabled={p.blocked || gone} onClick={() => p.onOpen(r.path)}>
          <strong>{r.name}</strong>
          <span className="muted">{r.path}</span>
          {gone && <em className="recent-missing">{t('repos.missing')}</em>}
        </button>
        <button
          type="button"
          className={`recent-pin${r.pinned ? ' on' : ''}`}
          title={t(r.pinned ? 'recents.unpinAria' : 'recents.pinAria', { name: r.name })}
          aria-label={t(r.pinned ? 'recents.unpinAria' : 'recents.pinAria', { name: r.name })}
          aria-pressed={!!r.pinned}
          disabled={!r.pinned && pinFull}
          onClick={() => p.onPin(r.path, !r.pinned)}
        >
          📌
        </button>
        <button
          type="button"
          className="recent-remove"
          title={t('recents.removeAria', { name: r.name })}
          aria-label={t('recents.removeAria', { name: r.name })}
          onClick={() => p.onRemove(r.path)}
        >
          ✕
        </button>
      </li>
    )
  }

  const section = (title: string, list: Recent[]) =>
    list.length > 0 && (
      <section className="recents" aria-label={title}>
        <h2>{title}</h2>
        <ul>{list.map(row)}</ul>
      </section>
    )

  return (
    <div className="repos-screen">
      <h1>{t('repos.title')}</h1>
      <div className="repos-actions">
        <button type="button" className="repos-btn" onClick={p.onBrowse} disabled={p.blocked}>
          <span aria-hidden="true">📂</span> {p.busy ? t('toolbar.loading') : t('repos.open')}
        </button>
        <button type="button" className="repos-btn" onClick={p.onClone} disabled={p.blocked}>
          <span aria-hidden="true">⤓</span> {t('repos.clone')}
        </button>
        <button type="button" className="repos-btn" onClick={p.onInit} disabled={p.blocked}>
          <span aria-hidden="true">+</span> {t('repos.init')}
        </button>
      </div>
      {section(t('recents.pinned'), pinned)}
      {section(t('recents.title'), rest)}
      {menu && (
        <RecentMenu
          {...menu}
          gone={missing.has(menu.recent.path)}
          blocked={p.blocked}
          pinFull={pinFull}
          actions={p}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/** Clic derecho en un reciente: abrir, abrir afuera, copiar la ruta, fijar y quitar. */
function RecentMenu(p: { x: number; y: number; recent: Recent; gone: boolean; blocked: boolean; pinFull: boolean; actions: Actions; onClose: () => void }) {
  const { t } = usePrefs()
  const ref = useRef<HTMLDivElement>(null)
  const { onClose, recent: r, actions: a } = p

  // mismo cierre y misma colocación que el menú del commit
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

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const b = el.getBoundingClientRect()
    if (b.bottom > window.innerHeight) el.style.top = `${Math.max(4, window.innerHeight - b.height - 4)}px`
    if (b.right > window.innerWidth) el.style.left = `${Math.max(4, window.innerWidth - b.width - 4)}px`
  }, [])

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
  return (
    <div ref={ref} className="refs-menu commit-menu" role="menu" style={{ left: p.x, top: p.y }}>
      <div className="refs-menu-group">{item(t('repos.open'), () => a.onOpen(r.path), p.gone || p.blocked)}</div>
      <div className="refs-menu-group">
        {item(t('menu.openEditor'), () => a.onOpenIn('editor', r.path), p.gone)}
        {item(t('menu.openTerminal'), () => a.onOpenIn('terminal', r.path), p.gone)}
        {item(t('menu.openExplorer'), () => a.onOpenIn('explorer', r.path), p.gone)}
        {item(t('recents.copyPath'), () => a.onCopy(r.path))}
      </div>
      <div className="refs-menu-group">
        {item(t(r.pinned ? 'recents.unpin' : 'recents.pin'), () => a.onPin(r.path, !r.pinned), !r.pinned && p.pinFull)}
        {item(t('repos.removeRecent'), () => a.onRemove(r.path))}
      </div>
    </div>
  )
}
