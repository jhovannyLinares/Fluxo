import type { MessageKey } from '@shared/i18n'
import type { Res } from '@shared/ipc-contracts'
import { usePrefs } from '../prefs'
import { Modal } from './Modal'

type Env = Res<'env:check'>
type Check = Env['checks'][number]

/** Texto de ayuda de cada fila según su estado. */
function hintKey(c: Check): MessageKey {
  switch (c.id) {
    case 'git':
      return c.status === 'ok' ? 'env.git.ok' : c.value === null ? 'env.git.missing' : 'env.git.old'
    case 'gcm':
      return c.status === 'ok' ? 'env.gcm.ok' : 'env.gcm.warn'
    case 'helper':
      return c.status === 'ok' ? 'env.helper.ok' : 'env.helper.warn'
    case 'proxy':
      return c.value === null ? 'env.proxy.none' : 'env.proxy.set'
    case 'ssl':
      return c.status === 'ok' ? 'env.ssl.ok' : 'env.ssl.info'
  }
}

/** Pantalla de entorno (H05): cada pieza que Fluxo necesita, con su estado y qué hacer. */
export function EnvironmentDialog({
  env,
  checking,
  onRecheck,
  onClose
}: {
  env: Env
  checking: boolean
  onRecheck: () => void
  onClose: () => void
}) {
  const { t } = usePrefs()
  return (
    <Modal title={t('env.title')} onClose={onClose}>
      <p className="muted">{t('env.intro')}</p>
      <ul className="env-list">
        {env.checks.map((c) => (
          <li key={c.id} className={`env-row ${c.status}`}>
            <span className="env-status">{t(`env.status.${c.status}`)}</span>
            <div>
              <strong>{t(`env.${c.id}.label`)}</strong>
              <span className="mono env-value">{c.value ?? t('env.none')}</span>
              <p>{t(hintKey(c), { min: env.minGitVersion })}</p>
              {c.id === 'git' && env.gitPath && <p className="muted mono">{t('env.git.path', { path: env.gitPath })}</p>}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn" data-autofocus onClick={onRecheck} disabled={checking}>
        {checking ? t('env.checking') : t('env.recheck')}
      </button>
    </Modal>
  )
}
