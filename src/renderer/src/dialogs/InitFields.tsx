import { GITIGNORE_NAMES, LICENSE_NAMES } from '@shared/init-templates'
import { usePrefs } from '../prefs'
import type { InitAccounts, ProviderId } from './useInitAccounts'

export interface FolderForm {
  parent: string
  branch: string
  gitignore: string
  license: string
}

export interface RemoteForm {
  description: string
  isPrivate: boolean
  cloneAfter: boolean
}

/** Lista desplegable con la primera opción vacía («Select…»). */
function SelectRow({ label, value, names, disabled, className, onChange }: { label: string; value: string; names: readonly string[]; disabled: boolean; className: string; onChange: (v: string) => void }) {
  const { t } = usePrefs()
  return (
    <label className={`gm-row ${className}`}>
      <span className="gm-label">{label}</span>
      <select className="gm-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('init.select')}</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Carpeta, rama, plantilla de .gitignore, licencia y LFS: lo que comparten «Solo local» y «Clone after init». */
export function FolderFields({ folder, fullPath, remote, running, onChange, onBrowse }: { folder: FolderForm; fullPath: string; remote: boolean; running: boolean; onChange: (patch: Partial<FolderForm>) => void; onBrowse: () => void }) {
  const { t } = usePrefs()
  return (
    <>
      <label className="gm-row gm-r5">
        <span className="gm-label">{remote ? t('init.cloneTo') : t('init.parent')}</span>
        <input className="gm-input gm-parent" readOnly value={folder.parent} title={folder.parent} />
        <button type="button" className="gm-btn blue" onClick={onBrowse} disabled={running}>
          {t('init.browse')}
        </button>
      </label>
      <div className="gm-row gm-fullpath">
        <span className="gm-label">{t('init.fullPath')}</span>
        <span className="gm-path">{fullPath}</span>
      </div>
      <label className="gm-row">
        <span className="gm-label">{t('init.branch')}</span>
        <input className="gm-input" spellCheck={false} placeholder="main" value={folder.branch} disabled={running} onChange={(e) => onChange({ branch: e.target.value })} />
      </label>
      <SelectRow label={t('init.gitignore')} value={folder.gitignore} names={GITIGNORE_NAMES} disabled={running} className="gm-select-row" onChange={(gitignore) => onChange({ gitignore })} />
      <SelectRow label={t('init.license')} value={folder.license} names={LICENSE_NAMES} disabled={running} className="gm-license-row" onChange={(license) => onChange({ license })} />
      <label className="gm-row gm-lfs">
        <span className="gm-label">{t('init.lfs')}</span>
        <input type="checkbox" disabled title={t('toolbar.soon', { action: 'LFS' })} />
      </label>
    </>
  )
}


/** Cuenta (y, en Azure, proyecto): lo primero que pide el formulario de un proveedor. */
export function AccountFields({ provider, acc, running }: { provider: ProviderId; acc: InitAccounts; running: boolean }) {
  const { t } = usePrefs()
  return (
    <>
      <label className="gm-row gm-r5">
        <span className="gm-label">{t('init.account')}</span>
        <select className="gm-input" value={acc.account} disabled={running || !acc.accounts} onChange={(e) => acc.setAccount(e.target.value)}>
          {acc.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.text}
            </option>
          ))}
        </select>
      </label>
      {provider === 'azure' && (
        <label className="gm-row gm-r5">
          <span className="gm-label">{t('init.project')}</span>
          <select className="gm-input" value={acc.project} disabled={running || acc.projects.length === 0} onChange={(e) => acc.setProject(e.target.value)}>
            {acc.projects.length === 0 && <option value="">{t('init.select')}</option>}
            {acc.projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}

/** Descripción y acceso (solo GitHub) y «Clone after init»: van después del nombre. */
export function RemoteOptions({ provider, form, running, onChange }: { provider: ProviderId; form: RemoteForm; running: boolean; onChange: (patch: Partial<RemoteForm>) => void }) {
  const { t } = usePrefs()
  return (
    <>
      {provider === 'github' && (
        <>
          <label className="gm-row gm-r5">
            <span className="gm-label">{t('init.description')}</span>
            <input className="gm-input" maxLength={350} value={form.description} disabled={running} onChange={(e) => onChange({ description: e.target.value })} />
          </label>
          <label className="gm-row gm-r5">
            <span className="gm-label">{t('init.access')}</span>
            <select className="gm-input" value={form.isPrivate ? 'private' : 'public'} disabled={running} onChange={(e) => onChange({ isPrivate: e.target.value === 'private' })}>
              <option value="public">{t('init.public')}</option>
              <option value="private">{t('init.private')}</option>
            </select>
          </label>
        </>
      )}
      <label className="gm-row gm-lfs">
        <span className="gm-label">{t('init.cloneAfter')}</span>
        <input type="checkbox" checked={form.cloneAfter} disabled={running} onChange={(e) => onChange({ cloneAfter: e.target.checked })} />
      </label>
    </>
  )
}
