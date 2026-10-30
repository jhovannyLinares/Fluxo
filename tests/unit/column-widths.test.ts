import { afterEach, describe, expect, it, vi } from 'vitest'
import { clampColumn, loadColumnSizes, saveColumnSizes } from '../../src/renderer/src/graph/column-widths'

/** Columnas del grafo redimensionables desde la cabecera. */
describe('anchos de las columnas del grafo', () => {
  it('respeta los límites de cada columna', () => {
    expect(clampColumn('refs', 10)).toBe(60)
    expect(clampColumn('graph', 5000)).toBe(600)
    expect(clampColumn('date', 99.6)).toBe(100)
  })

  describe('se recuerdan', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v)
    })
    afterEach(() => store.clear())

    it('lo guardado vuelve igual', () => {
      saveColumnSizes({ refs: 200, author: 150 })
      expect(loadColumnSizes()).toEqual({ refs: 200, author: 150 })
    })

    it('un valor dañado o fuera de rango se descarta, solo ese', () => {
      store.set('fluxo.graph.columns', JSON.stringify({ refs: 5, graph: 'x', author: 150 }))
      expect(loadColumnSizes()).toEqual({ author: 150 })
      store.set('fluxo.graph.columns', '{roto')
      expect(loadColumnSizes()).toEqual({})
    })
  })
})
