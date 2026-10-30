import { EventEmitter } from 'node:events'
import { renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { GraphRow } from '../../src/shared/graph-types'
import type { AppEvent } from '../../src/shared/ipc-contracts'
import { setEmitter } from '../../src/backend/events'
import { dispatch, setWatchOptions, stopWatching } from '../../src/backend/handlers'
import { commit, git, tempDir } from '../fixtures/make-repo'

type Changed = Extract<AppEvent, { type: 'repo:changed' }>

/** H20 contra un repo real: lo hecho en la terminal llega solo, por tipo, y sin una recarga por commit. */
describe('repo en vivo (H20)', () => {
  const tmp = tempDir('cg-live-')
  const d = join(tmp.dir, 'repo')
  const remote = join(tmp.dir, 'remoto.git')
  const other = join(tmp.dir, 'otro')
  const events: AppEvent[] = []
  let repoId = ''

  const ok = async <T>(channel: string, payload: unknown) => {
    const r = await dispatch(channel, payload)
    if (!r.ok) throw new Error(r.error.message)
    return r.data as T
  }
  /**
   * Espera el primer evento que cumpla `pred` a partir de ahora; devuelve el evento y cuánto tardó. 15 s: con la
   * suite entera en paralelo el evento llegó a pasar de 6 s; la meta de < 2 s la mide `npm run bench`.
   */
  const next = async <E extends AppEvent>(pred: (e: AppEvent) => e is E, ms = 15_000) => {
    const from = events.length
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const hit = events.slice(from).find(pred)
      if (hit) return { ev: hit, ms: Date.now() - t0 }
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('el evento no llegó')
  }
  const changed = (kind: string) => (e: AppEvent): e is Changed => e.type === 'repo:changed' && e.kinds.includes(kind as never)
  const quiet = async (ms: number) => {
    let n = -1
    while (n !== events.length) {
      n = events.length
      await new Promise((r) => setTimeout(r, ms))
    }
  }
  const row0 = async () => (await ok<{ rows: GraphRow[] }>('graph:rows', { repoId, offset: 0, limit: 1 })).rows[0]!

  beforeAll(async () => {
    setEmitter((e) => events.push(e))
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', remote])
    git(tmp.dir, ['clone', '-q', remote, d])
    commit(d, 'inicio')
    git(d, ['push', '-q', 'origin', 'main'])
    git(d, ['branch', 'otra'])
    git(tmp.dir, ['clone', '-q', remote, other])
    repoId = (await ok<{ repoId: string }>('repo:open', { path: d })).repoId
    await ok('graph:load', { repoId })
    expect(await ok('repo:watch', { repoId })).toEqual({ mode: 'watching' })
  }, 60_000)
  afterAll(() => {
    stopWatching()
    setEmitter(() => {})
    tmp.cleanup()
  })

  it('commit desde la terminal: grafo nuevo por evento', async () => {
    const before = (await row0()).hash
    const wait = next(changed('refs'))
    commit(d, 'segundo')
    const { ev, ms } = await wait
    expect(ev.graph.total).toBe(2)
    expect((await row0()).hash).not.toBe(before)
    console.log(`commit → evento: ${ms} ms`)
  })

  it('checkout desde la terminal: cambia HEAD', async () => {
    const wait = next(changed('head'))
    git(d, ['checkout', '-q', 'otra'])
    await wait
    const refs = await ok<{ local: { name: string; current: boolean }[] }>('refs:list', { repoId })
    expect(refs.local.find((b) => b.current)?.name).toBe('otra')
    git(d, ['checkout', '-q', 'main'])
    await quiet(1500)
  })

  it('fetch desde la terminal: rama remota nueva', async () => {
    commit(other, 'desde otro clon')
    git(other, ['push', '-q', 'origin', 'main'])
    const wait = next(changed('refs'))
    git(d, ['fetch', '-q'])
    const { ev } = await wait
    expect(ev.graph.total).toBe(3)
    await quiet(1500)
  })

  it('edición sin git add: aparece la fila WIP y luego solo cambian sus conteos (A3)', async () => {
    let wait = next(changed('worktree'))
    writeFileSync(join(d, 'nuevo.txt'), 'a')
    const first = (await wait).ev
    expect(first.graph.total).toBe(4) // 3 commits + WIP
    expect((await row0()).wip).toEqual({ staged: 0, unstaged: 0, untracked: 1 })
    await quiet(1500)
    wait = next(changed('worktree'))
    writeFileSync(join(d, 'otro.txt'), 'b')
    const second = (await wait).ev
    expect(second.graph.total).toBe(4)
    expect(second.graph.version).toBeGreaterThan(first.graph.version)
    // solo la fila WIP: sin git log (la primera, que agregó la fila, sí recargó)
    expect(first.graph.gitMs).toBeGreaterThan(0)
    expect(second.graph.gitMs).toBe(0)
    expect((await row0()).wip).toEqual({ staged: 0, unstaged: 0, untracked: 2 })
    wait = next(changed('refs'))
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'limpia'])
    await wait
    expect((await row0()).kind).toBeUndefined()
    await quiet(1500)
  }, 30_000)

  it('30 commits seguidos no producen 30 recargas', async () => {
    const from = events.length
    for (let i = 0; i < 30; i++) commit(d, `ráfaga ${i}`)
    // con la máquina cargada la primera recarga puede tardar: se espera la que trae los 34 commits
    await next((e): e is Changed => e.type === 'repo:changed' && e.graph.total === 34, 20_000).catch(() => {})
    await quiet(1500)
    const reloads = events.slice(from).filter((e) => e.type === 'repo:changed')
    console.log(`30 commits → ${reloads.length} recargas`)
    expect(reloads.length).toBeGreaterThan(0)
    expect(reloads.length).toBeLessThan(15)
    expect((reloads.at(-1) as Changed).graph.total).toBe(34)
  }, 60_000)

  it('repo movido: aviso y fin de la vigilancia (A4)', async () => {
    const wait = next((e): e is Extract<AppEvent, { type: 'repo:gone' }> => e.type === 'repo:gone')
    renameSync(join(d, '.git'), join(d, '.git-movido'))
    writeFileSync(join(d, 'toque.txt'), 'x')
    const { ev } = await wait
    expect(resolve(ev.root)).toBe(resolve(d))
  })
})

