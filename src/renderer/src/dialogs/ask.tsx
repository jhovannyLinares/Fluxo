import { useCallback, useState, type ReactElement } from 'react'
import { usePrefs } from '../prefs'
import { Modal } from './Modal'

type Pending =
  | { kind: 'text'; title: string; label: string; initial: string; ok: string; multiline?: boolean; allowEmpty?: boolean; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; body: string; ok: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'choice'; title: string; body: string; a: string; b: string; resolve: (v: 'a' | 'b' | null) => void }

/**
 * Preguntas de una línea para las acciones del menú: pedir un texto (nombre de rama, mensaje del stash, archivo
 * nuevo) o confirmar lo destructivo. Cada una devuelve una promesa; `node` va una vez en el árbol de la app.
 */
export function useAsk(): {
  askText: (o: { title: string; label: string; initial?: string; ok: string; multiline?: boolean; allowEmpty?: boolean }) => Promise<string | null>
  askConfirm: (o: { title: string; body: string; ok: string; danger?: boolean }) => Promise<boolean>
  askChoice: (o: { title: string; body: string; a: string; b: string }) => Promise<'a' | 'b' | null>
  node: ReactElement | null
} {
  const [p, setP] = useState<Pending | null>(null)
  const askText = useCallback(
    (o: { title: string; label: string; initial?: string; ok: string; multiline?: boolean; allowEmpty?: boolean }) =>
      new Promise<string | null>((resolve) => setP({ kind: 'text', initial: '', ...o, resolve })),
    []
  )
  const askConfirm = useCallback(
    (o: { title: string; body: string; ok: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => setP({ kind: 'confirm', danger: true, ...o, resolve })),
    []
  )
  const askChoice = useCallback(
    (o: { title: string; body: string; a: string; b: string }) => new Promise<'a' | 'b' | null>((resolve) => setP({ kind: 'choice', ...o, resolve })),
    []
  )
  const done = (v: string | boolean | null) => {
    if (!p) return
    if (p.kind === 'text') p.resolve(typeof v === 'string' ? v : null)
    else if (p.kind === 'choice') p.resolve(v === 'a' || v === 'b' ? v : null)
    else p.resolve(v === true)
    setP(null)
  }
  const node = !p ? null : p.kind === 'text' ? (
    <TextAsk key={p.title} p={p} onDone={done} />
  ) : p.kind === 'choice' ? (
    <ChoiceAsk key={p.title} p={p} onDone={done} />
  ) : (
    <ConfirmAsk key={p.title} p={p} onDone={done} />
  )
  return { askText, askConfirm, askChoice, node }
}

function TextAsk({ p, onDone }: { p: Extract<Pending, { kind: 'text' }>; onDone: (v: string | null) => void }) {
  const { t } = usePrefs()
  const [value, setValue] = useState(p.initial)
  const ok = p.allowEmpty || value.trim().length > 0
  const submit = () => ok && onDone(value.trim())
  return (
    <Modal title={p.title} onClose={() => onDone(null)}>
      <label className="field">
        <span>{p.label}</span>
        {p.multiline ? (
          <textarea className="input" data-autofocus rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <input
            className="input mono"
            data-autofocus
            type="text"
            value={value}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
          />
        )}
      </label>
      <div className="push-actions">
        <button type="button" className="btn ghost" onClick={() => onDone(null)}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={!ok} onClick={submit}>
          {p.ok}
        </button>
      </div>
    </Modal>
  )
}

function ConfirmAsk({ p, onDone }: { p: Extract<Pending, { kind: 'confirm' }>; onDone: (v: boolean) => void }) {
  const { t } = usePrefs()
  return (
    <Modal title={p.title} onClose={() => onDone(false)}>
      <p style={{ whiteSpace: 'pre-line' }}>{p.body}</p>
      <div className="push-actions">
        <button type="button" className="btn ghost" data-autofocus onClick={() => onDone(false)}>
          {t('common.cancel')}
        </button>
        <button type="button" className={`btn ${p.danger ? 'danger' : 'primary'}`} onClick={() => onDone(true)}>
          {p.ok}
        </button>
      </div>
    </Modal>
  )
}

function ChoiceAsk({ p, onDone }: { p: Extract<Pending, { kind: 'choice' }>; onDone: (v: 'a' | 'b' | null) => void }) {
  const { t } = usePrefs()
  return (
    <Modal title={p.title} onClose={() => onDone(null)}>
      <p style={{ whiteSpace: 'pre-line' }}>{p.body}</p>
      <div className="push-actions">
        <button type="button" className="btn ghost" onClick={() => onDone(null)}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn" onClick={() => onDone('b')}>
          {p.b}
        </button>
        <button type="button" className="btn primary" data-autofocus onClick={() => onDone('a')}>
          {p.a}
        </button>
      </div>
    </Modal>
  )
}
