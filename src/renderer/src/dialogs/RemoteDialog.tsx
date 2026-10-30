import { useState } from 'react'
import { usePrefs } from '../prefs'
import { SidePanel, SpField } from './SidePanel'

export interface RemoteForm {
  /** nombre actual al editar; null = agregar uno nuevo */
  editing: string | null
  name: string
  pullUrl: string
  pushUrl: string
}

const PROVIDERS = ['GitHub', 'GitHub Enterprise Server', 'GitLab', 'Bitbucket', 'Azure DevOps'] as const
const CLOUD = (
  <svg width="20" height="20" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
    <path d="M3.5 9h5.2a2.3 2.3 0 0 0 .3-4.6A3 3 0 0 0 3.3 5 2 2 0 0 0 3.5 9z" />
  </svg>
)

/**
 * «Add Remote» / «Edit remote»: panel lateral con nombre, URL de pull y URL de push (opcional), como GitKraken.
 * Las pestañas de proveedor se muestran en su lugar pero no están disponibles: se pega la URL.
 */
export function RemoteDialog(p: { form: RemoteForm; onSave: (f: RemoteForm) => void; onClose: () => void }) {
  const { t } = usePrefs()
  const [f, setF] = useState(p.form)
  const ok = f.name.trim().length > 0 && f.pullUrl.trim().length > 0
  const submit = () => ok && p.onSave({ ...f, name: f.name.trim(), pullUrl: f.pullUrl.trim(), pushUrl: f.pushUrl.trim() })
  const field = (label: string, key: 'name' | 'pullUrl' | 'pushUrl', focus = false) => (
    <SpField label={label}>
      <input
        type="text"
        data-autofocus={focus ? true : undefined}
        spellCheck={false}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
      />
    </SpField>
  )
  return (
    <SidePanel wide title={p.form.editing ? t('remote.editTitle') : t('remote.addTitle')} icon={CLOUD} onClose={p.onClose}>
      <div className="sp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" className="sp-tab on">
          <span className="sp-tab-ico" aria-hidden="true">
            ◍
          </span>
          <span>URL</span>
        </button>
        {PROVIDERS.map((n) => (
          <button key={n} type="button" role="tab" aria-selected="false" className="sp-tab" disabled title={t('toolbar.soon', { action: n })}>
            <span className="sp-tab-ico" aria-hidden="true">
              ◍
            </span>
            <span>{n}</span>
          </button>
        ))}
      </div>
      {field(t('remote.name'), 'name', true)}
      {field(t('remote.pullUrl'), 'pullUrl')}
      {field(t('remote.pushUrl'), 'pushUrl')}
      <button type="button" className="sp-btn block" disabled={!ok} onClick={submit}>
        {p.form.editing ? t('remote.editOk') : t('remote.addOk')}
      </button>
    </SidePanel>
  )
}
