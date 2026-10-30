import { describe, expect, it } from 'vitest'
import { changePairs, changeStarts, parseUnified, sideBySide, wordSegments, type DiffLine } from '../../src/shared/diff'

const L = (t: DiffLine['t'], text: string): DiffLine => ({ t, text, old: null, new: null })

/** H19: lectura del diff, lado a lado, palabras y saltos entre cambios. */
describe('diff (H19)', () => {
  it('parseUnified: números de línea, sin la marca de fin de archivo y sin cabeceras', () => {
    const out = [
      'diff --git a/x b/x',
      'index 1..2 100644',
      '--- a/x',
      '+++ b/x',
      '@@ -2,3 +2,3 @@ function f',
      ' dos',
      '-tres',
      '+TRES',
      ' cuatro',
      '\\ No newline at end of file',
      ''
    ].join('\n')
    const { binary, hunks } = parseUnified(out)
    expect(binary).toBe(false)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.lines).toEqual([
      { t: ' ', text: 'dos', old: 2, new: 2 },
      { t: '-', text: 'tres', old: 3, new: null },
      { t: '+', text: 'TRES', old: null, new: 3 },
      { t: ' ', text: 'cuatro', old: 4, new: 4 }
    ])
  })

  it('parseUnified: binario sin fragmentos', () => {
    const r = parseUnified('diff --git a/b.dat b/b.dat\nindex 1..2 100644\nBinary files a/b.dat and b/b.dat differ\n')
    expect(r).toEqual({ binary: true, hunks: [] })
  })

  it('sideBySide: empareja quitadas con añadidas y deja hueco si sobran', () => {
    const lines = [L(' ', 'a'), L('-', 'b'), L('-', 'c'), L('+', 'B'), L(' ', 'd'), L('+', 'e')]
    const rows = sideBySide(lines).map((r) => [r.left?.text ?? null, r.right?.text ?? null])
    expect(rows).toEqual([
      ['a', 'a'],
      ['b', 'B'],
      ['c', null],
      ['d', 'd'],
      [null, 'e']
    ])
    const pairs = changePairs(lines)
    expect(pairs.get(lines[1]!)).toBe(lines[3])
    expect(pairs.has(lines[2]!)).toBe(false)
  })

  it('wordSegments: una coma cambiada es lo único marcado (C14)', () => {
    const a = 'const total = suma(a, b)'
    const b = 'const total = suma(a; b)'
    expect(wordSegments(a, b).filter((s) => s.changed)).toEqual([{ text: ',', changed: true }])
    expect(wordSegments(b, a).filter((s) => s.changed)).toEqual([{ text: ';', changed: true }])
    expect(wordSegments(a, b).map((s) => s.text).join('')).toBe(a)
  })

  it('wordSegments: línea idéntica no marca nada y una muy larga se marca entera', () => {
    expect(wordSegments('igual', 'igual')).toEqual([{ text: 'igual', changed: false }])
    const big = 'x '.repeat(500)
    expect(wordSegments(big, big + 'y')).toEqual([{ text: big, changed: true }])
  })

  it('changeStarts: inicio de cada bloque de cambios', () => {
    expect(changeStarts([false, true, true, false, false, true])).toEqual([1, 5])
    expect(changeStarts([true])).toEqual([0])
    expect(changeStarts([false, false])).toEqual([])
  })
})
