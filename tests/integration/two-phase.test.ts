import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/shared/ipc-contracts'
import type { GraphRow } from '../../src/shared/graph-types'
import { setEmitter } from '../../src/backend/events'
import { dispatch, FIRST_PAGE } from '../../src/backend/handlers'
import { makeLargeRepo, tempDir } from '../fixtures/make-repo'

describe('carga en dos fases', () => {
  const tmp = tempDir('cg-two-')
  const TOTAL = FIRST_PAGE + 600
  beforeAll(() => makeLargeRepo(tmp.dir, TOTAL, 9))
  afterAll(() => tmp.cleanup())

  it('primera página parcial y luego evento con historial completo', async () => {
    const events: AppEvent[] = []
    const full = new Promise<void>((resolve) =>
      setEmitter((e) => {
        events.push(e)
        resolve()
      })
    )
    const open = await dispatch('repo:open', { path: tmp.dir })
    if (!open.ok) throw new Error(open.error.message)
    const repoId = (open.data as { repoId: string }).repoId

    const first = await dispatch('graph:load', { repoId })
    if (!first.ok) throw new Error(first.error.message)
    const f = first.data as { total: number; partial: boolean; version: number }
    expect(f.partial).toBe(true)
    expect(f.total).toBe(FIRST_PAGE)
    const page = await dispatch('graph:rows', { repoId, offset: 0, limit: 2000 })
    const firstRows = page.ok ? (page.data as { rows: GraphRow[] }).rows : []

    await full
    const ev = events[0]!
    expect(ev.type).toBe('graph:full')
    if (ev.type !== 'graph:full') return
    expect(ev.total).toBe(TOTAL)
    expect(ev.version).toBeGreaterThan(f.version)

    // carriles de primera página coinciden con grafo completo
    const after = await dispatch('graph:rows', { repoId, offset: 0, limit: 2000 })
    const fullRows = after.ok ? (after.data as { rows: GraphRow[] }).rows : []
    const pick = (r: GraphRow) => [r.hash, r.lane, JSON.stringify(r.segments)]
    expect(fullRows.slice(0, 1500).map(pick)).toEqual(firstRows.slice(0, 1500).map(pick))
  })
})

describe('volver a un repo ya cargado (N12)', () => {
  const tmp = tempDir('cg-reuse-')
  beforeAll(() => makeLargeRepo(tmp.dir, 300, 3))
  afterAll(() => tmp.cleanup())

  it('responde al instante con lo cargado y recarga en segundo plano', async () => {
    const open = await dispatch('repo:open', { path: tmp.dir })
    if (!open.ok) throw new Error(open.error.message)
    const repoId = (open.data as { repoId: string }).repoId
    // reuse sin nada cargado: carga normal
    const first = await dispatch('graph:load', { repoId, reuse: true })
    if (!first.ok) throw new Error(first.error.message)
    const f = first.data as { total: number; gitMs: number; version: number }
    expect(f.total).toBe(300)
    expect(f.gitMs).toBeGreaterThan(0)

    const events: AppEvent[] = []
    const full = new Promise<void>((resolve) =>
      setEmitter((e) => {
        events.push(e)
        resolve()
      })
    )
    const t0 = performance.now()
    const again = await dispatch('graph:load', { repoId, reuse: true })
    const ms = performance.now() - t0
    if (!again.ok) throw new Error(again.error.message)
    const a = again.data as { total: number; gitMs: number; partial: boolean; version: number }
    // sin lanzar git: misma versión, filas en memoria siguen sirviendo
    expect(a).toMatchObject({ total: 300, gitMs: 0, partial: true, version: f.version })
    expect(ms).toBeLessThan(f.gitMs)
    const rows = await dispatch('graph:rows', { repoId, offset: 0, limit: 10 })
    expect(rows.ok && (rows.data as { version: number }).version).toBe(f.version)

    // recarga en segundo plano: llega graph:full con versión nueva
    await full
    expect(events[0]).toMatchObject({ type: 'graph:full', repoId, total: 300, version: f.version + 1 })
  })
})
