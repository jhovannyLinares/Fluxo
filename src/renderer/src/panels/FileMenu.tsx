import { useEffect, useRef } from 'react'
import { usePrefs } from '../prefs'

/** Clic derecho en un archivo del detalle (A1): «Historial del archivo» y «Blame del archivo». */
export function FileMenu(p: { x: number; y: number; onHistory: () => void; onBlame: () => void; onApply?: () => void; onRestore?: () => void; onClose: () => void }) {
  const { t } = usePrefs()
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = p

  // mismo cierre y misma colocación que el menú del commit
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
    <div ref={ref} className="refs-menu commit-menu" role="menu" style={{ left: p.x, top: p.y }}>
      <div className="refs-menu-group">
        {item(t('fileHistory.open'), p.onHistory)}
        {item(t('fileHistory.openBlame'), p.onBlame)}
        {p.onApply && item(t('stash.applyFile'), p.onApply)}
        {p.onRestore && item(t('file.restore'), p.onRestore)}
      </div>
    </div>
  )
}
