import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/shared/ipc-contracts'
import { setEmitter } from '../../src/backend/events'
import { dispatch, stopWatching } from '../../src/backend/handlers'
import { commit, git, tempDir } from '../fixtures/make-repo'

type Info = { version: number; partial: boolean; total: number }

/** Pestañas instantáneas: todas las pestañas abiertas se vigilan y volver a una no recarga lo que ya está al día. */
describe('pestañas vigiladas', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-tabs-')
  const a = join(tmp.dir, 'a')
  const b = join(tmp.dir, 'b')
  const events: AppEvent[] = []
  const ids = { a: '', b: '' }
  const roots = { a: '', b: '' }

  const ok = async <T>(channel: string, payload: unknown) => {
    const r = await dispatch(channel, payload)
    if (!r.ok) throw new Error(r.error.message)
    return r.data as T
  }
  const changedIn = async (repoId: string, ms: number) => {
    const from = events.length
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (events.slice(from).some((e) => e.type === 'repo:changed' && e.repoId === repoId)) return true
      await new Promise((r) => setTimeout(r, 25))
    }
    return false
  }

  beforeAll(async () => {
    setEmitter((e) => events.push(e))
    for (const [k, d] of [['a', a], ['b', b]] as const) {
      git(tmp.dir, ['init', '-q', '-b', 'main', d])
      commit(d, 'inicio')
      const r = await ok<{ repoId: string; root: string }>('repo:open', { path: d })
      ids[k] = r.repoId
      roots[k] = r.root
      await ok('graph:load', { repoId: ids[k] })
      await ok('repo:watch', { repoId: ids[k] })
    }
  }, 60_000)
  afterAll(() => {
    stopWatching()
    setEmitter(() => {})
    tmp.cleanup()
  })

  it('la pestaña de fondo sigue al día: un commit en A llega aunque B se abrió después', async () => {
    const wait = changedIn(ids.a, 15_000)
    commit(a, 'segundo')
    expect(await wait).toBe(true)
  })

  it('volver a A: responde con lo que hay, completo y sin recargar', async () => {
    await new Promise((r) => setTimeout(r, 1500))
    const before = events.length
    const g = await ok<Info>('graph:load', { repoId: ids.a, reuse: true })
    expect(g).toMatchObject({ partial: false, total: 2 })
    await new Promise((r) => setTimeout(r, 1500))
    expect(events.slice(before).some((e) => e.type === 'graph:full' && e.repoId === ids.a)).toBe(false)
  })

  it('cerrar la pestaña de A deja de vigilarlo; B sigue', async () => {
    expect(await ok('repo:watchKeep', { roots: [roots.b.toUpperCase()] })).toEqual({ watching: 1 })
    const quietA = changedIn(ids.a, 3000)
    commit(a, 'tercero')
    expect(await quietA).toBe(false)
    const waitB = changedIn(ids.b, 15_000)
    commit(b, 'segundo')
    expect(await waitB).toBe(true)
  })
})
