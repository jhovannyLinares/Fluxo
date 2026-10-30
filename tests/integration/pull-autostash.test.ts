import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Pull con cambios sin commit: se guardan solos, se trae lo nuevo y se reaplican (como GitKraken). */
describe('pull con cambios locales', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-pa-')
  let n = 0
  let d = ''
  let other = ''
  let repoId = ''
  const stashes = () => git(d, ['stash', 'list', '--format=%gs']).trim().split('\n').filter(Boolean)
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })

  beforeEach(async () => {
    const id = n++
    const bare = join(tmp.dir, `bare${id}.git`)
    d = join(tmp.dir, `caso${id}`)
    other = join(tmp.dir, `otro${id}`)
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', bare])
    git(tmp.dir, ['clone', '-q', bare, d])
    for (const dir of [d]) {
      git(dir, ['config', 'core.autocrlf', 'false'])
      git(dir, ['checkout', '-q', '-b', 'main'])
    }
    writeFileSync(join(d, 'a.txt'), 'a\n')
    writeFileSync(join(d, 'b.txt'), 'b\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'inicio'])
    git(d, ['push', '-q', '-u', 'origin', 'main'])
    git(tmp.dir, ['clone', '-q', bare, other])
    git(other, ['config', 'core.autocrlf', 'false'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  const upstreamCommit = (file: string, content: string) => {
    writeFileSync(join(other, file), content)
    git(other, ['add', '-A'])
    git(other, ['commit', '-q', '-m', 'remoto'])
    git(other, ['push', '-q', 'origin', 'main'])
  }

  it('cambios que no chocan: se guardan, se trae lo nuevo y se reaplican', async () => {
    upstreamCommit('b.txt', 'b remoto\n')
    writeFileSync(join(d, 'a.txt'), 'a local\n')
    writeFileSync(join(d, 'nuevo.txt'), 'n\n')
    const r = await call('repo:pull', { mode: 'rebase' })
    expect(r.ok).toBe(true)
    expect(readFileSync(join(d, 'b.txt'), 'utf8')).toBe('b remoto\n')
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('a local\n')
    expect(existsSync(join(d, 'nuevo.txt'))).toBe(true)
    expect(stashes()).toHaveLength(0)
  })

  it('cambios que chocan: el pull termina y el conflicto queda con el stash conservado', async () => {
    upstreamCommit('a.txt', 'a remoto\n')
    writeFileSync(join(d, 'a.txt'), 'a local\n')
    const r = await call('repo:pull', { mode: 'rebase' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error.message).toMatch(/conflicto/i)
    expect(git(d, ['log', '-1', '--format=%s']).trim()).toBe('remoto')
    expect(stashes()[0]).toContain('Auto stash before rebase of "main" onto "origin/main"')
  })

  it('sin cambios locales no crea ningún stash', async () => {
    upstreamCommit('b.txt', 'b remoto\n')
    expect((await call('repo:pull', { mode: 'rebase' })).ok).toBe(true)
    expect(stashes()).toHaveLength(0)
  })
})
