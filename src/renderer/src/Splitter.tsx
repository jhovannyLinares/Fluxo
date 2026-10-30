import { usePrefs } from './prefs'

/**
 * B1: divisor de 7 px entre paneles (`--handle-width`). Arrastrar cambia el ancho; doble clic
 * vuelve al de fábrica. `dir` = 1 si al mover a la derecha el panel crece (izquierdo), -1 si se achica (detalle).
 */
export function Splitter({
  width,
  dir,
  onResize,
  onDone,
  onReset
}: {
  width: number
  dir: 1 | -1
  onResize: (next: number) => void
  onDone: () => void
  onReset: () => void
}) {
  const { t } = usePrefs()
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      title={t('layout.splitter')}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        const x0 = e.clientX
        const move = (ev: PointerEvent) => onResize(width + dir * (ev.clientX - x0))
        const up = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.classList.remove('dragging')
          onDone()
        }
        el.classList.add('dragging')
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
      }}
    />
  )
}
