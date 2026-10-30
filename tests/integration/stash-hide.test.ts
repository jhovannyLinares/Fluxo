import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** «Hide all stashes» / «Show all stashes»: el grafo deja de dibujar los stashes sin tocar el repo. */
describe('ocultar stashes', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-sh-')
  let d = ''
  let repoId = ''
  const load = async (hidden: string[]) => {
    const r = await dispatch('graph:load', { repoId, filter: { mode: 'all', hidden, pinned: null } })
    if (!r.ok) throw new Error(r.error.message)
    const rows = await dispatch('graph:rows', { repoId, offset: 0, limit: 50 })
    if (!rows.ok) throw new Error(rows.error.message)
    return (rows.data as { rows: { kind?: string; subject: string }[] }).rows
  }

  beforeEach(async () => {
    d = join(tmp.dir, 'caso')
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    writeFileSync(join(d, 'a.txt'), 'a\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'inicio'])
    writeFileSync(join(d, 'a.txt'), 'a2\n')
    git(d, ['stash', 'push', '-q', '-m', 'mi stash'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('sin ocultar, el stash sale en el grafo; ocultando refs/stash, no', async () => {
    expect((await load([])).some((r) => r.kind === 'stash')).toBe(true)
    expect((await load(['refs/stash'])).some((r) => r.kind === 'stash')).toBe(false)
    expect(git(d, ['stash', 'list']).trim()).toContain('mi stash')
  })
})
