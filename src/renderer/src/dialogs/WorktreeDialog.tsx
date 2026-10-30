import { useState } from 'react'
import { ApiError, call } from '../api'
import { usePrefs } from '../prefs'
import { SidePanel, SpField } from './SidePanel'

const ICON = (
  <svg width="20" height="20" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
    <path d="M6 1.5v9M6 4l-3-1.5M6 6l3-1.5M3.5 10.5h5" />
  </svg>
)

/**
 * «Create Worktree» como el panel de GitKraken: referencia que se saca (solo lectura), rama nueva opcional y carpeta de
 * trabajo, que por defecto es `<repo>.worktrees/<nombre>`. Vacía la rama, el worktree usa la rama que ya existe (o queda suelto
 * si se saca un commit).
 */
export function WorktreeDialog({
  repoRoot,
  refName,
  hash,
  onClose,
  onSubmit
}: {
  repoRoot: string
  /** rama que se saca; null = un commit */
  refName: string | null
  hash: string
  onClose: () => void
  onSubmit: (path: string, newBranch: string) => Promise<void>
}) {
  const { t } = usePrefs()
  const what = refName ?? hash.slice(0, 7)
  const [branch, setBranch] = useState('')
  const [dir, setDir] = useState('')
  const [dirTouched, setDirTouched] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<ApiError['info'] | null>(null)

  const name = (branch.trim() || what).replace(/[\\/]+/g, '-')
  const autoDir = `${repoRoot.replace(/[\\/]+$/, '')}.worktrees/${name}`
  const path = dirTouched ? dir : autoDir

  const browse = async () => {
    const r = await call('app:pickFolder', {})
    if (r.path) {
      setDir(`${r.path.replace(/[\\/]+$/, '')}/${name}`)
      setDirTouched(true)
    }
  }

  const create = async () => {
    setError(null)
    setRunning(true)
    try {
      await onSubmit(path.trim(), branch.trim())
    } catch (e) {
      setError(e instanceof ApiError ? e.info : { code: 'INTERNAL', message: String(e) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <SidePanel title={t('worktree.createTitle')} icon={ICON} onClose={running ? () => {} : onClose}>
      <SpField label={t('worktree.ref')}>
        <input readOnly value={what} />
      </SpField>
      <SpField label={t('worktree.newBranch')}>
        <input data-autofocus spellCheck={false} placeholder={refName ?? ''} value={branch} disabled={running} onChange={(e) => setBranch(e.target.value)} />
      </SpField>
      <SpField label={t('worktree.dir')}>
        <input spellCheck={false} value={path} disabled={running} onChange={(e) => (setDir(e.target.value), setDirTouched(true))} />
      </SpField>
      <div className="sp-actions">
        <button type="button" className="sp-btn blue" onClick={() => void browse()} disabled={running}>
          {t('worktree.browse')}
        </button>
        <button type="button" className="sp-btn" onClick={() => void create()} disabled={!path.trim() || running}>
          {running ? t('worktree.creating') : t('worktree.create')}
        </button>
      </div>
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
