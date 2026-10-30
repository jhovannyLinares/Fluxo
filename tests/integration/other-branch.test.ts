import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Pull y Push de una rama que no es la actual (menú de la rama en el panel o en el grafo). */
describe('pull y push de otra rama', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-ob-')
  let n = 0
  let d = ''
  let other = ''
  let bare = ''
  let repoId = ''
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const commit = (dir: string, f: string, msg: string) => {
    writeFileSync(join(dir, f), msg + '\n')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', msg])
  }

  beforeEach(async () => {
    const id = n++
    bare = join(tmp.dir, `bare${id}.git`)
    d = join(tmp.dir, `caso${id}`)
    other = join(tmp.dir, `otro${id}`)
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', bare])
    git(tmp.dir, ['clone', '-q', bare, d])
    git(d, ['checkout', '-q', '-b', 'main'])
    commit(d, 'a.txt', 'inicio')
    git(d, ['push', '-q', '-u', 'origin', 'main'])
    git(d, ['checkout', '-q', '-b', 'feat'])
    commit(d, 'f.txt', 'feat uno')
    git(d, ['push', '-q', '-u', 'origin', 'feat'])
    git(d, ['checkout', '-q', 'main'])
    git(tmp.dir, ['clone', '-q', bare, other])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('pull de otra rama la avanza sin moverte de la actual', async () => {
    git(other, ['checkout', '-q', 'feat'])
    commit(other, 'g.txt', 'feat dos')
    git(other, ['push', '-q', 'origin', 'feat'])
    const r = await call('repo:pullBranch', { branch: 'feat' })
    expect(r.ok).toBe(true)
    expect(git(d, ['rev-parse', 'feat']).trim()).toBe(git(other, ['rev-parse', 'HEAD']).trim())
    expect(git(d, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe('main')
  })

  it('pull de otra rama que divergió se niega y no la toca', async () => {
    git(d, ['checkout', '-q', 'feat'])
    commit(d, 'x.txt', 'local')
    git(d, ['checkout', '-q', 'main'])
    git(other, ['checkout', '-q', 'feat'])
    commit(other, 'g.txt', 'remoto')
    git(other, ['push', '-q', 'origin', 'feat'])
    const before = git(d, ['rev-parse', 'feat']).trim()
    const r = await call('repo:pullBranch', { branch: 'feat' })
    expect(!r.ok && r.error.message).toMatch(/línea recta|fast-forward/i)
    expect(git(d, ['rev-parse', 'feat']).trim()).toBe(before)
  })

  it('push de otra rama sube sus commits a su upstream', async () => {
    git(d, ['checkout', '-q', 'feat'])
    commit(d, 'x.txt', 'local')
    git(d, ['checkout', '-q', 'main'])
    const r = await call('repo:pushBranch', { branch: 'feat' })
    expect(r.ok).toBe(true)
    expect(git(bare, ['rev-parse', 'feat']).trim()).toBe(git(d, ['rev-parse', 'feat']).trim())
  })

  it('push a un destino elegido (soltar X sobre Y) sube X a esa rama remota sin cambiarte de rama', async () => {
    git(d, ['checkout', '-q', 'feat'])
    commit(d, 'x.txt', 'local')
    git(d, ['checkout', '-q', 'main'])
    const r = await call('repo:pushBranch', { branch: 'feat', to: { remote: 'origin', branch: 'otra-remota' } })
    expect(r.ok).toBe(true)
    expect(git(bare, ['rev-parse', 'otra-remota']).trim()).toBe(git(d, ['rev-parse', 'feat']).trim())
    expect(git(d, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe('main')
  })

  it('push a un remoto que no existe se rechaza', async () => {
    const r = await call('repo:pushBranch', { branch: 'feat', to: { remote: 'fantasma', branch: 'x' } })
    expect(!r.ok && r.error.message).toMatch(/no existe/)
  })

  it('sin upstream lo dice y no sube nada', async () => {
    git(d, ['branch', 'suelta'])
    const r = await call('repo:pushBranch', { branch: 'suelta' })
    expect(!r.ok && r.error.message).toMatch(/upstream|remota/i)
    const p = await call('repo:pullBranch', { branch: 'suelta' })
    expect(p.ok).toBe(false)
  })

  it('una rama que no existe se dice', async () => {
    const r = await call('repo:pushBranch', { branch: 'fantasma' })
    expect(!r.ok && r.error.message).toMatch(/ya no existe/)
  })
})
