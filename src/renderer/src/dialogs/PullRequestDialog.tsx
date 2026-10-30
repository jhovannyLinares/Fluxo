import { useCallback, useEffect, useState } from 'react'
import type { PrPrepare } from '@shared/pr-create'
import { type ApiError, call, toAppError } from '../api'
import { usePrefs } from '../prefs'
import { SidePanel, SpField } from './SidePanel'

const ICON = (
  <svg width="20" height="20" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
    <circle cx="3" cy="2.5" r="1" />
    <circle cx="3" cy="9.5" r="1" />
    <circle cx="9" cy="9.5" r="1" />
    <path d="M3 3.5v5M9 8.5V5a1.5 1.5 0 0 0-1.5-1.5H6M7 2.5l-1 1 1 1" />
  </svg>
)

/** Casillas de una lista larga (revisores, asignados, etiquetas) dentro de una caja con scroll. */
function Picks({ label, items, chosen, onChange, disabled }: { label: string; items: string[]; chosen: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const { t } = usePrefs()
  return (
    <fieldset className="pr-picks" disabled={disabled || items.length === 0}>
      <legend>{label}</legend>
      {items.length === 0 ? (
        <span className="pr-none">{t('pr.none')}</span>
      ) : (
        <div className="pr-pick-list">
          {items.map((it) => (
            <label key={it}>
              <input type="checkbox" checked={chosen.includes(it)} onChange={(e) => onChange(e.target.checked ? [...chosen, it] : chosen.filter((x) => x !== it))} />
              <span>{it}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

/**
 * «Start a pull request»: panel lateral con la rama de origen y la destino ya elegidas según el menú desde el que se
 * abrió, título, descripción (con la plantilla del repo), revisores, asignados, etiquetas y «Submit as draft».
 * Avisa si faltan commits, si las ramas chocan o si la de origen no está subida; esa se sube desde aquí.
 */
export function PullRequestDialog({
  repoId,
  head,
  base,
  onClose,
  onCreated
}: {
  repoId: string
  /** rama local de origen */
  head: string
  /** rama destino pedida (sin el nombre del remoto); sin ella, la principal del repo */
  base: string | undefined
  onClose: () => void
  onCreated: (r: { number: number; url: string; warning: string | null }) => void
}) {
  const { t } = usePrefs()
  const [prep, setPrep] = useState<PrPrepare | null>(null)
  const [target, setTarget] = useState('')
  const [pushed, setPushed] = useState(false)
  const [title, setTitle] = useState(head)
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [reviewers, setReviewers] = useState<string[]>([])
  const [assignees, setAssignees] = useState<string[]>([])
  const [labels, setLabels] = useState<string[]>([])
  const [busy, setBusy] = useState<'load' | 'push' | 'create' | null>('load')
  const [error, setError] = useState<ApiError['info'] | null>(null)
  const fail = useCallback((e: unknown) => setError(toAppError(e)), [])

  const load = useCallback(
    (wantedBase: string | undefined) => {
      setBusy('load')
      setError(null)
      return call('pr:prepare', { repoId, head, ...(wantedBase ? { base: wantedBase } : {}) })
        .then((p) => {
          setPrep(p)
          setTarget(p.base)
          // con una sola plantilla se usa de entrada; con varias se elige en la lista
          if (p.templates.length === 1) setBody((current) => current || p.templates[0]!.body)
        })
        .catch(fail)
        .finally(() => setBusy(null))
    },
    [repoId, head, fail]
  )
  useEffect(() => {
    void load(base)
  }, [load, base])

  const published = !!prep && (prep.head !== null || pushed)
  const headRemote = prep ? (prep.head ?? prep.localHead) : head
  const noCommits = !!prep?.diff && prep.diff.commits === 0
  const ready = !!prep && published && !!title.trim() && !!target && target !== headRemote && !noCommits && !busy

  const publish = async () => {
    if (!prep) return
    setBusy('push')
    setError(null)
    try {
      await call('repo:pushBranch', { repoId, branch: prep.localHead, to: { remote: prep.remote, branch: prep.localHead } })
      setPushed(true)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }
  const create = async () => {
    if (!prep || !ready) return
    setBusy('create')
    setError(null)
    try {
      const r = await call('pr:create', { repoId, remote: prep.remote, base: target, head: headRemote, title: title.trim(), body, draft, reviewers, assignees, labels })
      onCreated(r)
    } catch (e) {
      fail(e)
      setBusy(null)
    }
  }

  return (
    <SidePanel wide title={t('pr.title')} icon={ICON} onClose={busy === 'create' || busy === 'push' ? () => {} : onClose}>
      {!prep && busy === 'load' && <p className="pr-note">{t('pr.loading')}</p>}
      {prep && (
        <>
          <SpField label={t('pr.source')}>
            <input readOnly value={`${prep.remote}/${headRemote}`} aria-label={t('pr.source')} />
          </SpField>
          {!published && (
            <div role="status" className="pr-warn">
              <p>{t('pr.notPushed', { branch: prep.localHead, remote: prep.remote })}</p>
              <button type="button" className="sp-btn blue" disabled={busy !== null} onClick={() => void publish()}>
                {busy === 'push' ? t('pr.pushing') : t('pr.pushAndContinue')}
              </button>
            </div>
          )}
          <label className="sp-group">
            <span className="sp-label">{t('pr.target')}</span>
            <span className="sp-input">
              <select
                value={target}
                disabled={busy !== null}
                aria-label={t('pr.target')}
                onChange={(e) => void load(e.target.value)}
              >
                {[...new Set([prep.base, ...prep.branches])].map((b) => (
                  <option key={b} value={b}>
                    {prep.remote}/{b}
                  </option>
                ))}
              </select>
            </span>
          </label>
          {prep.diff && (
            <p className={`pr-note${prep.diff.conflicts || noCommits ? ' bad' : ''}`} role="status">
              {noCommits ? t('pr.noCommits') : t('pr.diff', { commits: prep.diff.commits, files: prep.diff.files })}
              {prep.diff.conflicts && !noCommits && <strong> {t('pr.conflicts')}</strong>}
            </p>
          )}
          {prep.approvals !== null && <p className="pr-note">{t('pr.approvals', { n: prep.approvals })}</p>}
          <SpField label={t('pr.titleField')}>
            <input data-autofocus spellCheck={false} value={title} disabled={busy !== null} onChange={(e) => setTitle(e.target.value)} />
          </SpField>
          {prep.templates.length > 1 && (
            <label className="sp-group">
              <span className="sp-label">{t('pr.template')}</span>
              <span className="sp-input">
                <select aria-label={t('pr.template')} defaultValue="" disabled={busy !== null} onChange={(e) => e.target.value && setBody(prep.templates.find((x) => x.name === e.target.value)?.body ?? '')}>
                  <option value="">{t('init.select')}</option>
                  {prep.templates.map((x) => (
                    <option key={x.name} value={x.name}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}
          <label className="sp-group">
            <span className="sp-label">{t('pr.description')}</span>
            <textarea className="pr-body" aria-label={t('pr.description')} value={body} disabled={busy !== null} onChange={(e) => setBody(e.target.value)} />
          </label>
          <Picks label={t('pr.reviewers')} items={prep.people} chosen={reviewers} onChange={setReviewers} disabled={busy !== null} />
          <Picks label={t('pr.assignees')} items={prep.people} chosen={assignees} onChange={setAssignees} disabled={busy !== null} />
          <Picks label={t('pr.labels')} items={prep.labels} chosen={labels} onChange={setLabels} disabled={busy !== null} />
          <label className="pr-draft">
            <input type="checkbox" checked={draft} disabled={busy !== null} onChange={(e) => setDraft(e.target.checked)} />
            <span>{t('pr.draft')}</span>
          </label>
        </>
      )}
      {error && (
        <div role="alert" className="form-error sp-error">
          <strong>{error.message}</strong>
          {error.suggestion && <p>{error.suggestion}</p>}
          {error.gitOutput && <pre>{error.gitOutput}</pre>}
        </div>
      )}
      {prep && (
        <div className="sp-actions">
          <button type="button" className="sp-btn" disabled={!ready} onClick={() => void create()}>
            {busy === 'create' ? t('pr.creating') : t('pr.create')}
          </button>
        </div>
      )}
    </SidePanel>
  )
}
