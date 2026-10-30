import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { translate, type Language, type MessageKey } from '@shared/i18n'
import { defaultPreferences, resolveLanguage, type Preferences } from '@shared/preferences'
import { call, onAppEvent } from './api'

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

interface PrefsValue {
  prefs: Preferences
  /** Aplica al instante y guarda en main; si main rechaza, vuelve a lo último guardado. */
  update: (next: Preferences) => void
  saveFailed: boolean
  /** idioma efectivo: `prefs.language` puede ser `system` */
  lang: Language
  t: Translate
}

const PrefsContext = createContext<PrefsValue | null>(null)

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences)
  const [saveFailed, setSaveFailed] = useState(false)
  const saved = useRef<Preferences>(prefs)

  useEffect(() => {
    call('prefs:get', {}).then((p) => {
      saved.current = p
      setPrefs(p)
    }, () => setSaveFailed(true))
    // zoom por teclado lo cambia main
    return onAppEvent((ev) => {
      if (ev.type !== 'prefs:changed') return
      saved.current = ev.prefs
      setPrefs(ev.prefs)
    })
  }, [])

  // tema, idioma y fuente del diff se aplican en el documento; el canvas los lee de `prefs`
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = prefs.theme
    root.lang = resolveLanguage(prefs.language, navigator.languages)
    root.style.setProperty('--diff-font', `${prefs.diffFont.size}px "${prefs.diffFont.family}", monospace`)
  }, [prefs])

  const update = useCallback((next: Preferences) => {
    setPrefs(next)
    call('prefs:set', next).then(
      (p) => {
        saved.current = p
        setSaveFailed(false)
      },
      () => {
        setPrefs(saved.current)
        setSaveFailed(true)
      }
    )
  }, [])

  const value = useMemo<PrefsValue>(() => {
    // Electron da el idioma de Windows en navigator.languages
    const lang = resolveLanguage(prefs.language, navigator.languages)
    return { prefs, update, saveFailed, lang, t: (key, vars) => translate(lang, key, vars) }
  }, [prefs, update, saveFailed])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs(): PrefsValue {
  const v = useContext(PrefsContext)
  if (!v) throw new Error('usePrefs fuera de PrefsProvider')
  return v
}
