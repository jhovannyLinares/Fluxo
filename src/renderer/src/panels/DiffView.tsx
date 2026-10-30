import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { FileChange } from '@shared/commit'
import type { WipArea } from '@shared/wip'
import { changePairs, changeStarts, sideBySide, wordSegments, type DiffLine, type FileDiff, type Hunk } from '@shared/diff'
import { filePatch, hunkPatch } from '@shared/patch'
import { useAsk } from '../dialogs/ask'
import { call } from '../api'
import { usePrefs } from '../prefs'

type Mode = 'hunks' | 'unified' | 'split'
const MODES: Mode[] = ['hunks', 'unified', 'split']

/** Íconos de los modos de la barra del diff: fragmentos, unificado, lado a lado. */
const MODE_ICONS: Record<Mode, ReactElement> = {
  hunks: (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="1.5" width="11" height="4" />
      <rect x="1.5" y="8.5" width="11" height="4" />
    </svg>
  ),
  unified: (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 3h10M2 6h10M2 9h10M2 12h10" />
    </svg>
  ),
  split: (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="1.5" width="11" height="11" />
      <path d="M7 1.5v11" />
    </svg>
  )
}

// C13 / C17: modo, espacios y ajuste de línea se recuerdan entre archivos y repos
const read = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // solo se pierde lo recordado
  }
}

/** Una fila pintada: cabecera de fragmento, línea (unificado) o par (lado a lado). */
type Row =
  | { kind: 'header'; text: string; hunk: Hunk }
  | { kind: 'line'; line: DiffLine; other: DiffLine | null }
  | { kind: 'pair'; left: DiffLine | null; right: DiffLine | null }

const changedRow = (r: Row) =>
  r.kind === 'line' ? r.line.t !== ' ' : r.kind === 'pair' ? r.left !== r.right : false

/**
 * Diff de un archivo (H19): fragmentos, unificado (archivo completo) o lado a lado (C13), resaltado por palabra (C14),
 * renombre y binario con mensaje propio (C15), salto entre cambios con ↑ ↓ y apertura en el primer cambio (C16),
 * ignorar espacios y ajuste de línea (C17). Solo lectura: no hay botones que escriban (N10).
 */
