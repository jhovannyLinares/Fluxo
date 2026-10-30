import { describe, expect, it } from 'vitest'
import { migrateStorageKeys } from '../../src/renderer/src/storage-migrate'

/** A14: las claves `flux.*` del almacenamiento local pasan a `fluxo.*` sin perder ni pisar nada. */
function fakeStore(entries: Record<string, string>) {
  const m = new Map(Object.entries(entries))
  return {
    map: m,
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v)
  }
}

describe('migración de las claves de la ventana', () => {
  it('copia cada clave flux.* a fluxo.* y deja la vieja', () => {
    const s = fakeStore({ 'flux.layout.widths': '{"left":300}', 'flux.tabs': '{}', otra: 'x' })
    expect(migrateStorageKeys(s)).toBe(2)
    expect(s.map.get('fluxo.layout.widths')).toBe('{"left":300}')
    expect(s.map.get('fluxo.tabs')).toBe('{}')
    expect(s.map.get('flux.tabs')).toBe('{}')
    expect(s.map.has('fluxo.otra')).toBe(false)
  })

  it('no pisa una clave fluxo.* que ya existe, y una segunda corrida no copia nada', () => {
    const s = fakeStore({ 'flux.diff.mode': 'hunks', 'fluxo.diff.mode': 'full' })
    expect(migrateStorageKeys(s)).toBe(0)
    expect(s.map.get('fluxo.diff.mode')).toBe('full')
  })

  it('las claves fluxo.* no se confunden con flux.*', () => {
    const s = fakeStore({ 'fluxo.tabs': '{}' })
    expect(migrateStorageKeys(s)).toBe(0)
    expect(s.map.size).toBe(1)
  })
})
