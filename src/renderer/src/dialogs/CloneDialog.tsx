import { useEffect, useState } from 'react'
import { checkCloneUrl, repoNameFromUrl, type CloneProgress } from '@shared/clone'
import { ApiError, call, onAppEvent } from '../api'
import { usePrefs } from '../prefs'
import { Modal } from './Modal'

const LAST_PARENT = 'fluxo.clone.parent'

function readLastParent(): string {
  try {
    return localStorage.getItem(LAST_PARENT) ?? ''
  } catch {
    return ''
  }
}

/** Clonar por HTTPS (H09): URL, carpeta de destino, progreso; al terminar abre el repo. */
export function CloneDialog({
  defaultParent,
  onClose,
  onCloned
}: {
  /** sugerencia si nunca se clonó: la carpeta que contiene el último repo abierto */
  defaultParent: string
  onClose: () => void
  onCloned: (path: string) => void
}) {
  const { t } = usePrefs()
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState(() => readLastParent() || defaultParent)
  // los recientes pueden llegar después de abrir el diálogo
  useEffect(() => {
    if (defaultParent) setParent((p) => p || defaultParent)
  }, [defaultParent])
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<ApiError['info'] | null>(null)

  useEffect(
    () =>
      onAppEvent((ev) => {
        if (ev.type === 'clone:progress') setProgress({ phase: ev.phase, percent: ev.percent })
      }),
    []
  )

  const problem = url.trim() ? checkCloneUrl(url) : null
  const name = problem === null ? repoNameFromUrl(url) : null
  const target = name && parent ? `${parent.replace(/[\\/]+$/, '')}\\${name}` : null

  const pick = async () => {
    const r = await call('app:pickFolder', {})
    if (r.path) setParent(r.path)
  }

  const clone = async () => {
    if (!target) return
    setError(null)
    setRunning(true)
    setProgress(null)
    try {
      const r = await call('repo:clone', { url: url.trim(), parent })
      try {
        localStorage.setItem(LAST_PARENT, parent)
      } catch {
        // sin almacenamiento local solo se pierde la carpeta sugerida
      }
      onCloned(r.path)
    } catch (e) {
      setError(e instanceof ApiError ? e.info : { code: 'INTERNAL', message: String(e) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal title={t('clone.title')} onClose={running ? () => {} : onClose}>
      <label className="field">
        <span>{t('clone.url')}</span>
        <input
          className="input"
          data-autofocus
          type="url"
          spellCheck={false}
          placeholder="https://dev.azure.com/org/proyecto/_git/repo"
          value={url}
          disabled={running}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      {problem && <p className="form-error">{t(`clone.problem.${problem}`)}</p>}
      <div className="field">
        <span>{t('clone.parent')}</span>
        <div className="clone-parent">
          <span className="mono">{parent || t('clone.noParent')}</span>
          <button type="button" className="btn ghost" onClick={() => void pick()} disabled={running}>
            {t('clone.choose')}
          </button>
        </div>
      </div>
      {target && <p className="muted">{t('clone.target', { path: target })}</p>}
      {running && (
        <div className="clone-progress" role="status">
          <progress max={100} value={progress?.percent ?? undefined} />
          <span>{progress ? `${progress.phase} ${progress.percent}%` : t('clone.starting')}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="form-error">
          <strong>{error.message}</strong>
          {error.suggestion && <p>{error.suggestion}</p>}
          {error.gitOutput && <pre>{error.gitOutput}</pre>}
        </div>
      )}
      <button type="button" className="btn" onClick={() => void clone()} disabled={!target || running}>
        {running ? t('clone.running') : t('clone.start')}
      </button>
    </Modal>
  )
}
