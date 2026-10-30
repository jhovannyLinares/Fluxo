import { describe, expect, it } from 'vitest'
import { contrast, readableOn } from '../../src/renderer/src/graph/contrast'
import { GRAPH_STYLES, PALETTES } from '../../src/renderer/src/graph/palettes'

/** B5: el texto del grafo se lee en los dos temas, también sobre cada color de carril. */
describe('contraste del grafo', () => {
  it('cálculo WCAG: negro sobre blanco 21, blanco sobre blanco 1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  for (const theme of ['dark', 'light'] as const) {
    const pal = PALETTES[theme]
    it(`${theme}: el nombre de cada rama local se lee sobre su carril (≥ 4.5)`, () => {
      for (const lane of pal.lanes) {
        const fg = readableOn(lane, [pal.onColor, pal.badgeText])
        expect(contrast(fg, lane), `${lane} con ${fg}`).toBeGreaterThanOrEqual(4.5)
      }
    })
    it(`${theme}: texto y texto gris sobre el fondo (≥ 4.5)`, () => {
      expect(contrast(pal.text, pal.bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(pal.muted, pal.bg)).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('control: con el blanco fijo de antes, el amarillo no llegaba', () => {
    expect(contrast('#ffffff', '#f2ca33')).toBeLessThan(2)
  })
})

describe('contraste de los diseños con paleta propia (B9)', () => {
  for (const [name, style] of Object.entries(GRAPH_STYLES)) {
    if (!style.lanes) continue
    for (const theme of ['dark', 'light'] as const) {
      it(`${name} en ${theme}: el nombre de cada rama local se lee sobre su carril (≥ 4.5)`, () => {
        const pal = PALETTES[theme]
        for (const lane of style.lanes!) {
          const fg = readableOn(lane, [pal.onColor, pal.badgeText])
          expect(contrast(fg, lane), `${lane} con ${fg}`).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }
})
