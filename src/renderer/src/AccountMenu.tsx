import { useEffect, useRef, useState } from 'react'
import type { AccountAccess, RepoAccount } from '@shared/accounts'
import { usePrefs } from './prefs'

/** Iniciales del avatar: las dos primeras partes del nombre (ext-jlinaresf-cti → EJ). */
export function initials(name: string): string {
  const parts = name.split(/[-_.]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase()
}

/** Color estable por cuenta, para distinguirlas de un vistazo. */
const COLORS = ['#2d6a8f', '#7a4fa0', '#3f8f6a', '#a0563b', '#5a6aa8', '#8f7a2d']
const colorOf = (name: string) => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]!

function Avatar({ name, warn, small }: { name: string | null; warn?: boolean; small?: boolean }) {
  return (
    <span className={`avatar${small ? ' small' : ''}`} style={{ background: name ? colorOf(name) : undefined }} aria-hidden>
      {name ? initials(name) : '?'}
      {warn && <span className="avatar-warn" />}
    </span>
  )
}

/**
 * Avatar arriba a la derecha, como el perfil de GitKraken, pero por repo: muestra la cuenta de GitHub con que trabaja la
 * pestaña activa y deja elegir otra de las que guarda Git Credential Manager (queda en el .git/config de ese repo).
 */
export function AccountMenu(p: {
  account: RepoAccount
  access: Record<string, AccountAccess> | null
  /** «Elegir cuenta…» del aviso de error: abre este menú */
  openAt: number
  onOpen: () => void
  onPick: (account: string | null) => void
  onLogin: () => void
  onPrefs: () => void
}) {
  const { t } = usePrefs()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { current, accounts } = p.account
  // sin cuenta fijada y GCM con varias: puede tocar la equivocada
  const warn = !current && accounts.length > 1
  const { openAt, onOpen } = p
  useEffect(() => {
    if (!openAt) return
    onOpen()
    setOpen(true)
  }, [openAt, onOpen])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const state = (a: string) => {
    const s = p.access?.[a]
    if (!s) return <small className="muted">{t('account.checking')}</small>
    return <small className={`acc-${s}`}>{t(`account.${s}`)}</small>
  }
  const pick = (a: string | null) => {
    setOpen(false)
    p.onPick(a)
  }

  return (
    <div className="account" ref={ref}>
      <button
        type="button"
        className={`account-btn${open ? ' on' : ''}`}
        title={warn ? t('account.warn') : t('account.title')}
        aria-expanded={open}
        onClick={() => {
          if (!open) p.onOpen()
          setOpen((v) => !v)
        }}
      >
        <Avatar name={current} warn={warn} />
        <span className="account-name">{current ?? t('account.auto')}</span> <small>▾</small>
      </button>
      {open && (
        <div className="refs-menu account-menu" role="menu">
          <div className="account-head">{t('account.forRepo', { repo: p.account.owner ?? '' })}</div>
          {accounts.map((a) => (
            <button key={a} type="button" role="menuitemradio" aria-checked={a === current} className={a === current ? 'sel' : ''} onClick={() => pick(a)}>
              <span className="ck">{a === current ? '✓' : ''}</span>
              <Avatar name={a} small />
              <span className="account-item">{a}</span>
              {state(a)}
            </button>
          ))}
          <button type="button" role="menuitemradio" aria-checked={!current} className={!current ? 'sel' : ''} onClick={() => pick(null)}>
            <span className="ck">{!current ? '✓' : ''}</span>
            <Avatar name={null} small />
            <span className="account-item">{t('account.auto')}</span>
            <small className="muted">{t('account.autoHint')}</small>
          </button>
          <div className="refs-menu-group">
            <button type="button" onClick={() => (setOpen(false), p.onLogin())}>
              {t('account.login')}
            </button>
            <button type="button" onClick={() => (setOpen(false), p.onPrefs())}>
              {t('account.prefs')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
