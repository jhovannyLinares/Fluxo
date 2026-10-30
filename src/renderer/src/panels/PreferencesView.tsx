import { useEffect, useState, type ReactNode } from 'react'
import { LANGUAGE_NAMES } from '@shared/i18n'
import {
  AUTO_FETCH_OPTIONS,
  DEFAULT_PREFERENCES,
  DIFF_FONTS,
  GRAPH_STYLE_NAMES,
  LANGUAGES,
  nextZoom,
  resolveLanguage,
  TAG_SCHEMES,
  THEMES,
  type Preferences
} from '@shared/preferences'
import type { Res } from '@shared/ipc-contracts'
import { call } from '../api'
import { commitDate, formatPattern } from '../format'
import { usePrefs } from '../prefs'
import { AccountsSection } from './AccountsSection'

// fecha fija para la vista previa: el usuario ve cómo queda cada token
const PREVIEW_TIME = Math.floor(Date.now() / 1000) - 4 * 60

type Section = 'general' | 'accounts' | 'ui' | 'advanced'

/** Fila del formulario: etiqueta a la derecha, control a la izquierda y ayuda gris debajo. */
function Field({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="pref-field">
      <span className="pref-label">{label}</span>
      <div className="pref-control">
        {children}
        {help && <div className="pref-help">{help}</div>}
      </div>
    </div>
  )
}

/**
 * Preferencias de vista (H06): ocupan la ventana, con «Salir de preferencias» y
 * las secciones en una columna a la izquierda. Todo se aplica al instante (N14) y se guarda en main. Esc sale.
 */