/** A2: si fs.watch no avisa nada, la autoprueba lo detecta, la UI recibe el modo sondeo y los cambios siguen llegando. */
describe('vigilancia sorda (A2)', () => {
  const tmp = tempDir('cg-deaf-')
  const d = tmp.dir
  const events: AppEvent[] = []

  beforeAll(() => {
    setEmitter((e) => events.push(e))
    // fs.watch que nunca emite: como una unidad de red que no manda avisos
    setWatchOptions({ watchImpl: () => Object.assign(new EventEmitter(), { close() {} }) as never, checkMs: 300, pollMs: 300 })
    git(d, ['init', '-q', '-b', 'main'])
    commit(d, 'inicio')
  })
  afterAll(async () => {
    stopWatching()
    setWatchOptions({})
    setEmitter(() => {})
    // un git del sondeo pudo quedar corriendo en la carpeta: Windows no deja borrarla hasta que termine
    await new Promise((r) => setTimeout(r, 1000))
    tmp.cleanup()
  })

  it('avisa el modo sondeo y el commit llega igual', async () => {
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    const repoId = (open.data as { repoId: string }).repoId
    await dispatch('graph:load', { repoId })
    await dispatch('repo:watch', { repoId })
    commit(d, 'segundo')
    const t0 = Date.now()
    while (Date.now() - t0 < 5000 && !events.some((e) => e.type === 'repo:changed')) await new Promise((r) => setTimeout(r, 50))
    expect(events).toContainEqual({ type: 'repo:watch', repoId, mode: 'polling' })
    const ch = events.find((e) => e.type === 'repo:changed') as Extract<AppEvent, { type: 'repo:changed' }>
    expect(ch.graph.total).toBe(2)
  })
})
