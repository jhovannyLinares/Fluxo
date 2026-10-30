import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { defaultPreferences, parsePreferences, PreferencesSchema, type Preferences } from '@shared/preferences'

/** Lee preferencias; archivo ausente, corrupto o de otra versión no rompe el arranque: valores por defecto. */
export function loadPreferences(file: string): Preferences {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return defaultPreferences()
  }
  try {
    return parsePreferences(JSON.parse(text))
  } catch {
    return defaultPreferences()
  }
}

/** Valida y escribe de forma atómica (temporal + rename): un corte a medio escribir no deja JSON truncado. */
export function savePreferences(file: string, prefs: Preferences): Preferences {
  const valid = PreferencesSchema.parse(prefs)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(valid, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  return valid
}
