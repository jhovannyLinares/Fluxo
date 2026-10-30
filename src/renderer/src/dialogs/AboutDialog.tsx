import { useEffect, useState } from 'react'
import { LOGO_CSS, logoSvg } from '@shared/logo'
import { call } from '../api'
import { usePrefs } from '../prefs'
import { APP_VERSION } from '../version'
import { Modal } from './Modal'

/** Proyectos de código abierto que van dentro de Fluxo, con su licencia. */
const BUNDLED = [
  { name: 'Electron', license: 'MIT' },
  { name: 'React', license: 'MIT' },
  { name: 'electron-vite', license: 'MIT' },
  { name: 'Zod', license: 'MIT' },
  { name: 'Open Sans', license: 'OFL 1.1' }
]
/** Herramientas que Fluxo usa del equipo, sin incluirlas. */
const EXTERNAL = [
  { name: 'Git for Windows', license: 'GPL 2.0' },
  { name: 'Git Credential Manager', license: 'MIT' }
]

/**
 * «Acerca de Fluxo»: el logo animado de la pantalla de carga (A11), la versión, con qué
 * corre y los proyectos de código abierto que usa. Botones a las notas de la versión y a la guía.
 */
export function AboutDialog({
  git,
  gcm,
  onReleaseNotes,
  onGuide,
  onClose
}: {
  git: string | null
  gcm: string | null
  onReleaseNotes: () => void
  onGuide: () => void
  onClose: () => void
}) {
  const { t } = usePrefs()
  const [rt, setRt] = useState<{ electron: string; chrome: string; node: string } | null>(null)
  useEffect(() => {
    call('app:versions', {}).then(setRt, () => {})
  }, [])

  return (
    <Modal title={t('menu.about')} onClose={onClose}>
      <div className="about">
        <style>{LOGO_CSS}</style>
        {/* SVG fijo generado por Fluxo, sin datos externos */}
        <div className="about-logo" dangerouslySetInnerHTML={{ __html: logoSvg(110) }} />
        <h2 className="about-title">Fluxo {APP_VERSION}</h2>
        <p className="about-tagline">{t('about.tagline')}</p>
        {rt && <p className="muted about-small">{t('about.runtime', rt)}</p>}
        <p className="muted about-small">
          {t('about.tools', { git: git ? `git ${git}` : `git: ${t('about.toolMissing')}`, gcm: gcm ? `GCM ${gcm}` : `GCM: ${t('about.toolMissing')}` })}
        </p>

        <h3>{t('about.openSource')}</h3>
        <ul className="about-grid">
          {BUNDLED.map((p) => (
            <li key={p.name}>
              <strong>{p.name}</strong> <span className="muted">{p.license}</span>
            </li>
          ))}
        </ul>
        <h3>{t('about.external')}</h3>
        <ul className="about-grid">
          {EXTERNAL.map((p) => (
            <li key={p.name}>
              <strong>{p.name}</strong> <span className="muted">{p.license}</span>
            </li>
          ))}
        </ul>

        <div className="about-actions">
          <button type="button" className="btn" onClick={onReleaseNotes}>
            {t('menu.releaseNotes')}
          </button>
          <button type="button" className="btn" onClick={onGuide}>
            {t('menu.guide')}
          </button>
        </div>
        <p className="muted about-small">{t('about.copyright', { author: 'Gio' })}</p>
      </div>
    </Modal>
  )
}
