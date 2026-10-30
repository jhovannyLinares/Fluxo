import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadThemes } from '../../src/main/themes-store'
import { parseJsonc, parseTheme } from '../../src/shared/themes'

/** B13: temas en archivos `.json` de Fluxo. */
describe('temas en archivos', () => {
  it('JSON con comentarios y comas finales; los // dentro de una cadena quedan', () => {
    const text = `{
      // comentario
      "url": "https://ejemplo.com", /* otro */
      "lista": [1, 2,],
    }`
    expect(parseJsonc(text)).toEqual({ url: 'https://ejemplo.com', lista: [1, 2] })
  })

  it('la carpeta solo lee los .json: un .jsonc no aparece ni da error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fluxo-temas-'))
    try {
      writeFileSync(join(dir, 'mio.json'), JSON.stringify({ name: 'Mío', lanes: ['#ff0000', '#00ff00'] }))
      writeFileSync(join(dir, 'otro.jsonc'), JSON.stringify({ name: 'Otro', lanes: ['#ff0000', '#00ff00'] }))
      const { themes, errors } = loadThemes(dir)
      expect(themes.map((t) => t.file)).toEqual(['mio.json'])
      expect(errors).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('tema propio de Fluxo: base, medidas y colores; lo desconocido o fuera de rango se rechaza', () => {
    const t = parseTheme('mio.json', JSON.stringify({ name: 'Alto', base: 'rails', rowH: 26, lanes: ['#ff0000', '#00ff00'] }))
    expect(t).toEqual({ file: 'mio.json', name: 'Alto', base: 'rails', style: { rowH: 26, lanes: ['#ff0000', '#00ff00'] } })
    expect(() => parseTheme('x.json', JSON.stringify({ name: 'x', rowH: 500 }))).toThrow()
    expect(() => parseTheme('x.json', JSON.stringify({ name: 'x', script: 'alert(1)' }))).toThrow()
    expect(() => parseTheme('x.json', JSON.stringify({ name: 'x', lanes: ['red', 'blue'] }))).toThrow()
  })

  it('archivo dañado: error, no un tema vacío', () => {
    expect(() => parseTheme('roto.json', '{ "name": ')).toThrow()
  })
})
