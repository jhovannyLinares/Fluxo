import { useEffect, useRef } from 'react'

export interface MenuEntry {
  label: string
  run?: () => void
  /** motivo por el que está en gris */
  why?: string
}

/** Menú de clic derecho con grupos separados; mismo cierre y colocación que el menú del commit. */
export function WipFileMenu(p: { x: number; y: number; groups: MenuEntry[][]; onClose: () => void }) {
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
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`
    if (r.right > window.innerWidth) el.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`
  }, [])
  return (
    <div ref={ref} className="refs-menu commit-menu" role="menu" style={{ left: p.x, top: p.y }}>
      {p.groups
        .filter((g) => g.length > 0)
        .map((g, i) => (
          <div key={i} className="refs-menu-group">
            {g.map((e) => (
              <button
                key={e.label}
                type="button"
                role="menuitem"
                disabled={!e.run || !!e.why}
                title={e.why}
                onClick={() => {
                  e.run?.()
                  onClose()
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        ))}
    </div>
  )
}
