import { useCallback, useEffect, useState } from 'react'
import type { AccountsInfo } from '@shared/accounts'
import { ApiError, call } from '../api'
import { usePrefs } from '../prefs'

/**
 * A12: Preferencias ▸ Cuentas, capa visual sobre Git Credential Manager (decisión de Gio): lista las cuentas que
 * guarda GCM, «Iniciar sesión con GitHub» abre su navegador, «Cerrar sesión» y «Probar» con el remoto del repo
 * abierto (si falta la credencial, GCM la pide; así se inicia sesión en Azure DevOps). Fluxo no guarda credenciales.
 */
export function AccountsSection({ repoId, remote }: { repoId: string | null; remote: string | null }) {
  const { t } = usePrefs()
  const [info, setInfo] = useState<AccountsInfo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    call('accounts:list', {}).then(setInfo, () => setInfo({ gcm: false, version: null, github: [], azure: [] }))
  }, [])
  useEffect(load, [load])

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    setMsg(null)
    try {
      setMsg({ ok: true, text: await fn() })
      load()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? `${e.info.message} ${e.info.suggestion ?? ''}` : String(e) })
    } finally {
      setBusy(null)
    }
  }

  if (!info) return <p className="muted">{t('fileHistory.loading')}</p>
  if (!info.gcm) return <p className="form-error">{t('accounts.noGcm')}</p>

  return (
    <div className="accounts">
      <p className="pref-help">{t('accounts.help', { version: info.version ?? '' })}</p>

      <h2>GitHub</h2>
      {info.github.length === 0 && <p className="muted">{t('accounts.none')}</p>}
      <ul className="accounts-list">
        {info.github.map((a) => (
          <li key={a}>
            <span className="accounts-dot" aria-hidden="true" />
            <strong>{a}</strong>
            <button
              type="button"
              className="btn ghost"
              disabled={!!busy}
              onClick={() =>
                void run(`out:${a}`, async () => {
                  await call('accounts:githubLogout', { account: a })
                  return t('accounts.loggedOut', { account: a })
                })
              }
            >
              {t('accounts.logout')}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn"
        disabled={!!busy}
        onClick={() =>
          void run('gh', async () => {
            await call('accounts:githubLogin', {})
            return t('accounts.loggedIn')
          })
        }
      >
        {busy === 'gh' ? t('accounts.waiting') : t('accounts.loginGithub')}
      </button>

      <h2>Azure DevOps</h2>
      {info.azure.length === 0 && <p className="muted">{t('accounts.azureNone')}</p>}
      <ul className="accounts-list">
        {info.azure.map((b) => (
          <li key={`${b.org}:${b.user}`}>
            <span className="accounts-dot" aria-hidden="true" />
            <strong>{b.org}</strong> <span className="muted">{b.user}</span>
          </li>
        ))}
      </ul>

      <h2>{t('accounts.test')}</h2>
      <p className="pref-help">{repoId && remote ? t('accounts.testHelp', { remote }) : t('accounts.testNeedRepo')}</p>
      <button
        type="button"
        className="btn"
        disabled={!!busy || !repoId || !remote}
        onClick={() =>
          void run('test', async () => {
            const r = await call('accounts:test', { repoId: repoId!, remote: remote! })
            return t('accounts.testOk', { remote: remote!, ms: r.ms })
          })
        }
      >
        {busy === 'test' ? t('accounts.waiting') : t('accounts.testButton', { remote: remote ?? 'origin' })}
      </button>

      {msg && (
        <p role="status" className={msg.ok ? 'accounts-ok' : 'form-error'}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
