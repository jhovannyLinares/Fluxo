import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {} }))
const { splashHtml } = await import('../../src/main/splash')

/** A11: pantalla de carga con el logo de Fluxo animado, sin scripts. */
describe('pantalla de carga', () => {
  it('trae el logo, el texto de carga y las cuatro ramas animadas, sin scripts', () => {
    const html = splashHtml('dark', 'Cargando…')
    expect(html).toContain('<h1>FLUXO</h1>')
    expect(html).toContain('Cargando…')
    expect(html.match(/class="fl-line"/g)!.length).toBe(4 + 3) // 4 ramas y 3 uniones
    expect(html.match(/class="fl-dot"/g)!.length).toBe(12)
    expect(html).toContain('@keyframes fl-draw')
    expect(html).not.toMatch(/<script/i)
  })

  it('solo nombra la app como Fluxo, sin importar mayúsculas (A14)', () => {
    const html = splashHtml('light', 'Cargando…')
    expect(html).toContain('<title>Fluxo</title>')
    expect(html.match(/flux\w*/gi)!.every((w) => w.toUpperCase() === 'FLUXO')).toBe(true)
  })

  it('usa el fondo del tema', () => {
    expect(splashHtml('dark', 'x')).toContain('background:#1c1e23')
    expect(splashHtml('light', 'x')).toContain('background:#fcfcfc')
  })
})
