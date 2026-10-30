import { useState } from 'react'
import type { Submodule } from '@shared/refs'
import { ApiError, call } from '../api'
import { usePrefs } from '../prefs'
import { SidePanel, SpField } from './SidePanel'

const ICON = (
  <svg width="20" height="20" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
    <path d="M2 3.5h8v2H2zM2 6.5h8v2H2z" />
  </svg>
)

/** «Add Submodule»: panel lateral con URL remota y carpeta (sin autocompletar, como GitKraken). */
export function SubmoduleDialog({ repoId, editing, onClose, onAdded }: { repoId: string; editing?: Submodule; onClose: () => void; onAdded: () => void }) {
  const { t } = usePrefs()
  const [url, setUrl] = useState(editing?.url ?? '')
  const [path, setPath] = useState(editing?.path ?? '')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<ApiError['info'] | null>(null)

  const add = async () => {
    setError(null)
    setRunning(true)
    try {
      if (editing) await call('submodule:edit', { repoId, path: editing.path, url: url.trim(), newPath: path.trim() })
      else await call('submodule:add', { repoId, url: url.trim(), path: path.trim() })
      onAdded()
    } catch (e) {
      setError(e instanceof ApiError ? e.info : { code: 'INTERNAL', message: String(e) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <SidePanel title={editing ? t('submodule.editTitle') : t('submodule.add')} icon={ICON} onClose={running ? () => {} : onClose}>
      <SpField label={t('submodule.url')}>
        <input data-autofocus spellCheck={false} value={url} disabled={running} onChange={(e) => setUrl(e.target.value)} />
      </SpField>
      <SpField label={editing ? t('submodule.pathOnly') : t('submodule.path')}>
        <input spellCheck={false} value={path} disabled={running} onChange={(e) => setPath(e.target.value)} />
      </SpField>
      <button type="button" className="sp-btn" onClick={() => void add()} disabled={!url.trim() || !path.trim() || running}>
        {running ? t(editing ? 'submodule.editing' : 'submodule.adding') : t(editing ? 'submodule.editOk' : 'submodule.add')}
      </button>
      {editing && (
        <div className="sp-info">
          <p>{t(`submodule.state.${editing.state}` as const)}</p>
          <p className="muted">
            {t('submodule.checkedOut')}: <span className="mono">{editing.hash}</span>
            {editing.date && ` (${new Date(editing.date).toLocaleString()})`}
          </p>
        </div>
      )}
      {error && (
        <div role="alert" className="form-error sp-error">
          <strong>{error.message}</strong>
          {error.suggestion && <p>{error.suggestion}</p>}
          {error.gitOutput && <pre>{error.gitOutput}</pre>}
        </div>
      )}
    </SidePanel>
  )
}
