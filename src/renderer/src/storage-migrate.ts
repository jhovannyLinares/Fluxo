/** Prefijo de las claves de la ventana cuando la app se llamaba Flux. */
const OLD = 'flux.'
const NEW = 'fluxo.'

/**
 * A14: las claves `flux.*` del almacenamiento local (anchos, pestañas, diff, filtros) pasan a `fluxo.*`. Copia cada una
 * que falte con el prefijo nuevo y deja la vieja: así ningún ajuste se pierde aunque se vuelva a abrir una versión
 * anterior. Corre antes de pintar la app. Nunca lanza: sin almacenamiento, la app arranca con valores de fábrica.
 */
export function migrateStorageKeys(store: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'> = localStorage): number {
  let copied = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k?.startsWith(OLD)) keys.push(k)
    }
    for (const k of keys) {
      const next = NEW + k.slice(OLD.length)
      const value = store.getItem(k)
      if (value === null || store.getItem(next) !== null) continue
      store.setItem(next, value)
      copied++
    }
  } catch {
    // solo se pierden los ajustes recordados
  }
  return copied
}
