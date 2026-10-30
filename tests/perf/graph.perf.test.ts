import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadGraph } from '../../src/backend/git/repository'
import { makeLargeRepo, tempDir } from '../fixtures/make-repo'

/**
 * Spike S1: ¿carril + canvas aguanta repos grandes?
 * Mide backend (git log + parseo + carriles). Render se mide en app (barra inferior).
 * Meta: 100k commits listos en menos de 1 s de cálculo de grafo.
 */
const TOTAL = 100_000

describe(`spike S1 · ${TOTAL.toLocaleString()} commits`, () => {
  const tmp = tempDir('cg-large-')
  beforeAll(() => makeLargeRepo(tmp.dir, TOTAL))
  afterAll(() => tmp.cleanup())

  it('carga y calcula grafo', async () => {
    const runs: { gitMs: number; buildMs: number }[] = []
    let result = await loadGraph(tmp.dir)
    for (let i = 0; i < 3; i++) {
      result = await loadGraph(tmp.dir)
      runs.push({ gitMs: result.gitMs, buildMs: result.buildMs })
    }
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
    const gitMs = med(runs.map((r) => r.gitMs))
    const buildMs = med(runs.map((r) => r.buildMs))
    const ai = result.rows.filter((r) => r.ai).length
    const firstRuns: number[] = []
    for (let i = 0; i < 3; i++) {
      const p = await loadGraph(tmp.dir, 2000)
      firstRuns.push(p.gitMs + p.buildMs)
    }
    const firstMs = med(firstRuns)
    console.log(
      `\n[S1] commits=${result.rows.length} carriles=${result.maxLanes} IA=${ai} ` +
        `primera-página=${Math.round(firstMs)}ms | completo: git=${Math.round(gitMs)}ms grafo=${Math.round(buildMs)}ms total=${Math.round(gitMs + buildMs)}ms\n`
    )
    expect(result.rows.length).toBe(TOTAL)
    expect(buildMs).toBeLessThan(1000)
    expect(firstMs).toBeLessThan(1000) // meta S1: primera vista < 1 s
  })
})
