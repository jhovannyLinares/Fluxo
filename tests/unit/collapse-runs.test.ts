import { describe, expect, it } from 'vitest'
import { buildGraph, collapseRuns } from '../../src/backend/git/graph-builder'
import type { RawCommit } from '../../src/backend/git/parsers/log'
import type { RefLabel } from '../../src/shared/graph-types'

const c = (hash: string, email: string, ...parents: string[]): RawCommit => ({
  hash,
  parents,
  author: email,
  email,
  time: 0,
  subject: hash,
  coAuthors: ''
})
const noRefs = new Map<string, RefLabel[]>()
const shown = (r: ReturnType<typeof collapseRuns>) => r.commits.map((x) => x.hash)

/** Commits seguidos del mismo autor en una sola fila. */
describe('collapseRuns', () => {
  it('una cadena del mismo autor queda en el más nuevo, con los padres del más viejo para la línea', () => {
    const r = collapseRuns([c('d', 'b@x', 'c'), c('c', 'a@x', 'b'), c('b', 'A@x', 'a'), c('a', 'b@x')], noRefs)
    expect(shown(r)).toEqual(['d', 'c', 'a'])
    expect(r.commits[1]!.parents).toEqual(['a'])
    expect(r.groups.get('c')).toEqual({ count: 1, parents: ['b'] })
    expect(r.groups.size).toBe(1)
  })

  it('autores alternados no se agrupan', () => {
    const r = collapseRuns([c('c', 'a@x', 'b'), c('b', 'b@x', 'a'), c('a', 'a@x')], noRefs)
    expect(shown(r)).toEqual(['c', 'b', 'a'])
  })

  it('un commit con etiqueta, un merge o un commit con dos hijos cortan el grupo', () => {
    const refs = new Map<string, RefLabel[]>([['b', [{ name: 'v1', kind: 'tag' }]]])
    // b lleva tag: c no lo esconde, pero b sí agrupa a a, que va debajo
    expect(shown(collapseRuns([c('c', 'a@x', 'b'), c('b', 'a@x', 'a'), c('a', 'a@x')], refs))).toEqual(['c', 'b'])
    // m es merge: el de arriba no lo absorbe
    expect(shown(collapseRuns([c('t', 'a@x', 'm'), c('m', 'a@x', 'x', 'y'), c('x', 'a@x'), c('y', 'b@x')], noRefs))).toEqual([
      't',
      'm',
      'x',
      'y'
    ])
    // b tiene dos hijos (c y f): ninguno de los dos lo esconde
    const fork = [c('f', 'a@x', 'b'), c('c', 'a@x', 'b'), c('b', 'a@x')]
    expect(shown(collapseRuns(fork, noRefs))).toEqual(['f', 'c', 'b'])
  })

  it('el grafo agrupado sigue continuo: la línea baja del grupo al padre del más viejo', () => {
    const r = collapseRuns([c('e', 'b@x', 'd'), c('d', 'a@x', 'c'), c('c', 'a@x', 'b'), c('b', 'a@x', 'a'), c('a', 'b@x')], noRefs)
    const { rows, maxLanes } = buildGraph(r.commits)
    expect(rows.map((x) => x.hash)).toEqual(['e', 'd', 'a'])
    expect(r.groups.get('d')?.count).toBe(2)
    expect(maxLanes).toBe(1)
    expect(rows[1]!.segments).toContainEqual([2, 0, 0, rows[1]!.color])
  })
})
