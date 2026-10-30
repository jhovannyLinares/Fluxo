import { useEffect, useRef, useState } from 'react'
import { checkRepoName } from '@shared/init-templates'
import { type ApiError, call, toAppError } from '../api'
import { usePrefs } from '../prefs'
import { AccountFields, FolderFields, RemoteOptions, type FolderForm, type RemoteForm } from './InitFields'
import { canCreateRemote, PROVIDERS, useInitAccounts, type ProviderId } from './useInitAccounts'

const LAST_PARENT = 'fluxo.init.parent'

function readLastParent(): string {
  try {
    return localStorage.getItem(LAST_PARENT) ?? ''
  } catch {
    return ''
  }
}

function rememberParent(parent: string): void {
  try {
    localStorage.setItem(LAST_PARENT, parent)
  } catch {
    // sin almacenamiento local solo se pierde la carpeta sugerida
  }
}

const TAB_ICON = (
  <svg width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
    <path d="M2.5 3h7v4.5h-7zM1 9.5h10" />
  </svg>
)

function ErrorBox({ error }: { error: ApiError['info'] }) {
  return (
    <div role="alert" className="form-error gm-error">
      <strong>{error.message}</strong>
      {error.suggestion && <p>{error.suggestion}</p>}
      {error.gitOutput && <pre>{error.gitOutput}</pre>}
    </div>
  )
}

/**
 * «Initialize a Repository» con la disposición de GitKraken: título, columna de orígenes y el formulario. «Local Only»:
 * nombre, carpeta, rama, plantilla de .gitignore y licencia. GitHub.com y Azure DevOps: cuenta de Git Credential Manager,
 * proyecto (Azure), descripción y acceso (GitHub) y «Clone after init»; los demás proveedores muestran «not connected»
 * como GitKraken sin cuenta. Al crear abre el repo.
 */
