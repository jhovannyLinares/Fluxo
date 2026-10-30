import { useEffect, useRef, useState } from 'react'
import type { BlameLine, FileHistoryEntry } from '@shared/file-history'
import { call } from '../api'
import { commitDate } from '../format'
import { usePrefs } from '../prefs'
import { DiffView } from './DiffView'

/**
 * A1: historial de un archivo («File History» y «File Blame»). Ocupa el lugar del grafo: a la
 * izquierda los commits que tocaron el archivo (siguiendo renombres) y a la derecha el diff de ese commit o el blame
 * del archivo en HEAD. Esc o Cerrar vuelve al grafo. Solo lectura.
 */
export function FileHistoryView({
  repoId,
  path,
  initialMode,
  onGoTo,
  onClose
}: {
  repoId: string
  path: string
  initialMode: 'history' | 'blame'
  /** ir al commit en el grafo (cierra el historial) */
  onGoTo: (hash: string) => void
  onClose: () => void
}) {
  const { t, lang, prefs } = usePrefs()
  const when = (time: number) => commitDate(time, Date.now(), prefs.date, lang)
  const [mode, setMode] = useState(initialMode)
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [blame, setBlame] = useState<BlameLine[] | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const rootRef = useRef<HTMLElement>(null)

  // con el foco en la vista, Esc y ↑ ↓ funcionan sin hacer clic antes; un cuadro después, cuando ya se cerró la
  // caja de búsqueda que la abrió
  useEffect(() => {
    const id = requestAnimationFrame(() => rootRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    let alive = true
    setEntries(null)
    setBlame(null)
    setActive(0)
    setError(null)
    call('file:history', { repoId, path })
      .then((r) => alive && setEntries(r.entries))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [repoId, path])

  useEffect(() => {
    if (mode !== 'blame' || blame) return
    let alive = true
    call('file:blame', { repoId, path })
      .then((r) => alive && setBlame(r.lines))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [mode, blame, repoId, path])

  // la fila elegida siempre a la vista al moverse con el teclado
  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const entry = entries?.[active]
  const cut = path.lastIndexOf('/') + 1

  return (
    <section
      ref={rootRef}
      className="file-history"
      aria-label={t('fileHistory.aria', { path })}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        // ↑ ↓ eligen commit salvo dentro del diff, donde mueven el texto
        else if (
          mode === 'history' &&
          entries?.length &&
          (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
          !(e.target as HTMLElement).closest('.diff-view')
        ) {
          e.preventDefault()
          setActive((a) => Math.max(0, Math.min(entries.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))))
        }
      }}
    >
      <header className="file-history-head">
        <span className="diff-path" title={path}>
          <span className="muted">{path.slice(0, cut)}</span>
          {path.slice(cut)}
        </span>
        <span className="diff-views" role="tablist">
          {(['history', 'blame'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : undefined} onClick={() => setMode(m)}>
              {t(`fileHistory.${m}`)}
            </button>
          ))}
        </span>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('common.close')}
        </button>
      </header>
      {error && <p className="file-history-error">{error}</p>}
      {mode === 'history' ? (
        <div className="file-history-body">
          <ul className="file-history-list" ref={listRef} aria-label={t('fileHistory.commits')}>
            {entries === null && !error && <li className="muted">{t('fileHistory.loading')}</li>}
            {entries?.length === 0 && <li className="muted">{t('fileHistory.empty')}</li>}
            {entries?.map((e, i) => (
              <li key={e.hash}>
                <button type="button" className={i === active ? 'active' : undefined} onClick={() => setActive(i)} onDoubleClick={() => onGoTo(e.hash)}>
                  <span className="file-history-subject">{e.subject}</span>
                  <span className="muted">
                    {e.hash.slice(0, 7)} · {e.author} · {when(e.time)}
                  </span>
                  {e.oldPath && <span className="muted file-history-rename">{t('fileHistory.renamed', { from: e.oldPath })}</span>}
                  {e.path !== path && !e.oldPath && <span className="muted file-history-rename">{e.path}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="file-history-diff">
            {entry && (
              <DiffView
                key={entry.hash}
                repoId={repoId}
                hash={entry.hash}
                file={{ status: entry.status, path: entry.path, oldPath: entry.oldPath, additions: 0, deletions: 0, binary: false }}
                onClose={onClose}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="file-history-blame">
          {blame === null && !error && <p className="muted">{t('fileHistory.loading')}</p>}
          <table>
            <tbody>
              {blame?.map((l, i) => {
                const first = i === 0 || blame[i - 1]!.hash !== l.hash
                return (
                  <tr key={i} className={first ? 'blame-first' : undefined}>
                    <td className="blame-who">
                      {first && (
                        <button type="button" title={`${l.subject}\n${t('fileHistory.goTo')}`} onClick={() => onGoTo(l.hash)}>
                          <span className="sha">{l.hash.slice(0, 7)}</span> {l.author} · {when(l.time)}
                        </button>
                      )}
                    </td>
                    <td className="diff-num">{i + 1}</td>
                    <td className="diff-text">{l.text}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
