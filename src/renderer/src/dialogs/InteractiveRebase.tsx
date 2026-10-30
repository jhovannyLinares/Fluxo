import { useEffect, useRef, useState } from 'react'
import { usePrefs } from '../prefs'

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'drop'
export interface RebaseRow {
  hash: string
  subject: string
}
export interface RebaseChoice {
  hash: string
  action: RebaseAction
  message?: string
}

const KEYS: Record<string, RebaseAction> = { p: 'pick', r: 'reword', s: 'squash', d: 'drop' }

/**
 * Interactive Rebase a pantalla completa, como GitKraken: cabecera «Rebasing [rama] onto [rama]» con Cancel Rebase,
 * una fila por commit (el más nuevo arriba) con su acción, y el pie con los atajos (P S R D, Ctrl+↑ / Ctrl+↓) y los
 * botones Reset, Cancel Rebase y Start Rebase. Devuelve los pasos del más viejo al más nuevo.
 */
export function InteractiveRebase(p: {
  current: string
  onto: string
  commits: RebaseRow[]
  onStart: (steps: RebaseChoice[]) => void
  onClose: () => void
}) {
  const { t } = usePrefs()
  const initial = (): { row: RebaseRow; action: RebaseAction; message: string }[] =>
    [...p.commits].reverse().map((row) => ({ row, action: 'pick', message: row.subject }))
  const [rows, setRows] = useState(initial)
  const [sel, setSel] = useState(0)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => root.current?.focus(), [])

  const set = (i: number, patch: Partial<{ action: RebaseAction; message: string }>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return
    setRows((rs) => {
      const next = [...rs]
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })
    setSel(j)
  }

  // el más viejo que se conserva no puede ser squash: no tiene a quién unirse
  const ordered = [...rows].reverse()
  const firstKept = ordered.find((r) => r.action !== 'drop')
  const badSquash = firstKept?.action === 'squash'
  const badReword = rows.some((r) => r.action === 'reword' && !r.message.trim())
  const start = () =>
    p.onStart(ordered.map((r) => ({ hash: r.row.hash, action: r.action, ...(r.action === 'reword' ? { message: r.message.trim() } : {}) })))

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (e.key === 'Escape') p.onClose()
    else if (e.ctrlKey && e.key === 'ArrowUp') (e.preventDefault(), move(sel, -1))
    else if (e.ctrlKey && e.key === 'ArrowDown') (e.preventDefault(), move(sel, 1))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
    else if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(rows.length - 1, s + 1)))
    else if (!e.ctrlKey && !e.altKey && KEYS[e.key.toLowerCase()]) set(sel, { action: KEYS[e.key.toLowerCase()]! })
  }

  return (
    <div ref={root} className="irebase-screen" role="dialog" aria-label={t('irebase.title', { current: p.current, onto: p.onto })} tabIndex={-1} onKeyDown={onKey}>
      <header className="irebase-head">
        <strong>Interactive Rebase</strong>
        <span className="irebase-chips">
          {t('irebase.rebasing')} <span className="chip cur">{p.current}</span> {t('irebase.onto')} <span className="chip onto">{p.onto}</span>
        </span>
        <button type="button" className="btn danger-outline" onClick={p.onClose}>
          {t('irebase.cancel')}
        </button>
      </header>
      <ul className="irebase-list">
        {rows.map((r, i) => (
          <li key={r.row.hash} className={`${i === sel ? 'sel ' : ''}${r.action}`} onClick={() => setSel(i)}>
            <select className="input" aria-label={r.row.subject} value={r.action} onChange={(e) => set(i, { action: e.target.value as RebaseAction })}>
              <option value="pick">{t('irebase.pick')}</option>
              <option value="reword">{t('irebase.reword')}</option>
              <option value="squash">{t('irebase.squash')}</option>
              <option value="drop">{t('irebase.drop')}</option>
            </select>
            <span className="irebase-dot" aria-hidden="true" />
            {r.action === 'reword' ? (
              <input className="input" type="text" value={r.message} onChange={(e) => set(i, { message: e.target.value })} />
            ) : (
              <span className="irebase-subject">{r.row.subject}</span>
            )}
            <span className="irebase-move">
              <button type="button" className="btn ghost" aria-label={t('irebase.up')} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="btn ghost" aria-label={t('irebase.down')} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>
      {badSquash && <p role="alert" className="irebase-warn">{t('irebase.badSquash')}</p>}
      <footer className="irebase-foot">
        <span className="irebase-keys">
          {t('irebase.shortcuts')}: <b>P</b> {t('irebase.pick')} · <b>S</b> {t('irebase.squash')} · <b>R</b> {t('irebase.reword')} · <b>D</b>{' '}
          {t('irebase.drop')} · <b>Ctrl+↑</b> {t('irebase.up')} · <b>Ctrl+↓</b> {t('irebase.down')}
        </span>
        <span className="irebase-actions">
          <button type="button" className="btn" onClick={() => (setRows(initial()), setSel(0))}>
            {t('irebase.reset')}
          </button>
          <button type="button" className="btn danger-outline" onClick={p.onClose}>
            {t('irebase.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={badSquash || badReword} onClick={start}>
            {t('irebase.start')}
          </button>
        </span>
      </footer>
    </div>
  )
}