export function InitDialog({ defaultParent, onClose, onCreated }: { defaultParent: string; onClose: () => void; onCreated: (path: string) => void }) {
  const { t } = usePrefs()
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  const [folder, setFolder] = useState<FolderForm>(() => ({ parent: readLastParent() || defaultParent, branch: '', gitignore: '', license: '' }))
  const [remoteForm, setRemoteForm] = useState<RemoteForm>({ description: '', isPrivate: false, cloneAfter: true })
  const [provider, setProvider] = useState<ProviderId>('local')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<ApiError['info'] | null>(null)
  const [madeUrl, setMadeUrl] = useState<string | null>(null)
  const acc = useInitAccounts(provider, setError)

  const remote = canCreateRemote(provider)
  const label = PROVIDERS.find((p) => p.id === provider)?.label ?? ''
  const needsFolder = !remote || remoteForm.cloneAfter
  // sin cuentas leídas todavía no se sabe si hay conexión: se espera antes de mostrar «not connected»
  const accountsKnown = !!acc.accounts
  const lacksConnection = !remote || (accountsKnown && !acc.connected)
  const notConnected = provider !== 'local' && lacksConnection
  const problem = name.trim() ? checkRepoName(name) : null
  const projectReady = provider !== 'azure' || !!acc.project
  const accountReady = !remote || (!!acc.account && projectReady)
  const folderReady = !needsFolder || !!folder.parent
  const fullPath = `${folder.parent.replace(/[\\/]+$/, '')}\\${name.trim()}`
  const canCreate = !!name.trim() && !problem && accountReady && folderReady && !running

  useEffect(() => {
    if (defaultParent) setFolder((f) => ({ ...f, parent: f.parent || defaultParent }))
  }, [defaultParent])
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
  }, [])

  const chooseProvider = (next: ProviderId) => {
    setProvider(next)
    setError(null)
    setMadeUrl(null)
  }
  const browse = async () => {
    const r = await call('app:pickFolder', {})
    if (r.path) setFolder((f) => ({ ...f, parent: r.path! }))
  }
  const connect = async () => {
    setError(null)
    setRunning(true)
    try {
      await call('accounts:githubLogin', {})
      acc.setAccounts(await call('accounts:list', {}))
    } catch (e) {
      setError(toAppError(e))
    } finally {
      setRunning(false)
    }
  }

  const templates = () => ({
    ...(folder.branch.trim() ? { branch: folder.branch.trim() } : {}),
    ...(folder.gitignore ? { gitignore: folder.gitignore } : {}),
    ...(folder.license ? { license: folder.license } : {})
  })
  /** Carpeta local creada, o null si solo se creó el repo en el servidor. */
  const submit = async (): Promise<string | null> => {
    if (!remote) return (await call('repo:init', { name: name.trim(), parent: folder.parent, ...templates() })).path
    const r = await call('repo:createRemote', {
      provider: provider === 'azure' ? 'azure' : 'github',
      account: provider === 'azure' ? acc.azureUser : acc.account,
      ...(provider === 'azure' ? { org: acc.azureOrg, project: acc.project } : { description: remoteForm.description.trim(), private: remoteForm.isPrivate }),
      name: name.trim(),
      ...(remoteForm.cloneAfter ? { parent: folder.parent, ...templates() } : {})
    })
    if (!r.path) setMadeUrl(r.webUrl)
    return r.path
  }
  const create = async () => {
    setError(null)
    setRunning(true)
    try {
      const path = await submit()
      if (needsFolder) rememberParent(folder.parent)
      if (path) onCreated(path)
    } catch (e) {
      setError(toAppError(e))
    } finally {
      setRunning(false)
    }
  }

  const close = running ? () => {} : onClose
  const createLabel = !remote ? t('init.create') : remoteForm.cloneAfter ? t('init.createRemoteClone') : t('init.createRemote')
  return (
    <dialog ref={ref} className="gk-modal init-modal" aria-label={t('init.title')} onClose={close} onClick={(e) => e.target === ref.current && close()}>
      <header className="gm-head">
        <h4>{t('init.title')}</h4>
        <button type="button" className="gm-close" aria-label={t('common.close')} title={t('common.close')} onClick={close}>
          ✕
        </button>
      </header>
      <div className="gm-body">
        <nav className="gm-tabs">
          {[{ id: 'local' as const, label: t('init.local') }, ...PROVIDERS].map((p) => (
            <button key={p.id} type="button" className={`gm-tab${provider === p.id ? ' on' : ''}`} disabled={running} onClick={() => chooseProvider(p.id)}>
              {TAB_ICON}
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
        <div className="gm-content">
          <div className="gm-heading">{t('init.heading')}</div>
          {notConnected ? (
            <div className="gm-notconn">
              <p>{t('init.notConnected', { provider: label })}</p>
              <button type="button" className="gm-btn blue" disabled={running || provider !== 'github'} title={provider === 'github' ? undefined : t('toolbar.soon', { action: label })} onClick={() => void connect()}>
                {t('init.connect', { provider: label })}
              </button>
              {provider === 'azure' && <p className="gm-hint">{t('init.azureLogin')}</p>}
              {error && <ErrorBox error={error} />}
            </div>
          ) : (
            <>
              {remote && <AccountFields provider={provider} acc={acc} running={running} />}
              <label className="gm-row gm-r5">
                <span className="gm-label">{t('init.name')}</span>
                <input className="gm-input" data-autofocus spellCheck={false} value={name} disabled={running} onChange={(e) => setName(e.target.value)} />
              </label>
              {problem && <p className="form-error gm-problem">{t(`init.problem.${problem}`)}</p>}
              {remote && <RemoteOptions provider={provider} form={remoteForm} running={running} onChange={(patch) => setRemoteForm((f) => ({ ...f, ...patch }))} />}
              {needsFolder && <FolderFields folder={folder} fullPath={fullPath} remote={remote} running={running} onChange={(patch) => setFolder((f) => ({ ...f, ...patch }))} onBrowse={() => void browse()} />}
              {madeUrl && (
                <p role="status" className="gm-hint">
                  {t('init.madeRemote', { url: madeUrl })}
                </p>
              )}
              {error && <ErrorBox error={error} />}
              <div className="gm-actions">
                <button type="button" className="gm-btn green" onClick={() => void create()} disabled={!canCreate}>
                  {running ? t('init.running') : createLabel}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </dialog>
  )
}
