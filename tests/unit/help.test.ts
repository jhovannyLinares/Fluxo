import { describe, expect, it } from 'vitest'
import { GUIDE, RELEASE_NOTES } from '../../src/shared/help'

/** B8: guía y notas iguales en los dos idiomas, sin puntos vacíos. */
describe('ayuda', () => {
  for (const [name, doc] of [
    ['guía', GUIDE],
    ['notas', RELEASE_NOTES]
  ] as const) {
    it(`${name}: mismas secciones y cantidad de puntos en español e inglés`, () => {
      expect(doc.es.length).toBeGreaterThan(0)
      expect(doc.en.map((s) => s.items.length)).toEqual(doc.es.map((s) => s.items.length))
      for (const s of [...doc.es, ...doc.en]) {
        expect(s.title.trim()).not.toBe('')
        expect(s.items.every((i) => i.trim().length > 10)).toBe(true)
      }
    })
  }
})
