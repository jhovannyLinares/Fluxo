import { GUIDE, RELEASE_NOTES } from '@shared/help'
import { usePrefs } from '../prefs'
import { APP_VERSION } from '../version'
import { Modal } from './Modal'

/** B8: Ayuda ▸ Guía de uso o Notas de la versión, en el idioma de la app. */
export function HelpDialog({ kind, onClose }: { kind: 'guide' | 'releaseNotes'; onClose: () => void }) {
  const { lang, t } = usePrefs()
  const sections = (kind === 'guide' ? GUIDE : RELEASE_NOTES)[lang]
  return (
    <Modal title={kind === 'guide' ? t('menu.guide') : t('help.notesTitle', { version: APP_VERSION })} onClose={onClose}>
      {sections.map((s) => (
        <section key={s.title} className="help-section">
          <h3>{s.title}</h3>
          <ul>
            {s.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </Modal>
  )
}