export function PreferencesView({
  onClose,
  onEnvironment,
  repoId,
  remote
}: {
  onClose: () => void
  onEnvironment: () => void
  /** repo abierto y su remoto, para «Probar» en Cuentas (A12) */
  repoId: string | null
  remote: string | null
}) {
  const { prefs, update, saveFailed, lang, t } = usePrefs()
  const [section, setSection] = useState<Section>('general')
  // borrador del patrón: un patrón vacío no se guarda, pero se deja escribir
  const [pattern, setPattern] = useState(prefs.date.pattern)
  const [detailPattern, setDetailPattern] = useState(prefs.detailDate)
  // B13: temas de la carpeta, para el selector; «Volver a leer» los relee sin reiniciar
  const [themeList, setThemeList] = useState<Res<'themes:list'> | null>(null)
  const loadThemes = () => void call('themes:list', {}).then(setThemeList, () => setThemeList(null))
  useEffect(loadThemes, [])
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => update({ ...prefs, [key]: value })
  const columns = ['author', 'date', 'sha'] as const

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sections: { id: Section; label: string; icon: string }[] = [
    { id: 'general', label: t('prefs.section.general'), icon: '⚙' },
    { id: 'accounts', label: t('prefs.section.accounts'), icon: '👤' },
    { id: 'ui', label: t('prefs.section.ui'), icon: '🖌' },
    { id: 'advanced', label: t('prefs.section.advanced'), icon: '⚗' }
  ]

  return (
    <div className="prefs-view" aria-label={t('prefs.title')}>
      <nav className="prefs-nav">
        <button type="button" className="prefs-exit" onClick={onClose}>
          ← {t('prefs.exit')}
        </button>
        <div className="prefs-nav-title">{t('prefs.title')}</div>
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`prefs-nav-item${section === s.id ? ' on' : ''}`}
            aria-current={section === s.id ? 'page' : undefined}
            onClick={() => setSection(s.id)}
          >
            <span className="prefs-icon" aria-hidden="true">
              {s.icon}
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      <section className="prefs-content">
        <h1>{sections.find((s) => s.id === section)!.label}</h1>
        {saveFailed && (
          <p role="alert" className="form-error">
            {t('prefs.saveError')}
          </p>
        )}

        {section === 'general' && (
          <>
            <Field label={t('prefs.language')}>
              <select className="input" value={prefs.language} onChange={(e) => set('language', e.target.value as Preferences['language'])}>
                <option value="system">{t('prefs.language.system', { name: LANGUAGE_NAMES[resolveLanguage('system', navigator.languages)] })}</option>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_NAMES[l]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('prefs.autoFetch')} help={t('prefs.autoFetch.help')}>
              <select className="input" value={prefs.autoFetchMinutes} onChange={(e) => set('autoFetchMinutes', Number(e.target.value))}>
                {AUTO_FETCH_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? t('prefs.autoFetch.off') : t('prefs.autoFetch.every', { n })}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        {section === 'ui' && (
          <>
            <Field label={t('prefs.theme')}>
              <select className="input" value={prefs.theme} onChange={(e) => set('theme', e.target.value as Preferences['theme'])}>
                {THEMES.map((th) => (
                  <option key={th} value={th}>
                    {t(`prefs.theme.${th}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('prefs.zoom')}>
              <span className="zoom">
                <button type="button" className="btn" aria-label={t('prefs.zoom.out')} onClick={() => set('zoom', nextZoom(prefs.zoom, -1))}>
                  −
                </button>
                <output aria-live="polite">{Math.round(prefs.zoom * 100)} %</output>
                <button type="button" className="btn" aria-label={t('prefs.zoom.in')} onClick={() => set('zoom', nextZoom(prefs.zoom, 1))}>
                  +
                </button>
                <button type="button" className="btn ghost" onClick={() => set('zoom', nextZoom(prefs.zoom, 0))}>
                  {t('prefs.zoom.reset')}
                </button>
              </span>
            </Field>
            <Field label={t('prefs.columns')}>
              <div className="pref-checks">
                {columns.map((c) => (
                  <label key={c} className="check">
                    <input type="checkbox" checked={prefs.columns[c]} onChange={(e) => set('columns', { ...prefs.columns, [c]: e.target.checked })} />
                    {t(`graph.header.${c}`)}
                  </label>
                ))}
                <button type="button" className="btn ghost" onClick={() => set('columns', { ...DEFAULT_PREFERENCES.columns })}>
                  {t('prefs.columns.reset')}
                </button>
              </div>
            </Field>
            <Field
              label={t('prefs.date')}
              help={
                <>
                  {t('prefs.date.tokens')}
                  {!pattern.trim() && <div className="form-error">{t('prefs.date.invalid')}</div>}
                  <div>
                    {t('prefs.date.preview')}: <strong>{commitDate(PREVIEW_TIME, Date.now(), prefs.date, lang)}</strong>
                  </div>
                </>
              }
            >
              <div className="pref-checks">
                <label className="check">
                  <input type="radio" name="date-mode" checked={prefs.date.mode === 'relative'} onChange={() => set('date', { ...prefs.date, mode: 'relative' })} />
                  {t('prefs.date.relative')}
                </label>
                <label className="check">
                  <input type="radio" name="date-mode" checked={prefs.date.mode === 'absolute'} onChange={() => set('date', { ...prefs.date, mode: 'absolute' })} />
                  {t('prefs.date.absolute')}
                </label>
                <input
                  className="input mono"
                  aria-label={t('prefs.date.pattern')}
                  value={pattern}
                  maxLength={40}
                  disabled={prefs.date.mode !== 'absolute'}
                  aria-invalid={!pattern.trim()}
                  onChange={(e) => {
                    setPattern(e.target.value)
                    if (e.target.value.trim()) set('date', { ...prefs.date, pattern: e.target.value })
                  }}
                />
              </div>
            </Field>
            {/* Personalización: formato de la fecha completa y etiquetas de la barra */}
            <Field
              label={t('prefs.detailDate')}
              help={
                <>
                  {t('prefs.detailDate.help')}
                  {!detailPattern.trim() && <div className="form-error">{t('prefs.date.invalid')}</div>}
                  <div>
                    {t('prefs.date.preview')}: <strong>{formatPattern(PREVIEW_TIME, prefs.detailDate, lang)}</strong>
                  </div>
                </>
              }
            >
              <input
                className="input mono"
                aria-label={t('prefs.detailDate')}
                value={detailPattern}
                maxLength={60}
                aria-invalid={!detailPattern.trim()}
                onChange={(e) => {
                  setDetailPattern(e.target.value)
                  if (e.target.value.trim()) set('detailDate', e.target.value)
                }}
              />
            </Field>
            <Field label={t('prefs.graphStyle')}>
              <select className="input" value={prefs.graphStyle} onChange={(e) => set('graphStyle', e.target.value as Preferences['graphStyle'])}>
                {GRAPH_STYLE_NAMES.map((s) => (
                  <option key={s} value={s}>
                    {t(`prefs.graphStyle.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('prefs.tagColors')}>
              <select className="input" value={prefs.tagColors} onChange={(e) => set('tagColors', e.target.value as Preferences['tagColors'])}>
                {TAG_SCHEMES.map((s) => (
                  <option key={s} value={s}>
                    {t(`prefs.tagColors.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            {/* B13: tema de la carpeta de temas aplicado sobre el diseño elegido */}
            <Field
              label={t('prefs.graphTheme')}
              help={
                <>
                  {t('prefs.graphTheme.help')}
                  {themeList?.errors.map((e) => (
                    <div key={e.file} className="form-error">
                      {t('prefs.graphTheme.bad', { file: e.file, reason: e.message })}
                    </div>
                  ))}
                </>
              }
            >
              <span className="pref-inline">
                <select className="input" value={prefs.graphTheme ?? ''} onChange={(e) => set('graphTheme', e.target.value || null)}>
                  <option value="">{t('prefs.graphTheme.none')}</option>
                  {themeList?.themes.map((th) => (
                    <option key={th.file} value={th.file}>
                      {th.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn ghost" onClick={() => void call('themes:openFolder', {})}>
                  {t('prefs.graphTheme.open')}
                </button>
                <button type="button" className="btn ghost" onClick={loadThemes}>
                  {t('prefs.graphTheme.reload')}
                </button>
              </span>
            </Field>
            <Field label={t('prefs.toolbarLabels')}>
              <label className="pref-inline">
                <input type="checkbox" checked={prefs.toolbarLabels} onChange={(e) => set('toolbarLabels', e.target.checked)} />
                {t('prefs.toolbarLabels.on')}
              </label>
            </Field>
            <Field label={t('prefs.refHover')}>
              <label className="pref-inline">
                <input
                  type="checkbox"
                  checked={prefs.highlightRowsOnRefHover}
                  onChange={(e) => set('highlightRowsOnRefHover', e.target.checked)}
                />
                {t('prefs.refHover.on')}
              </label>
            </Field>
            <Field label={t('prefs.diff')} help={<pre className="diff-sample">{t('prefs.diff.sample')}</pre>}>
              <span className="pref-inline">
                <select
                  className="input"
                  aria-label={t('prefs.diff.family')}
                  value={prefs.diffFont.family}
                  onChange={(e) => set('diffFont', { ...prefs.diffFont, family: e.target.value as Preferences['diffFont']['family'] })}
                >
                  {DIFF_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  type="number"
                  aria-label={t('prefs.diff.size')}
                  min={9}
                  max={24}
                  value={prefs.diffFont.size}
                  onChange={(e) => {
                    const size = Number(e.target.value)
                    if (Number.isInteger(size) && size >= 9 && size <= 24) set('diffFont', { ...prefs.diffFont, size })
                  }}
                />
              </span>
            </Field>
          </>
        )}

        {section === 'accounts' && <AccountsSection repoId={repoId} remote={remote} />}

        {section === 'advanced' && (
          <Field label={t('prefs.environment')} help={t('prefs.environment.help')}>
            <button type="button" className="btn" onClick={onEnvironment}>
              {t('menu.env')}
            </button>
          </Field>
        )}
      </section>
    </div>
  )
}
