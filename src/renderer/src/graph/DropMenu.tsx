import { useEffect, useRef } from 'react'
import { usePrefs } from '../prefs'

/**
 * Menú al soltar una rama sobre otra (X sobre Y): Fast-forward Y a X, Merge X en Y, Rebase X sobre Y e
 * Interactive Rebase X sobre Y. Mismo cierre y colocación que el menú del commit.
 */
export function DropMenu(p: {
  x: number
  y: number
  from: string
  to: string
  /** `origin/Y` si la rama de destino tiene remota: habilita «Push X to origin/Y» */
  toRemote: string | null
  onPick: (kind: 'ff' | 'merge' | 'rebase' | 'interactive' | 'push') => void
  onClose: () => void
}) {
  const { t } = usePrefs()
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = p

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus()
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
    const r = el.getBoundingClientRect()
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`
    if (r.right > window.innerWidth) el.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`
  }, [])

  const item = (label: string, kind: 'ff' | 'merge' | 'rebase' | 'interactive' | 'push') => (
    <button
      key={kind}
      type="button"
      role="menuitem"
      onClick={() => {
        p.onPick(kind)
        onClose()
      }}
    >
      {label}
    </button>
  )
  return (
    <div ref={ref} className="refs-menu commit-menu" role="menu" style={{ left: p.x, top: p.y }}>
      <div className="refs-menu-group">
        {item(t('cm.fastForward', { current: p.to, branch: p.from }), 'ff')}
        {item(t('cm.merge', { current: p.to, branch: p.from }), 'merge')}
        {item(t('cm.rebase', { current: p.from, branch: p.to }), 'rebase')}
        {item(t('cm.interactiveRebase', { current: p.from, branch: p.to }), 'interactive')}
        {p.toRemote && item(t('drop.push', { from: p.from, to: p.toRemote }), 'push')}
      </div>
    </div>
  )
}
