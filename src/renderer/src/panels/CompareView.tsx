import { useEffect, useRef, useState } from 'react'
import type { FileChange } from '@shared/commit'
import { call } from '../api'
import { usePrefs } from '../prefs'
import { STATUS_MARK } from './CommitDetailView'
import { DiffView } from './DiffView'

/**
 * B2: un commit comparado con el directorio de trabajo («Comparar con el directorio de trabajo» del menú del
 * commit). Misma forma que el historial de un archivo (A1): ocupa el lugar del grafo, archivos a la izquierda y el
 * diff a la derecha. Esc o Cerrar vuelve al grafo. Solo lectura.
 */
export function CompareView({
  repoId,
  hash,
  to,
  title,
  onClose
}: {
  repoId: string
  hash: string
  /** B3: comparar contra este commit en lugar del directorio de trabajo */
  to?: string
  title: string
  onClose: () => void
}) {
  const { t } = usePrefs()
  const [files, setFiles] = useState<FileChange[] | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => rootRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    let alive = true
    call('commit:compare', { repoId, hash, to })
      .then((r) => alive && setFiles(r.files))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [repoId, hash, to])

  const file = files?.[active]

  return (
    <section
      ref={rootRef}
      className="file-history"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        else if (files?.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !(e.target as HTMLElement).closest('.diff-view')) {
          e.preventDefault()
          setActive((a) => Math.max(0, Math.min(files.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))))
        }
      }}
    >
      <header className="file-history-head">
        <span className="diff-path">{title}</span>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('common.close')}
        </button>
      </header>
      {error && <p className="file-history-error">{error}</p>}
      <div className="file-history-body">
        <ul className="file-history-list" aria-label={t('compare.files')}>
          {files === null && !error && <li className="muted">{t('fileHistory.loading')}</li>}
          {files?.length === 0 && <li className="muted">{t(to ? 'compare.sameRange' : 'compare.same')}</li>}
          {files?.map((f, i) => (
            <li key={f.path}>
              <button type="button" className={i === active ? 'active' : undefined} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path} onClick={() => setActive(i)}>
                <span className="file-history-subject">
                  <span className="muted">{STATUS_MARK[f.status]}</span> {f.path}
                </span>
                <span className="muted">{f.binary ? t('file.binary') : `+${f.additions} −${f.deletions}`}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="file-history-diff">
          {file && <DiffView key={file.path} repoId={repoId} hash={hash} file={file} againstWorktree to={to} onClose={onClose} />}
        </div>
      </div>
    </section>
  )
}
