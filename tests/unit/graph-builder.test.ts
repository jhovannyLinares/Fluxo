import { describe, expect, it } from 'vitest'
import { buildGraph } from '../../src/backend/git/graph-builder'
import type { RawCommit } from '../../src/backend/git/parsers/log'
import type { GraphRow } from '../../src/shared/graph-types'

const c = (hash: string, ...parents: string[]): RawCommit => ({
  hash,
  parents,
  author: 'A',
  email: 'a@x',
  time: 0,
  subject: hash,
  coAuthors: ''
})

/** Columnas con línea en borde inferior de fila r deben coincidir con borde superior de r+1. */
function assertContinuity(rows: GraphRow[]) {
  for (let r = 0; r < rows.length - 1; r++) {
    const bottom = new Set<number>()
    for (const [k, , b] of rows[r]!.segments) if (k === 0 || k === 2) bottom.add(b)
    const top = new Set<number>()
    for (const [k, a] of rows[r + 1]!.segments) if (k === 0 || k === 1) top.add(a)
    expect([...top].sort(), `fila ${r} → ${r + 1}`).toEqual([...bottom].sort())
  }
}

describe('buildGraph', () => {
  it('historial lineal usa un carril', () => {
    const { rows, maxLanes } = buildGraph([c('c', 'b'), c('b', 'a'), c('a')])
    expect(maxLanes).toBe(1)
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    assertContinuity(rows)
  })

  it('rama y merge abren y cierran segundo carril', () => {
    // m = merge(b2, f1); f1 sale de b1
    const { rows, maxLanes } = buildGraph([c('m', 'b2', 'f1'), c('f1', 'b1'), c('b2', 'b1'), c('b1', 'b0'), c('b0')])
    expect(maxLanes).toBe(2)
    expect(rows[0]!.lane).toBe(0)
    expect(rows[1]!.lane).toBe(1) // f1 en carril de rama
    expect(rows[3]!.lane).toBe(0) // b1 vuelve a carril principal
    expect(rows[3]!.segments.some(([k, a, b]) => k === 1 && a === 1 && b === 0)).toBe(true) // rama converge
    assertContinuity(rows)
  })

  it('dos puntas de rama sin hijos', () => {
    const { rows } = buildGraph([c('x', 'a'), c('y', 'a'), c('a')])
    expect(rows[0]!.lane).not.toBe(rows[1]!.lane)
    assertContinuity(rows)
  })

  it('DAG aleatorio grande mantiene continuidad de líneas', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    // genera de padres a hijos y luego invierte (orden topológico: hijos primero)
    const asc: RawCommit[] = [c('h0')]
    const tips = ['h0']
    for (let i = 1; i < 3000; i++) {
      const p = tips[Math.floor(rnd() * tips.length)]!
      const parents = [p]
      if (rnd() < 0.15 && tips.length > 1) {
        const q = tips[Math.floor(rnd() * tips.length)]!
        if (q !== p) parents.push(q)
      }
      const h = `h${i}`
      asc.push(c(h, ...parents))
      for (const x of parents) if (rnd() < 0.7) tips.splice(tips.indexOf(x), 1)
      tips.push(h)
    }
    const { rows } = buildGraph(asc.reverse())
    expect(rows).toHaveLength(3000)
    assertContinuity(rows)
  })
})

describe('rama anclada y colores (H15)', () => {
  // DAG aleatorio con la cadena de primeros padres de `tip` como rama anclada
  function randomDag(n: number, seed0: number) {
    let seed = seed0
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const asc: RawCommit[] = [c('h0')]
    const tips = ['h0']
    for (let i = 1; i < n; i++) {
      const p = tips[Math.floor(rnd() * tips.length)]!
      const parents = [p]
      if (rnd() < 0.15 && tips.length > 1) {
        const q = tips[Math.floor(rnd() * tips.length)]!
        if (q !== p) parents.push(q)
      }
      const h = `h${i}`
      asc.push(c(h, ...parents))
      for (const x of parents) if (rnd() < 0.7) tips.splice(tips.indexOf(x), 1)
      tips.push(h)
    }
    return asc.reverse()
  }

  it('la cadena anclada va siempre en el carril 0 y nadie más lo usa', () => {
    for (const seed of [7, 99, 1234]) {
      const commits = randomDag(2000, seed)
      const byHash = new Map(commits.map((x) => [x.hash, x]))
      // anclar la rama de un commit a media altura
      const chain = new Set<string>()
      for (let h: string | undefined = commits[300]!.hash; h; h = byHash.get(h)?.parents[0]) chain.add(h)
      const { rows } = buildGraph(commits, new Map(), chain)
      for (const r of rows) {
        if (chain.has(r.hash)) expect(r.lane, r.hash).toBe(0)
        else expect(r.lane, r.hash).not.toBe(0)
      }
      // por encima de la punta anclada nada usa el carril 0 (queda libre para ella)
      const tipRow = rows.findIndex((r) => chain.has(r.hash))
      for (const r of rows.slice(0, tipRow)) for (const [, a, b] of r.segments) expect(a !== 0 && b !== 0, r.hash).toBe(true)
      assertContinuity(rows)
    }
  })

  it('el color de una línea depende de su commit, no de cuántas ramas hay antes', () => {
    // la misma rama "main" con y sin otra rama encima
    const base = [c('m3', 'm2'), c('m2', 'm1'), c('m1')]
    const solo = buildGraph(base).rows
    const conOtra = buildGraph([c('x2', 'x1'), c('x1', 'm1'), ...base]).rows
    const color = (rows: GraphRow[], h: string) => rows.find((r) => r.hash === h)!.color
    expect(color(conOtra, 'm3')).toBe(color(solo, 'm3'))
  })
})
