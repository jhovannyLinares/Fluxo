import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { parseRecents, RECENTS_VERSION, RecentsFileSchema, type Recent } from '@shared/recents'

/** Lee recientes; archivo ausente o corrupto no rompe el arranque: lista vacía. */
export function loadRecents(file: string): Recent[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  try {
    return parseRecents(JSON.parse(text))
  } catch {
    return []
  }
}

/** Valida y escribe de forma atómica (temporal + rename): un corte a medio escribir no deja JSON truncado. */
export function saveRecents(file: string, repos: Recent[]): Recent[] {
  const valid = RecentsFileSchema.parse({ version: RECENTS_VERSION, repos })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(valid, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  return valid.repos
}
