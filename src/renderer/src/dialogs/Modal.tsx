import { useEffect, useRef, type ReactNode } from 'react'
import { usePrefs } from '../prefs'

/** Diálogo modal nativo: Esc y clic en el fondo cierran; el foco vuelve solo al cerrar. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { t } = usePrefs()

  // sin close() al desmontar: el evento close llegaría tarde y cerraría el diálogo reabierto (StrictMode)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) {
      d.showModal()
      // showModal enfoca el primer control (Cerrar); el autoFocus de React ocurre antes y se pierde
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('common.close')}
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  )
}