export function DiffView({
  repoId,
  hash,
  file,
  wipArea,
  againstWorktree,
  to,
  groupBase,
  onClose,
  onWrote
}: {
  repoId: string
  hash: string
  file: FileChange
  /** el stage o el árbol cambiaron desde aquí: pedir de nuevo la lista de cambios */
  onWrote?: () => void
  /** archivo sin commit: de qué área sale el diff (en stage, sin stage o nuevo) */
  wipArea?: WipArea
  /** B2: el commit contra el directorio de trabajo, en lugar de contra su padre */
  againstWorktree?: boolean
  /** B3: con `againstWorktree`, contra este commit en lugar del directorio de trabajo */
  to?: string
  /** fila con commits agrupados: el diff parte del padre del más viejo del grupo en lugar del primer padre */
  groupBase?: string
  onClose: () => void
}) {
  const { t } = usePrefs()
  const [mode, setMode] = useState<Mode>(() => {
    const m = read('fluxo.diff.mode', 'hunks')
    return MODES.includes(m as Mode) ? (m as Mode) : 'hunks'
  })
  const [ignoreSpace, setIgnoreSpace] = useState(() => read('fluxo.diff.ignoreSpace', '0') === '1')
  const [wrap, setWrap] = useState(() => read('fluxo.diff.wrap', '0') === '1')
  const [view, setView] = useState<'diff' | 'file'>(() => (read('fluxo.diff.view', 'diff') === 'file' ? 'file' : 'diff'))
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)
  // líneas elegidas para el stage por línea, y contador para volver a leer el diff tras escribir
  const [picked, setPicked] = useState<Set<DiffLine>>(new Set())
  const [reload, setReload] = useState(0)
  const [writing, setWriting] = useState(false)
  const ask = useAsk()
  const root = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    root.current?.focus()
  }, [file.path])

  useEffect(() => {
    let live = true
    setDiff(null)
    setError(null)
    if (file.binary) {
      setDiff({ path: file.path, oldPath: file.oldPath ?? null, binary: true, hunks: [] })
      return
    }
    const full = mode !== 'hunks' || view === 'file'
    const req = wipArea
      ? call('wip:diff', { repoId, path: file.path, oldPath: file.oldPath, area: wipArea, full, ignoreSpace })
      : againstWorktree
        ? call('commit:compareDiff', { repoId, hash, to, path: file.path, oldPath: file.oldPath, full, ignoreSpace })
        : call('commit:diff', { repoId, hash, path: file.path, oldPath: file.oldPath, full, ignoreSpace, base: groupBase })
    req.then(
      (d) => live && setDiff(d),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e))
    )
    return () => {
      live = false
    }
  }, [repoId, hash, groupBase, file, wipArea, againstWorktree, to, mode === 'hunks' && view === 'diff', ignoreSpace, reload])

  // otro archivo o un diff nuevo: las líneas elegidas eran de aquel
  useEffect(() => setPicked(new Set()), [diff])

  const rows = useMemo<Row[]>(() => {
    if (!diff) return []
    const out: Row[] = []
    // «Vista de archivo»: el archivo como quedó, sin marcas de diff
    if (view === 'file') {
      for (const h of diff.hunks) for (const l of h.lines) if (l.t !== '-') out.push({ kind: 'line', line: { ...l, t: ' ', old: null }, other: null })
      return out
    }
    // un archivo nuevo o borrado no tiene otro lado: se ve unificado aunque el modo sea lado a lado
    const oneSided = file.status === 'A' || file.status === 'D'
    for (const h of diff.hunks) {
      if (mode === 'hunks') out.push({ kind: 'header', text: h.header, hunk: h })
      if (mode === 'split' && !oneSided) {
        for (const r of sideBySide(h.lines)) out.push({ kind: 'pair', left: r.left, right: r.right })
      } else {
        const pairs = changePairs(h.lines)
        for (const l of h.lines) out.push({ kind: 'line', line: l, other: pairs.get(l) ?? null })
      }
    }
    return out
  }, [diff, mode, view, file.status])
  const starts = useMemo(() => changeStarts(rows.map(changedRow)), [rows])

  const goTo = (k: number) => {
    if (starts.length === 0) return
    const i = (k + starts.length) % starts.length
    setCurrent(i)
    body.current?.querySelector(`[data-row="${starts[i]}"]`)?.scrollIntoView({ block: 'center' })
  }

  // C16: con el archivo completo, se abre ya en el primer cambio
  useLayoutEffect(() => {
    setCurrent(0)
    if (mode !== 'hunks' && starts.length > 0) body.current?.querySelector(`[data-row="${starts[0]}"]`)?.scrollIntoView({ block: 'center' })
    else body.current?.scrollTo(0, 0)
  }, [starts, mode])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    else if (e.altKey && e.key === 'ArrowDown') goTo(current + 1)
    else if (e.altKey && e.key === 'ArrowUp') goTo(current - 1)
    else return
    e.preventDefault()
  }

  const text = (line: DiffLine, other: DiffLine | null): ReactElement | string =>
    other && line.t !== ' ' ? (
      <>
        {wordSegments(line.text, other.text).map((s, i) => (s.changed ? <mark key={i}>{s.text}</mark> : s.text))}
      </>
    ) : (
      line.text
    )

  const cell = (line: DiffLine | null, other: DiffLine | null, num: number | null) =>
    line ? (
      <>
        <span className="diff-num">{num ?? ''}</span>
        <span className={`diff-text t${line.t === ' ' ? 'c' : line.t === '-' ? 'd' : 'a'}`}>{text(line, other)}</span>
      </>
    ) : (
      <>
        <span className="diff-num" />
        <span className="diff-text empty" />
      </>
    )

  // stage por bloque o por línea: solo en archivos modificados, sin «ignorar espacios» (el patch no encajaría)
  // y fuera de lado a lado (ahí las filas son pares, no líneas)
  const canPatch = (wipArea === 'staged' || wipArea === 'unstaged') && file.status === 'M' && !ignoreSpace && mode !== 'split' && view === 'diff'
  const reverse = wipArea === 'staged'
  const writePatch = async (kind: 'stage' | 'discard', patches: string[]) => {
    const patch = filePatch(file.path, patches)
    if (kind === 'discard' && !(await ask.askConfirm({ title: t('ask.discardTitle'), body: t('ask.discardHunkBody'), ok: t('ask.discardOk') }))) return
    setWriting(true)
    try {
      if (kind === 'stage') await call('wip:stagePatch', { repoId, patch, reverse })
      else await call('wip:discard', { repoId, patch })
      setReload((n) => n + 1)
      onWrote?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWriting(false)
    }
  }
  const stageHunk = (h: Hunk, kind: 'stage' | 'discard') => {
    const p = hunkPatch(h, { reverse: kind === 'discard' || reverse })
    if (p) void writePatch(kind, [p])
  }
  const stagePicked = () => {
    const ps = (diff?.hunks ?? []).flatMap((h) => {
      const sel = new Set(h.lines.filter((l) => picked.has(l)))
      const p = sel.size ? hunkPatch(h, { selected: sel, reverse }) : null
      return p ? [p] : []
    })
    if (ps.length) void writePatch('stage', ps)
  }
  const togglePicked = (l: DiffLine) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(l)) n.delete(l)
      else n.add(l)
      return n
    })

  const cut = file.path.lastIndexOf('/') + 1
  const dir = file.path.slice(0, cut)
  const base = file.path.slice(cut)

  let message: string | null = null
  if (error) message = error
  else if (diff?.binary) message = t('diff.binary')
  else if (diff && diff.hunks.length === 0)
    message = diff.oldPath ? t('diff.renamedSame') : ignoreSpace ? t('diff.onlySpace') : t('diff.noContent')

  return (
    <div className="diff-view" ref={root} tabIndex={-1} onKeyDown={onKey} aria-label={t('diff.aria')}>
      {/* franja 1: ruta (carpeta en gris), acción de stage (v1.2) y cerrar */}
      <div className="diff-head">
        <span className="diff-path" title={file.oldPath ? `${file.oldPath} ⇒ ${file.path}` : file.path}>
          {file.oldPath && <span className="muted">{file.oldPath} ⇒ </span>}
          <span className="muted">{dir}</span>
          {base}
        </span>
        {canPatch && picked.size > 0 && (
          <button type="button" className="btn diff-stage" disabled={writing} onClick={stagePicked}>
            {t(reverse ? 'diff.unstageLines' : 'diff.stageLines')} ({picked.size})
          </button>
        )}
        <button type="button" className="diff-icon" onClick={onClose} title={t('diff.close')} aria-label={t('diff.close')}>
          ✕
        </button>
      </div>
      {/* franja 2: de dónde sale el diff, vista de archivo o de diff, saltos entre cambios, modos y conmutadores */}
      <div className="diff-toolbar">
        <span className="diff-area">
          {wipArea
            ? t(wipArea === 'staged' ? 'wip.stagedFiles' : 'wip.unstagedFiles')
            : againstWorktree
              ? to
                ? `${hash.slice(0, 7)}..${to.slice(0, 7)}`
                : t('compare.area', { sha: hash.slice(0, 7) })
              : `commit ${hash.slice(0, 7)}`}
        </span>
        <span className="diff-views" role="group">
          {(['file', 'diff'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? 'on' : ''}
              onClick={() => {
                setView(v)
                write('fluxo.diff.view', v)
              }}
            >
              {t(`diff.view.${v}`)}
            </button>
          ))}
        </span>
        <span className="diff-tools">
          <button type="button" className="diff-icon" disabled={view === 'file' || starts.length === 0} onClick={() => goTo(current - 1)} title={t('diff.prev')}>
            ↑
          </button>
          <button type="button" className="diff-icon" disabled={view === 'file' || starts.length === 0} onClick={() => goTo(current + 1)} title={t('diff.next')}>
            ↓
          </button>
          <span className="diff-gap" />
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`diff-icon${mode === m && view === 'diff' ? ' on' : ''}`}
              disabled={view === 'file'}
              title={t(`diff.mode.${m}`)}
              aria-label={t(`diff.mode.${m}`)}
              onClick={() => {
                setMode(m)
                write('fluxo.diff.mode', m)
              }}
            >
              {MODE_ICONS[m]}
            </button>
          ))}
          <span className="diff-gap" />
          <button
            type="button"
            className={`diff-icon${ignoreSpace ? ' on' : ''}`}
            title={t('diff.ignoreSpace')}
            aria-label={t('diff.ignoreSpace')}
            aria-pressed={ignoreSpace}
            onClick={() => {
              setIgnoreSpace(!ignoreSpace)
              write('fluxo.diff.ignoreSpace', ignoreSpace ? '0' : '1')
            }}
          >
            ¶
          </button>
          <button
            type="button"
            className={`diff-icon${wrap ? ' on' : ''}`}
            title={t('diff.wrap')}
            aria-label={t('diff.wrap')}
            aria-pressed={wrap}
            onClick={() => {
              setWrap(!wrap)
              write('fluxo.diff.wrap', wrap ? '0' : '1')
            }}
          >
            ↵
          </button>
        </span>
      </div>
      {ask.node}
      <div ref={body} className={`diff-body mode-${mode}${wrap ? ' wrap' : ''}`}>
        {message ? (
          <p className="muted diff-message">{message}</p>
        ) : !diff ? (
          <p className="muted diff-message">{t('toolbar.loading')}</p>
        ) : (
          rows.map((r, i) =>
            r.kind === 'header' ? (
              <div key={i} data-row={i} className="diff-row header mono">
                {r.text}
                {canPatch && (
                  <span className="hunk-acts">
                    <button type="button" className="btn ghost" disabled={writing} onClick={() => stageHunk(r.hunk, 'stage')}>
                      {t(reverse ? 'diff.unstageHunk' : 'diff.stageHunk')}
                    </button>
                    {!reverse && (
                      <button type="button" className="btn ghost danger" disabled={writing} onClick={() => stageHunk(r.hunk, 'discard')}>
                        {t('diff.discardHunk')}
                      </button>
                    )}
                  </span>
                )}
              </div>
            ) : r.kind === 'line' ? (
              <div
                key={i}
                data-row={i}
                className={`diff-row ${r.line.t === ' ' ? '' : r.line.t === '-' ? 'del' : 'add'}${picked.has(r.line) ? ' picked' : ''}`}
                onClick={canPatch && r.line.t !== ' ' ? () => togglePicked(r.line) : undefined}
              >
                <span className="diff-num">{r.line.old ?? ''}</span>
                {cell(r.line, r.other, r.line.new)}
              </div>
            ) : (
              <div key={i} data-row={i} className="diff-row pair">
                <span className={`side${r.left && r.left !== r.right ? ' del' : ''}`}>{cell(r.left, r.right, r.left?.old ?? null)}</span>
                <span className={`side${r.right && r.left !== r.right ? ' add' : ''}`}>{cell(r.right, r.left, r.right?.new ?? null)}</span>
              </div>
            )
          )
        )}
      </div>
    </div>
  )
}
