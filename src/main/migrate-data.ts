import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Lo que guarda los ajustes de quien ya usaba la app: preferencias, recientes, temas, registro y el almacenamiento local de la ventana (anchos, pestañas, diff). */
export const DATA_ITEMS = ['preferences.json', 'recents.json', 'themes', 'logs', 'Local Storage'] as const

/**
 * A14: Flux pasó a llamarse Fluxo y su carpeta de datos pasó de `%APPDATA%\Flux` a `%APPDATA%\Fluxo`. Si la nueva no
 * tiene ningún ajuste y la vieja sí, copia los ajustes a la nueva; la vieja queda intacta. Corre antes de `ready`, para
 * que Chromium abra el almacenamiento local ya copiado. Nunca lanza: si algo falla, la app arranca con valores de fábrica.
 */
export function migrateDataDir(oldDir: string, newDir: string): string[] {
  if (!existsSync(oldDir) || DATA_ITEMS.some((item) => existsSync(join(newDir, item)))) return []
  const copied: string[] = []
  for (const item of DATA_ITEMS) {
    const from = join(oldDir, item)
    if (!existsSync(from)) continue
    try {
      cpSync(from, join(newDir, item), { recursive: true, force: false, errorOnExist: false })
      copied.push(item)
    } catch {
      // un archivo bloqueado no impide copiar el resto
    }
  }
  return copied
}
