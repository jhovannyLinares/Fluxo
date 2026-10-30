import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Stash, apply, pop, drop y rename contra un repo real. */
describe('stash', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-st-')
  let n = 0
  let d = ''
  let repoId = ''
  const write = (f: string, s: string) => writeFileSync(join(d, f), s)
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const list = () => git(d, ['stash', 'list', '--format=%H|%gs']).trim().split('\n').filter(Boolean)
  const status = () => git(d, ['status', '--porcelain']).trim()

  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'inicio'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  const stash = (extra: object = {}) => call('repo:stash', { includeUntracked: true, ...extra })

  it('stash y pop dejan el árbol igual (con archivo nuevo)', async () => {
    write('a.txt', 'a2\n')
    write('nuevo.txt', 'n\n')
    const before = status()
    const r = await stash({ message: 'mi mensaje' })
    expect(r.ok).toBe(true)
    expect(status()).toBe('')
    expect(list()[0]).toContain('mi mensaje')
    const hash = list()[0]!.split('|')[0]!
    expect((await call('repo:stashApply', { hash, pop: true })).ok).toBe(true)
    expect(status()).toBe(before)
    expect(list()).toHaveLength(0)
  })

  it('sin mensaje se llama «WIP on {rama}», como GitKraken', async () => {
    write('a.txt', 'a2\n')
    await stash()
    expect(list()[0]).toContain('|On main: WIP on main')
  })

  it('sin cambios no crea un stash vacío y lo dice', async () => {
    const r = await stash()
    expect(!r.ok && r.error.message).toMatch(/no hay cambios/i)
    expect(list()).toHaveLength(0)
  })

  it('apply conserva la entrada', async () => {
    write('a.txt', 'a2\n')
    await stash()
    const hash = list()[0]!.split('|')[0]!
    expect((await call('repo:stashApply', { hash, pop: false })).ok).toBe(true)
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('a2\n')
    expect(list()).toHaveLength(1)
  })

  it('stash parcial guarda solo los paths pedidos', async () => {
    write('a.txt', 'a2\n')
    write('b.txt', 'b2\n')
    const r = await stash({ paths: ['a.txt'] })
    expect(r.ok).toBe(true)
    expect(status()).toBe('M b.txt')
    expect(git(d, ['stash', 'show', '--name-only', 'stash@{0}']).trim()).toBe('a.txt')
  })

  it('un path hostil es solo un nombre', async () => {
    write('-f', 'x\n')
    write('a.txt', 'a2\n')
    const r = await stash({ paths: ['-f'] })
    expect(r.ok).toBe(true)
    expect(status()).toBe('M a.txt')
  })

  it('drop borra la entrada pedida aunque haya otras encima', async () => {
    write('a.txt', 'uno\n')
    await stash({ message: 'uno' })
    const viejo = list()[0]!.split('|')[0]!
    write('a.txt', 'dos\n')
    await stash({ message: 'dos' })
    expect((await call('repo:stashDrop', { hash: viejo })).ok).toBe(true)
    expect(list()).toHaveLength(1)
    expect(list()[0]).toContain('dos')
  })

  it('rename cambia el mensaje y conserva el contenido', async () => {
    write('a.txt', 'a2\n')
    await stash({ message: 'viejo' })
    const hash = list()[0]!.split('|')[0]!
    expect((await call('repo:stashRename', { hash, message: 'nuevo' })).ok).toBe(true)
    expect(list()).toHaveLength(1)
    expect(list()[0]!.split('|')[0]).toBe(hash)
    expect(list()[0]).toContain('nuevo')
  })

  it('apply de un solo archivo: trae ese y deja el otro y la entrada', async () => {
    write('a.txt', 'a2\n')
    write('b.txt', 'b2\n')
    await stash()
    const hash = list()[0]!.split('|')[0]!
    expect((await call('repo:stashApply', { hash, pop: false, paths: ['a.txt'] })).ok).toBe(true)
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('a2\n')
    expect(readFileSync(join(d, 'b.txt'), 'utf8')).toBe('b\n')
    expect(status()).toBe('M a.txt')
    expect(list()).toHaveLength(1)
  })

  it('un hash que ya no es un stash se rechaza sin tocar nada', async () => {
    write('a.txt', 'a2\n')
    await stash()
    const head = git(d, ['rev-parse', 'HEAD']).trim()
    const r = await call('repo:stashDrop', { hash: head })
    expect(!r.ok && r.error.message).toMatch(/stash/i)
    expect(list()).toHaveLength(1)
    expect(existsSync(join(d, 'a.txt'))).toBe(true)
  })
})
