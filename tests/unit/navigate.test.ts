import { describe, expect, it } from 'vitest'
import type { GraphRow } from '../../src/shared/graph-types'
import { branchNeighbor } from '../../src/backend/git/navigate'

/** H12: Shift+↑/↓ sigue la rama por primer padre. */
const row = (hash: string, parents: string[]): GraphRow => ({
  hash,
  parents,
  author: 'a',
  email: 'a@x',
  time: 0,
  subject: hash,
  ai: false,
  lane: 0,
  color: 0,
  segments: [],
  refs: []
})

// orden topológico: M = merge(C, F); F en rama, C y B en main
//   0 M (C, F)
//   1 F (B)      ← rama
//   2 C (B)
//   3 B (A)
//   4 A
const rows = [row('M', ['C', 'F']), row('F', ['B']), row('C', ['B']), row('B', ['A']), row('A', [])]

describe('navegar por la rama', () => {
  it('bajar = primer padre, aunque haya filas de otra rama en medio', () => {
    expect(branchNeighbor(rows, 0, 'parent')).toBe(2) // M → C, salta F
    expect(branchNeighbor(rows, 1, 'parent')).toBe(3) // F → B
    expect(branchNeighbor(rows, 4, 'parent')).toBeNull() // raíz
  })

  it('subir = hijo más cercano que lo tiene como primer padre', () => {
    expect(branchNeighbor(rows, 2, 'child')).toBe(0) // C → M
    expect(branchNeighbor(rows, 3, 'child')).toBe(2) // B → C (el más cercano por arriba)
    expect(branchNeighbor(rows, 1, 'child')).toBeNull() // F solo es segundo padre de M
    expect(branchNeighbor(rows, 0, 'child')).toBeNull() // punta
  })

  it('índice fuera de rango o padre no cargado: null', () => {
    expect(branchNeighbor(rows, 99, 'parent')).toBeNull()
    expect(branchNeighbor([row('X', ['fuera'])], 0, 'parent')).toBeNull()
  })
})
