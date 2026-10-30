import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RefsList } from '../../src/shared/refs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { commit, git, tempDir } from '../fixtures/make-repo'

/** H17: ahead/behind de cada rama coincide con `git rev-list --left-right --count` (3 casos + gone). */
describe('panel de ramas contra repo con remoto (H16, H17)', () => {
  const tmp = tempDir('cg-refs-')
  const server = join(tmp.dir, 'server.git')
  const mine = join(tmp.dir, 'mio')
  const other = join(tmp.dir, 'otro')

  beforeAll(() => {
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', server])
    git(tmp.dir, ['clone', '-q', server, other])
    commit(other, 'base')
    git(other, ['push', '-q', 'origin', 'main'])
    for (const b of ['subir', 'bajar', 'ambas', 'borrada']) git(other, ['push', '-q', 'origin', `main:${b}`])
    git(tmp.dir, ['clone', '-q', server, mine])
    for (const b of ['subir', 'bajar', 'ambas', 'borrada']) git(mine, ['branch', '-q', '--track', b, `origin/${b}`])
    // subir: 2 commits locales sin push
    git(mine, ['checkout', '-q', 'subir'])
    commit(mine, 's1')
    commit(mine, 's2')
    // bajar: 3 commits en el servidor
    git(other, ['checkout', '-q', '-b', 'bajar', 'origin/bajar'])
    for (const m of ['b1', 'b2', 'b3']) commit(other, m)
    git(other, ['push', '-q', 'origin', 'bajar'])
    // ambas: 1 local y 2 en el servidor
    git(mine, ['checkout', '-q', 'ambas'])
    commit(mine, 'a-local')
    git(other, ['checkout', '-q', '-b', 'ambas', 'origin/ambas'])
    commit(other, 'a-r1')
    commit(other, 'a-r2')
    git(other, ['push', '-q', 'origin', 'ambas'])
    // borrada: el upstream desaparece del servidor
    git(other, ['push', '-q', 'origin', '--delete', 'borrada'])
    git(mine, ['checkout', '-q', 'main'])
    git(mine, ['branch', '-q', 'sin-upstream'])
    git(mine, ['tag', 'v1'])
    git(mine, ['stash', 'list'])
    git(mine, ['fetch', '-q', '--prune'])
  }, 60_000) // decenas de procesos git: con la suite en paralelo pasa de los 10 s por defecto
  afterAll(() => tmp.cleanup())

  it('ahead/behind igual a rev-list en cada caso', async () => {
    const open = await dispatch('repo:open', { path: mine })
    if (!open.ok) throw new Error(open.error.message)
    const r = await dispatch('refs:list', { repoId: (open.data as { repoId: string }).repoId })
    if (!r.ok) throw new Error(r.error.message)
    const data = r.data as {
      local: { name: string; upstream: string | null; ahead: number; behind: number; gone: boolean; current: boolean }[]
      remote: { name: string }[]
      tags: { name: string }[]
    }
    const by = Object.fromEntries(data.local.map((b) => [b.name, b]))
    for (const name of ['subir', 'bajar', 'ambas']) {
      const [ahead, behind] = git(mine, ['rev-list', '--left-right', '--count', `${name}...origin/${name}`]).trim().split(/\s+/).map(Number)
      expect([by[name]!.ahead, by[name]!.behind], name).toEqual([ahead, behind])
    }
    expect(by.subir).toMatchObject({ ahead: 2, behind: 0 })
    expect(by.bajar).toMatchObject({ ahead: 0, behind: 3 })
    expect(by.ambas).toMatchObject({ ahead: 1, behind: 2 })
    expect(by.borrada!.gone).toBe(true)
    expect(by['sin-upstream']).toMatchObject({ upstream: null, ahead: 0, behind: 0, gone: false })
    expect(by.main!.current).toBe(true)
    expect(data.remote.map((x) => x.name)).not.toContain('origin/borrada')
    expect(data.tags.map((x) => x.name)).toEqual(['v1'])
  })
})

/** Secciones STASHES y WORKTREES del panel izquierdo. */
describe('stash y worktrees en el panel de ramas', () => {
  const tmp = tempDir('cg-wt-')
  const repo = join(tmp.dir, 'repo')
  const linked = join(tmp.dir, 'repo-agente')

  beforeAll(() => {
    git(tmp.dir, ['init', '-q', '-b', 'main', repo])
    commit(repo, 'base')
    // el ayudante `commit` numera los archivos: se modifica el que quedó en el commit
    const tracked = git(repo, ['ls-files']).trim().split('\n')[0]!
    writeFileSync(join(repo, tracked), 'cambio')
    git(repo, ['stash', 'push', '-q', '-m', 'primero'])
    writeFileSync(join(repo, tracked), 'otro cambio')
    git(repo, ['stash', 'push', '-q', '-m', 'segundo'])
    git(repo, ['worktree', 'add', '-q', '-b', 'agente/tarea', linked])
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('entradas del stash con su mensaje y los worktrees con su rama', async () => {
    const open = await dispatch('repo:open', { path: repo })
    if (!open.ok) throw new Error(open.error.message)
    const r = await dispatch('refs:list', { repoId: (open.data as { repoId: string }).repoId })
    if (!r.ok) throw new Error(r.error.message)
    const data = r.data as RefsList
    expect(data.stashes.map((s) => [s.name, s.message])).toEqual([
      ['stash@{0}', 'On main: segundo'],
      ['stash@{1}', 'On main: primero']
    ])
    expect(data.stashes[0]!.hash).toBe(git(repo, ['rev-parse', 'stash@{0}']).trim())
    expect(data.worktrees.map((w) => [w.branch, w.current])).toEqual([
      ['main', true],
      ['agente/tarea', false]
    ])
  })
})
