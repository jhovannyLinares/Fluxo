import { describe, expect, it } from 'vitest'
import { branchLabel, branchRows, rowOwners } from '../../src/backend/git/branch-rows'
import { buildGraph } from '../../src/backend/git/graph-builder'
import type { RawCommit } from '../../src/backend/git/parsers/log'
import type { RefLabel } from '../../src/shared/graph-types'

const c = (hash: string, ...parents: string[]): RawCommit => ({
  hash,
  parents,
  author: 'A',
  email: 'a@x',
  time: 0,
  subject: hash,
  coAuthors: ''
})

const graph = (commits: RawCommit[], refs: Record<string, RefLabel[]>) => buildGraph(commits, new Map(Object.entries(refs))).rows
const hashes = (rows: { hash: string }[], idx: number[]) => idx.map((i) => rows[i]!.hash)

describe('branchRows (B11)', () => {
  it('rama sin fusionar: cada rama se queda con su tramo, la base es de la rama de más arriba', () => {
    // feature (f2, f1) sale de b1; main (m2, m1) sigue desde b1
    const rows = graph([c('f2', 'f1'), c('m2', 'm1'), c('f1', 'b1'), c('m1', 'b1'), c('b1', 'b0'), c('b0')], {
      f2: [{ name: 'feature', kind: 'local' }],
      m2: [{ name: 'main', kind: 'local' }]
    })
    expect(hashes(rows, branchRows(rows, 'refs/heads/feature'))).toEqual(['f2', 'f1', 'b1', 'b0'])
    expect(hashes(rows, branchRows(rows, 'refs/heads/main'))).toEqual(['m2', 'm1'])
  })

  it('merge: el primer padre manda sobre la fila de más arriba', () => {
    // m = merge(b2, f1), sin etiqueta en f1: f1 hereda de m por segundo padre; b2 por primer padre
    const rows = graph([c('m', 'b2', 'f1'), c('f1', 'b1'), c('b2', 'b1'), c('b1', 'b0'), c('b0')], {
      m: [{ name: 'main', kind: 'local' }]
    })
    expect(hashes(rows, branchRows(rows, 'refs/heads/main'))).toEqual(['m', 'f1', 'b2', 'b1', 'b0'])
  })

  it('un hijo de primer padre gana a un merge de más arriba que lo trae como segundo padre', () => {
    // M = merge(a, x) en main; c (feature) y a salen de x
    const rows = graph([c('M', 'a', 'x'), c('c', 'x'), c('a', 'x'), c('x')], {
      M: [{ name: 'main', kind: 'local' }],
      c: [{ name: 'feature', kind: 'local' }]
    })
    expect(hashes(rows, branchRows(rows, 'refs/heads/feature'))).toEqual(['c', 'x'])
    expect(hashes(rows, branchRows(rows, 'refs/heads/main'))).toEqual(['M', 'a'])
  })

  it('merge con la rama todavía etiquetada: sus commits son de ella, no de main', () => {
    const rows = graph([c('m', 'b2', 'f1'), c('f1', 'b1'), c('b2', 'b1'), c('b1', 'b0'), c('b0')], {
      m: [{ name: 'main', kind: 'local' }],
      f1: [{ name: 'feature', kind: 'local' }]
    })
    // b1 es primer padre de f1 (más arriba) y de b2: gana f1 por estar más arriba
    expect(hashes(rows, branchRows(rows, 'refs/heads/feature'))).toEqual(['f1', 'b1', 'b0'])
    expect(hashes(rows, branchRows(rows, 'refs/heads/main'))).toEqual(['m', 'b2'])
  })

  it('un tag no corta la rama, y la remota se distingue de la local', () => {
    const rows = graph([c('c', 'b'), c('b', 'a'), c('a')], {
      c: [
        { name: 'main', kind: 'local' },
        { name: 'origin/main', kind: 'remote' }
      ],
      b: [{ name: 'v1', kind: 'tag' }]
    })
    expect(hashes(rows, branchRows(rows, 'refs/heads/main'))).toEqual(['c', 'b', 'a'])
    expect(hashes(rows, branchRows(rows, 'refs/remotes/origin/main'))).toEqual(['c', 'b', 'a'])
    expect(branchRows(rows, 'refs/remotes/origin/otra')).toEqual([])
    expect(branchRows(rows, 'refs/tags/v1')).toEqual([])
  })

  it('una rama local más abajo sí corta: main se queda solo con su tramo', () => {
    const rows = graph([c('c', 'b'), c('b', 'a'), c('a')], {
      c: [{ name: 'main', kind: 'local' }],
      b: [{ name: 'vieja', kind: 'local' }]
    })
    expect(hashes(rows, branchRows(rows, 'refs/heads/main'))).toEqual(['c'])
    expect(hashes(rows, branchRows(rows, 'refs/heads/vieja'))).toEqual(['b', 'a'])
  })

  it('commits sin rama encima no tienen dueña', () => {
    const rows = graph([c('x', 'a'), c('a')], {})
    expect([...rowOwners(rows)]).toEqual([-1, -1])
  })

  it('branchLabel separa local y remota', () => {
    expect(branchLabel('refs/heads/claude/x')).toEqual({ name: 'claude/x', kind: 'local' })
    expect(branchLabel('refs/remotes/origin/main')).toEqual({ name: 'origin/main', kind: 'remote' })
    expect(branchLabel('refs/tags/v1')).toBeNull()
  })
})
