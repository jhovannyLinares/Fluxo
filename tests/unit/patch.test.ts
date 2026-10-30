import { describe, expect, it } from 'vitest'
import type { DiffLine } from '../../src/shared/diff'
import { filePatch, hunkPatch } from '../../src/shared/patch'

const L = (t: DiffLine['t'], text: string): DiffLine => ({ t, text, old: null, new: null })

describe('hunkPatch', () => {
  const a = L('-', 'viejo1')
  const b = L('+', 'nuevo1')
  const c = L('-', 'viejo2')
  const d = L('+', 'nuevo2')
  const hunk = { header: '@@ -10,4 +10,4 @@ ctx', lines: [L(' ', 'x'), a, c, b, d, L(' ', 'y')] }

  it('bloque entero: todas las líneas de cambio tal cual', () => {
    expect(hunkPatch(hunk, { reverse: false })).toBe('@@ -10 +10 @@\n x\n-viejo1\n-viejo2\n+nuevo1\n+nuevo2\n y\n')
  })

  it('stage de líneas: la añadida sin elegir se omite y la quitada sin elegir queda como contexto', () => {
    const p = hunkPatch(hunk, { selected: new Set([a, b]), reverse: false })
    expect(p).toBe('@@ -10 +10 @@\n x\n-viejo1\n viejo2\n+nuevo1\n y\n')
  })

  it('unstage o descartar de líneas (reversa): la añadida sin elegir queda como contexto y la quitada se omite', () => {
    const p = hunkPatch(hunk, { selected: new Set([a, b]), reverse: true })
    expect(p).toBe('@@ -10 +10 @@\n x\n-viejo1\n+nuevo1\n nuevo2\n y\n')
  })

  it('sin líneas de cambio elegidas no hay patch', () => {
    expect(hunkPatch(hunk, { selected: new Set(), reverse: false })).toBeNull()
  })

  it('una cabecera que no es de bloque no produce patch', () => {
    expect(hunkPatch({ header: 'basura', lines: [a] }, { reverse: false })).toBeNull()
  })

  it('el patch del archivo lleva su cabecera y los bloques seguidos', () => {
    expect(filePatch('b.txt', ['@@ -1 +1 @@\n-x\n+y\n'])).toBe('--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n')
  })
})
