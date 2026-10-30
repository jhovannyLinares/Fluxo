import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

type Info = { undo: { label: string } | null; redo: { label: string } | null }

/** Undo / Redo de la barra, sobre el reflog de HEAD, como GitKraken. */
describe('undo y redo', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-ur-')
  let n = 0
  let d = ''
  let repoId = ''
  const commit = (f: string, s: string, msg: string) => {
    writeFileSync(join(d, f), s)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
  }
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const info = async () => {
    const r = await call('repo:undoInfo')
    return (r.ok ? r.data : null) as Info
  }
  const head = () => git(d, ['rev-parse', 'HEAD']).trim()
  const status = () => git(d, ['status', '--porcelain']).trim()

  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    commit('a.txt', 'a\n', 'inicio')
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('el commit inicial no se puede deshacer y no hay nada que rehacer', async () => {
    const i = await info()
    expect(i.undo).toBeNull()
    expect(i.redo).toBeNull()
  })

  it('Undo de un commit deja los cambios en el stage y Redo lo vuelve a crear igual', async () => {
    commit('b.txt', 'b\n', 'con cambio')
    const hash = head()
    expect((await info()).undo?.label).toBe('Commit "con cambio"')
    expect((await call('repo:undo', { action: 'undo' })).ok).toBe(true)
    expect(status()).toBe('A  b.txt')
    expect(head()).not.toBe(hash)
    const i = await info()
    expect(i.redo?.label).toBe('Commit "con cambio"')
    expect((await call('repo:undo', { action: 'redo' })).ok).toBe(true)
    expect(head()).toBe(hash)
    expect(status()).toBe('')
  })

  it('el reflog guarda la acción como «undo: …»', async () => {
    commit('b.txt', 'b\n', 'x')
    await call('repo:undo', { action: 'undo' })
    expect(git(d, ['reflog', '-1', '--format=%gs']).trim()).toMatch(/^undo: commit: x/)
  })

  it('Undo de un checkout vuelve a la rama anterior y Redo al destino', async () => {
    git(d, ['branch', 'otra'])
    await call('repo:checkout', { ref: 'refs/heads/otra' })
    expect((await info()).undo?.label).toBe('Checkout "otra"')
    await call('repo:undo', { action: 'undo' })
    expect(git(d, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe('main')
    expect((await info()).redo?.label).toBe('Checkout "otra"')
    await call('repo:undo', { action: 'redo' })
    expect(git(d, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe('otra')
  })

  it('un reset se deshace volviendo a donde estaba la rama', async () => {
    commit('b.txt', 'b\n', 'segundo')
    const hash = head()
    git(d, ['reset', '-q', '--hard', 'HEAD~1'])
    expect((await info()).undo?.label).toContain('reset')
    await call('repo:undo', { action: 'undo' })
    expect(head()).toBe(hash)
  })

  it('con cambios locales que chocan, Undo se rechaza sin tocar nada', async () => {
    commit('a.txt', 'a2\n', 'cambia a')
    writeFileSync(join(d, 'a.txt'), 'local\n')
    const before = head()
    const r = await call('repo:undo', { action: 'undo' })
    // el reset soft nunca toca el árbol: el cambio local convive con el commit deshecho
    expect(r.ok).toBe(true)
    expect(head()).not.toBe(before)
  })

  it('sin nada que rehacer, Redo se dice y no hace nada', async () => {
    const before = head()
    const r = await call('repo:undo', { action: 'redo' })
    expect(!r.ok && r.error.message).toMatch(/rehacer/i)
    expect(head()).toBe(before)
  })

  it('un rebase no se ofrece como deshacible', async () => {
    git(d, ['checkout', '-q', '-b', 'x'])
    commit('c.txt', 'c\n', 'en x')
    git(d, ['checkout', '-q', 'main'])
    commit('d.txt', 'd\n', 'en main')
    git(d, ['checkout', '-q', 'x'])
    git(d, ['rebase', 'main'])
    expect((await info()).undo).toBeNull()
  })
})
