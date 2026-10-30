import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseTheme, type Theme } from '@shared/themes'

/** Archivos que se leen como tema: los `.json` de Fluxo. */
const THEME_FILE = /\.json$/i
/** Un tema es texto chico; uno más grande no se lee. */
const MAX_BYTES = 256 * 1024

/**
 * B13: lee la carpeta de temas. Nunca lanza: lo que no se pudo leer va en `errors` con su motivo, para el registro de
 * errores, y los demás temas se muestran igual.
 */
export function loadThemes(dir: string): { themes: Theme[]; errors: { file: string; message: string }[] } {
  const themes: Theme[] = []
  const errors: { file: string; message: string }[] = []
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => THEME_FILE.test(f)).sort()
  } catch {
    return { themes, errors } // carpeta aún no creada: ningún tema
  }
  for (const file of files) {
    try {
      const path = join(dir, file)
      if (statSync(path).size > MAX_BYTES) throw new Error('el archivo pasa de 256 KB')
      themes.push(parseTheme(file, readFileSync(path, 'utf8')))
    } catch (e) {
      errors.push({ file, message: e instanceof Error ? e.message.split('\n')[0]!.slice(0, 200) : String(e) })
    }
  }
  return { themes, errors }
}

/** Crea la carpeta de temas si no existe. */
export function ensureThemesDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}
