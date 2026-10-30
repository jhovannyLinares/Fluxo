import { Fragment, useState } from 'react'
import { usePrefs } from '../prefs'
import { filterShortcuts, SHORTCUTS } from '../shortcuts'
import { Modal } from './Modal'

/** Lista de atajos con filtro (C22), Ctrl+/. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { lang, t } = usePrefs()
  const [query, setQuery] = useState('')
  const shown = filterShortcuts(SHORTCUTS, query, lang)
  const sections = [...new Set(shown.map((s) => s.section))]

  return (
    <Modal title={t('shortcuts.title')} onClose={onClose}>
      <input
        type="search"
        className="input"
        data-autofocus
        placeholder={t('shortcuts.filter')}
        aria-label={t('shortcuts.filter')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {shown.length === 0 && <p className="muted">{t('shortcuts.none')}</p>}
      {sections.map((section) => (
        <section key={section} className="shortcut-section">
          <h3>{t(section)}</h3>
          <dl>
            {shown
              .filter((s) => s.section === section)
              .map((s) => (
                <Fragment key={s.label}>
                  <dt>{t(s.label)}</dt>
                  <dd>
                    {[s.keys, ...(s.alt ? [s.alt] : [])].map((combo, c) => (
                      <Fragment key={combo.join('+')}>
                        {c > 0 && ` ${t('shortcuts.or')} `}
                        {combo.map((k, i) => (
                          <Fragment key={k}>
                            {i > 0 && ' + '}
                            <kbd>{k}</kbd>
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </dd>
                </Fragment>
              ))}
          </dl>
        </section>
      ))}
    </Modal>
  )
}
