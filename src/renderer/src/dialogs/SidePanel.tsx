import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { usePrefs } from '../prefs'

/**
 * Panel que se desliza junto al panel de ramas (como el «slidey panel» de GitKraken): pegado a su borde derecho,
 * de la barra al pie, 400 px (500 con `wide`), por encima del grafo sin moverlo. Esc o ✕ lo cierran.
 */
export function SidePanel({ title, icon, wide, onClose, children }: { title: string; icon?: ReactNode; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = usePrefs()
  const [box, setBox] = useState<{ left: number; top: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const r = document.querySelector('.refs-panel')?.getBoundingClientRect()
    setBox(r ? { left: r.right, top: r.top, height: r.height } : { left: 0, top: 82, height: window.innerHeight - 108 })
  }, [])
  useEffect(() => {
    document.querySelector<HTMLElement>('.side-panel [data-autofocus]')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!box) return null
  return (
    <section className={`side-panel${wide ? ' wide' : ''}`} role="dialog" aria-label={title} style={{ left: box.left, top: box.top, height: box.height, ['--sp-left' as string]: `${box.left}px`, ['--sp-top' as string]: `${box.top}px` }}>
      <header className="sp-head">
        {icon && <span className="sp-icon">{icon}</span>}
        <span className="sp-title">{title}</span>
        <button type="button" className="sp-close" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="sp-form">{children}</div>
    </section>
  )
}

/** Campo del panel: etiqueta de 20 px y caja de 36 px (borde incluido) con el input de 34 px dentro. */
export function SpField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="sp-group">
      <span className="sp-label">{label}</span>
      <span className="sp-input">{children}</span>
    </label>
  )
}
