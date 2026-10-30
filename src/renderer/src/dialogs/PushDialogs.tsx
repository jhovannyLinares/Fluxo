import { useState } from 'react'
import type { PushResult, PushTarget } from '@shared/push'
import { usePrefs } from '../prefs'
import { Modal } from './Modal'

type Rejected = Extract<PushResult, { status: 'rejected' }>

/** Diálogos de Push, como GitKraken: publicar una rama sin upstream, push rechazado y confirmar el force push. */
export type PushDialog = { kind: 'publish'; target: PushTarget } | { kind: 'rejected'; r: Rejected } | { kind: 'force'; r: Rejected }

export function PushDialogs({
  dlg,
  busy,
  onPublish,
  onPull,
  onForceAsk,
  onForce,
  onClose
}: {
  dlg: PushDialog
  busy: boolean
  onPublish: (remote: string, branch: string) => void
  onPull: () => void
  onForceAsk: () => void
  onForce: (expected: string) => void
  onClose: () => void
}) {
  if (dlg.kind === 'publish') return <Publish target={dlg.target} busy={busy} onPublish={onPublish} onClose={onClose} />
  if (dlg.kind === 'rejected') return <RejectedDialog r={dlg.r} onPull={onPull} onForceAsk={onForceAsk} onClose={onClose} />
  return <ForceDialog r={dlg.r} busy={busy} onForce={onForce} onClose={onClose} />
}

/** 1 · La rama no existe en el remoto: a qué remoto y rama sube (queda como upstream). */
function Publish({ target, busy, onPublish, onClose }: { target: PushTarget; busy: boolean; onPublish: (remote: string, branch: string) => void; onClose: () => void }) {
  const { t } = usePrefs()
  const [remote, setRemote] = useState(target.remotes.includes('origin') ? 'origin' : (target.remotes[0] ?? ''))
  const [branch, setBranch] = useState(target.branch ?? '')
  const ok = !!remote && /^(?!-)[^\s~^:?*[\\]+$/.test(branch)
  return (
    <Modal title={t('push.publishTitle', { branch: target.branch ?? '' })} onClose={busy ? () => {} : onClose}>
      {target.remotes.length === 0 ? (
        <p className="form-error">{t('push.noRemotes')}</p>
      ) : (
        <>
          <p>{t('push.publishText')}</p>
          <div className="push-target">
            <label className="field">
              <span>{t('push.remote')}</span>
              <select className="input" value={remote} disabled={busy} onChange={(e) => setRemote(e.target.value)}>
                {target.remotes.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('push.remoteBranch')}</span>
              <input className="input mono" data-autofocus spellCheck={false} value={branch} disabled={busy} onChange={(e) => setBranch(e.target.value)} />
            </label>
          </div>
          <p className="hint">{t('push.publishNote', { target: `${remote}/${branch}` })}</p>
        </>
      )}
      <div className="push-actions">
        <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
          {t('push.cancel')}
        </button>
        <button type="button" className="btn primary" onClick={() => onPublish(remote, branch.trim())} disabled={!ok || busy}>
          {busy ? t('push.running') : 'Push'}
        </button>
      </div>
    </Modal>
  )
}

/** 2 · El remoto tiene commits que la rama no: Pull como salida principal, o Force Push (con confirmación). */
function RejectedDialog({ r, onPull, onForceAsk, onClose }: { r: Rejected; onPull: () => void; onForceAsk: () => void; onClose: () => void }) {
  const { t } = usePrefs()
  const n = r.lost.length
  return (
    <Modal title={t('push.rejectedTitle')} onClose={onClose}>
      <div className="push-warn">
        <strong>{n === 1 ? t('push.rejectedOne', { target: r.target }) : t('push.rejectedMany', { target: r.target, n })}</strong>
        <p>{t('push.rejectedHint')}</p>
      </div>
      <details className="hint">
        <summary>{t('push.gitOutput')}</summary>
        <pre className="mono">{r.gitOutput}</pre>
      </details>
      <div className="push-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('push.cancel')}
        </button>
        <button type="button" className="btn danger" onClick={onForceAsk}>
          Force Push…
        </button>
        <button type="button" className="btn primary" data-autofocus onClick={onPull}>
          Pull (fast-forward if possible)
        </button>
      </div>
    </Modal>
  )
}

/** 3 · Confirmar el force push: qué commits del remoto se descartan; --force-with-lease con el hash que se ve aquí. */
function ForceDialog({ r, busy, onForce, onClose }: { r: Rejected; busy: boolean; onForce: (expected: string) => void; onClose: () => void }) {
  const { t } = usePrefs()
  const n = r.lost.length
  return (
    <Modal title={t('push.forceTitle')} onClose={busy ? () => {} : onClose}>
      <p>
        {t('push.forceText', { target: r.target })} <strong>{n === 1 ? t('push.forceLostOne') : t('push.forceLostMany', { n })}</strong>
      </p>
      <ul className="push-lost mono">
        {r.lost.map((c) => (
          <li key={c.hash}>
            {c.hash} {c.subject} <span className="muted">({c.author}, {c.when})</span>
          </li>
        ))}
      </ul>
      <p className="hint">{t('push.forceLease')}</p>
      <div className="push-actions">
        <button type="button" className="btn ghost" data-autofocus onClick={onClose} disabled={busy}>
          {t('push.cancel')}
        </button>
        <button type="button" className="btn danger solid" onClick={() => onForce(r.expected)} disabled={busy}>
          {busy ? t('push.running') : t('push.forceGo')}
        </button>
      </div>
    </Modal>
  )
}
