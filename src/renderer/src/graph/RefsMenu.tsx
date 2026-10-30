import { useEffect, useRef } from 'react'
import type { GraphFilter } from '@shared/graph-types'
import { usePrefs } from '../prefs'
import type { DisplayRef } from './refs-display'

/**
 * Menú de la columna de etiquetas (H15): por cada rama, ocultar o anclar a la izquierda.
 * Solo acciones de vista: la v1.0 no escribe en el repo.
 */
export function RefsMenu({
  x,
  y,
  refs,
  filter,
  onHide,
  onPin,
  onClose
}: {
  x: number
  y: number
  refs: DisplayRef[]
  filter: GraphFilter
  onHide: (d: DisplayRef) => void
  onPin: (ref: string | null) => void
  onClose: () => void
}) {
  const { t } = usePrefs()
  const ref = useRef<HTMLDivElement>(null)

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

  const branches = refs.filter((d) => d.kind === 'branch' && d.refs.length)
  return (
    <div ref={ref} className="refs-menu" role="menu" style={{ left: x, top: y }}>
      {branches.length === 0 && <p className="muted">{t('filter.noBranches')}</p>}
      {branches.map((d) => {
        const pinRef = d.refs[0]!
        const pinned = filter.pinned === pinRef
        return (
          <div key={d.name} className="refs-menu-group">
            <strong>{d.name}</strong>
            <button type="button" role="menuitem" onClick={() => onHide(d)}>
              {t('filter.hide')}
            </button>
            <button type="button" role="menuitem" onClick={() => onPin(pinned ? null : pinRef)}>
              {pinned ? t('filter.unpin') : t('filter.pin')}
            </button>
          </div>
        )
      })}
    </div>
  )
}
