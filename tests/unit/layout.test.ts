import { afterEach, describe, expect, it, vi } from 'vitest'
import { clampWidth, DEFAULT_WIDTHS, loadWidths, MIN_CENTER, saveWidths } from '../../src/renderer/src/layout'

/** B1: paneles redimensionables con límites y anchos recordados. */
describe('anchos de los paneles', () => {
  it('respeta los límites de cada panel', () => {
    expect(clampWidth('left', 50, 400, 1600)).toBe(160)
    expect(clampWidth('left', 900, 400, 1600)).toBe(480)
    expect(clampWidth('right', 500, 250, 1600)).toBe(500)
  })

  it('el grafo nunca queda por debajo del mínimo', () => {
    // ventana de 1000 px con el detalle en 400: al izquierdo le quedan 300 px
    expect(clampWidth('left', 450, 400, 1000)).toBe(1000 - 400 - MIN_CENTER)
  })

  describe('se recuerdan', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v)
    })
    afterEach(() => store.clear())

    it('lo guardado vuelve igual', () => {
      saveWidths({ left: 300, right: 520 })
      expect(loadWidths()).toEqual({ left: 300, right: 520 })
    })

    it('un valor dañado o fuera de rango vuelve al de fábrica, solo ese', () => {
      store.set('fluxo.layout.widths', JSON.stringify({ left: 5000, right: 500 }))
      expect(loadWidths()).toEqual({ left: DEFAULT_WIDTHS.left, right: 500 })
      store.set('fluxo.layout.widths', '{no es json')
      expect(loadWidths()).toEqual(DEFAULT_WIDTHS)
    })
  })
})
