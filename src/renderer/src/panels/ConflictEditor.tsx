import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call } from '../api'
import { usePrefs } from '../prefs'

type Seg = { type: 'text'; lines: string[] } | { type: 'conflict'; ours: string[]; theirs: string[] }
interface Side {
  label: string
  commit: string | null
}
interface Loaded {
  path: string
  eol: '\n' | '\r\n'
  finalNewline: boolean
  ours: Side
  theirs: Side
  segments: Seg[]
}

/** clave de una línea elegida: bloque, lado y posición */
const key = (block: number, side: 'A' | 'B', i: number) => `${block}:${side}:${i}`

/**
 * Editor de conflictos como el de GitKraken: la rama actual (A) a la izquierda, la que entra (B) a la derecha y el
 * resultado («Output») abajo. Se elige por línea, por bloque o por lado entero; el resultado junta lo elegido (A y
 * luego B) con el texto común. «Save» escribe el archivo y lo deja resuelto; el editor sigue abierto.
 */
export function ConflictEditor(p: { repoId: string; path: string; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const { t } = usePrefs()
  const [data, setData] = useState<Loaded | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [manual, setManual] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState(0)
  const [saving, setSaving] = useState(false)
  const blockRefs = useRef(new Map<number, HTMLElement>())
  const root = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    call('conflict:read', { repoId: p.repoId, path: p.path }).then(setData, (e) => {
      p.onError(e)
      p.onClose()
    })
  }, [p.repoId, p.path])
  useEffect(() => {
    load()
    root.current?.focus()
  }, [load])

  // cada conflicto con su número de bloque dentro de los segmentos
  const blocks = useMemo(() => (data?.segments ?? []).flatMap((s, i) => (s.type === 'conflict' ? [{ index: i, seg: s }] : [])), [data])

  const toggle = (keys: string[]) => {
    setManual(null)
    setPicked((cur) => {
      const next = new Set(cur)
      const all = keys.every((k) => next.has(k))
      for (const k of keys) all ? next.delete(k) : next.add(k)
      return next
    })
  }
  const sideKeys = (side: 'A' | 'B', only?: number) =>
    blocks.flatMap((b) => (only !== undefined && b.index !== only ? [] : (side === 'A' ? b.seg.ours : b.seg.theirs).map((_, i) => key(b.index, side, i))))

  // el resultado: texto común + lo elegido de cada conflicto (A primero, luego B)
  const output = useMemo(() => {
    const rows: { text: string; from: 'A' | 'B' | null }[] = []
    ;(data?.segments ?? []).forEach((s, bi) => {
      if (s.type === 'text') s.lines.forEach((text) => rows.push({ text, from: null }))
      else {
        s.ours.forEach((text, i) => picked.has(key(bi, 'A', i)) && rows.push({ text, from: 'A' }))
        s.theirs.forEach((text, i) => picked.has(key(bi, 'B', i)) && rows.push({ text, from: 'B' }))
      }
    })
    return rows
  }, [data, picked])
  const eol = data?.eol ?? '\n'
  const computed = output.map((r) => r.text).join(eol) + (output.length && data?.finalNewline ? eol : '')
  const text = manual ?? computed

  const go = (d: -1 | 1) => {
    if (!blocks.length) return
    const next = (current + d + blocks.length) % blocks.length
    setCurrent(next)
    blockRefs.current.get(blocks[next]!.index)?.scrollIntoView({ block: 'center' })
  }

  const save = async () => {
    setSaving(true)
    try {
      await call('conflict:save', { repoId: p.repoId, path: p.path, content: text })
      p.onSaved()
    } catch (e) {
      p.onError(e)
    } finally {
      setSaving(false)
    }
  }
  const reset = () => {
    setPicked(new Set())
    setManual(null)
    setEditing(false)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return
    if (e.key === 'Escape') p.onClose()
    else if (e.key === 'ArrowDown') (e.preventDefault(), go(1))
    else if (e.key === 'ArrowUp') (e.preventDefault(), go(-1))
    else if (e.ctrlKey && e.key.toLowerCase() === 's') (e.preventDefault(), void save())
  }

  if (!data) return <div className="conflict-editor" ref={root} tabIndex={-1} aria-busy="true" />
  const head = (name: 'A' | 'B', s: Side) => {
    const keys = sideKeys(name)
    return (
      <header className={`conflict-side ${name}`}>
        <input type="checkbox" aria-label={t('conflict.selectSide', { side: name })} checked={keys.length > 0 && keys.every((k) => picked.has(k))} onChange={() => toggle(keys)} />
        <span className={`conflict-badge ${name}`}>{name}</span>
        <span>
          {t('conflict.commit', { sha: s.commit ?? '—' })} {t('conflict.on')} <i>{s.label}</i>
        </span>
      </header>
    )
  }
  const pane = (name: 'A' | 'B') => {
    let line = 0
    return (
      <div className={`conflict-pane ${name}`}>
        {data.segments.map((s, bi) => {
          if (s.type === 'text') {
            const out = (
              <div key={bi} className="conflict-text">
                {s.lines.map((l, i) => (
                  <div key={i} className="conflict-line">
                    <span className="n">{line + i + 1}</span>
                    <span className="t">{l}</span>
                  </div>
                ))}
              </div>
            )
            line += s.lines.length
            return out
          }
          const lines = name === 'A' ? s.ours : s.theirs
          const keys = lines.map((_, i) => key(bi, name, i))
          const start = line
          line += lines.length
          return (
            <div
              key={bi}
              ref={(el) => {
                if (el && name === 'A') blockRefs.current.set(bi, el)
              }}
              className={`conflict-block ${name}${blocks[current]?.index === bi ? ' current' : ''}`}
            >
              <input type="checkbox" className="conflict-block-check" aria-label={t('conflict.selectBlock', { side: name })} checked={keys.length > 0 && keys.every((k) => picked.has(k))} onChange={() => toggle(keys)} />
              {lines.map((l, i) => (
                <div key={i} className={`conflict-line${picked.has(keys[i]!) ? ' picked' : ''}`}>
                  <span className="n">{start + i + 1}</span>
                  <button type="button" className="conflict-tick" aria-label={t('conflict.selectLine')} aria-pressed={picked.has(keys[i]!)} onClick={() => toggle([keys[i]!])}>
                    {picked.has(keys[i]!) ? '✔' : ''}
                  </button>
                  <span className="t">{l}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  const unresolved = blocks.length
  return (
    <div className="conflict-editor" ref={root} tabIndex={-1} onKeyDown={onKey} aria-label={t('conflict.aria', { file: data.path })}>
      <div className="conflict-bar">
        <span className="conflict-warn" aria-hidden="true">
          ⚠
        </span>
        <strong>{data.path}</strong>
        <span className="muted">{t(unresolved === 1 ? 'conflict.one' : 'conflict.many', { n: unresolved })}</span>
        <span className="conflict-spacer" />
        <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
          {t('conflict.save')}
        </button>
        <button type="button" className="btn ghost" aria-label={t('common.close')} onClick={p.onClose}>
          ✕
        </button>
      </div>
      <div className="conflict-top">
        <div>
          {head('A', data.ours)}
          {pane('A')}
        </div>
        <div>
          {head('B', data.theirs)}
          {pane('B')}
        </div>
      </div>
      <div className="conflict-out">
        <div className="conflict-out-head">
          <strong>{t('conflict.output')}</strong>
          <span className="conflict-nav">
            {t('conflict.of', { i: Math.min(current + 1, unresolved), n: unresolved })}
            <button type="button" className="btn ghost" aria-label={t('conflict.prev')} onClick={() => go(-1)}>
              ▲
            </button>
            <button type="button" className="btn ghost" aria-label={t('conflict.next')} onClick={() => go(1)}>
              ▼
            </button>
          </span>
          <span className="conflict-spacer" />
          <button type="button" className="btn ghost" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            {t('conflict.editByHand')}
          </button>
          {(picked.size > 0 || manual !== null) && (
            <button type="button" className="btn" onClick={reset}>
              {t('conflict.reset')}
            </button>
          )}
        </div>
        {editing || manual !== null ? (
          <textarea className="conflict-textarea" value={text} spellCheck={false} onChange={(e) => setManual(e.target.value)} aria-label={t('conflict.output')} />
        ) : (
          <div className="conflict-output">
            {output.map((r, i) => (
              <div key={i} className={`conflict-line out ${r.from ?? ''}`}>
                <span className="side">{r.from ?? ''}</span>
                <span className="n">{i + 1}</span>
                <span className="t">{r.text}</span>
              </div>
            ))}
            {output.length === 0 && (
              <div className="conflict-line out">
                <span className="side" />
                <span className="n">1</span>
                <span className="t" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
