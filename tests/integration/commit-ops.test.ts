import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Checkout de un commit, Create worktree, Edit message y Drop commit contra repos git reales. */
describe('más operaciones sobre un commit', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-co-')
  let n = 0
  let d = ''
  let repoId = ''
  let c1 = ''
  let c2 = ''
  let c3 = ''
  const write = (f: string, s: string) => writeFileSync(join(d, f), s)
  const commit = (f: string, s: string, msg: string) => {
    write(f, s)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
    return git(d, ['rev-parse', 'HEAD']).trim()
  }
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const head = () => git(d, ['rev-parse', 'HEAD']).trim()
  const subjects = () => git(d, ['log', '--format=%s']).trim().split('\n')

  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    c1 = commit('a.txt', 'uno\n', 'primero')
    c2 = commit('b.txt', 'dos\n', 'segundo')
    c3 = commit('c.txt', 'tres\n', 'tercero')
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  describe('checkout de un commit', () => {
    it('deja HEAD separado en ese commit', async () => {
      expect((await call('repo:checkoutCommit', { hash: c1 })).ok).toBe(true)
      expect(head()).toBe(c1)
      expect(git(d, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD')
    })
    it('un commit que ya no existe se rechaza', async () => {
      const r = await call('repo:checkoutCommit', { hash: 'deadbeef' })
      expect(!r.ok && r.error.message).toMatch(/ya no está/)
    })
    it('con cambios que chocan no toca nada', async () => {
      write('a.txt', 'cambiado\n')
      git(d, ['add', '-A'])
      git(d, ['commit', '-q', '-m', 'cuarto'])
      write('a.txt', 'local\n')
      const r = await call('repo:checkoutCommit', { hash: c1 })
      expect(r.ok).toBe(false)
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('local\n')
    })
  })

  describe('create worktree', () => {
    it('crea la carpeta con la rama o el commit', async () => {
      git(d, ['branch', 'otra', c1])
      const dir = join(tmp.dir, `wt${n}`)
      expect((await call('repo:addWorktree', { path: dir, ref: 'otra' })).ok).toBe(true)
      expect(existsSync(join(dir, 'a.txt'))).toBe(true)
      const dir2 = join(tmp.dir, `wtc${n}`)
      expect((await call('repo:addWorktree', { path: dir2, hash: c2 })).ok).toBe(true)
      expect(existsSync(join(dir2, 'b.txt'))).toBe(true)
      expect(existsSync(join(dir2, 'c.txt'))).toBe(false)
    })
    it('rechaza una carpeta que ya existe', async () => {
      const r = await call('repo:addWorktree', { path: d, ref: 'main' })
      expect(!r.ok && r.error.message).toMatch(/ya existe/)
    })
    it('la rama que ya está abierta se dice, sin tocar nada', async () => {
      const r = await call('repo:addWorktree', { path: join(tmp.dir, `wtm${n}`), ref: 'main' })
      expect(!r.ok && r.error.message).toMatch(/ya está abierta/)
    })
  })

  describe('edit message', () => {
    it('cambia el mensaje del último commit sin tocar el contenido', async () => {
      const tree = git(d, ['rev-parse', 'HEAD^{tree}']).trim()
      expect((await call('repo:editMessage', { hash: c3, message: 'tercero corregido' })).ok).toBe(true)
      expect(subjects()[0]).toBe('tercero corregido')
      expect(git(d, ['rev-parse', 'HEAD^{tree}']).trim()).toBe(tree)
    })
    it('un commit anterior se reescribe y los siguientes se conservan', async () => {
      expect((await call('repo:editMessage', { hash: c2, message: 'segundo corregido' })).ok).toBe(true)
      expect(subjects()).toEqual(['tercero', 'segundo corregido', 'primero'])
    })
    it('un mensaje vacío se rechaza', async () => {
      const r = await call('repo:editMessage', { hash: c3, message: '   ' })
      expect(r.ok).toBe(false)
      expect(subjects()[0]).toBe('tercero')
    })
  })

  describe('drop commit', () => {
    it('quita el commit y conserva los demás', async () => {
      const r = await call('repo:dropCommit', { hash: c2 })
      expect(r.ok && (r.data as { status: string }).status).toBe('done')
      expect(subjects()).toEqual(['tercero', 'primero'])
      expect(existsSync(join(d, 'b.txt'))).toBe(false)
    })
    it('si choca queda a medias y Abort lo deshace', async () => {
      write('b.txt', 'dos cambiado\n')
      git(d, ['add', '-A'])
      git(d, ['commit', '-q', '-m', 'cuarto'])
      const before = head()
      const r = await call('repo:dropCommit', { hash: c2 })
      expect(r.ok && (r.data as { status: string }).status).toBe('conflict')
      expect((await call('repo:operation', { action: 'abort' })).ok).toBe(true)
      expect(head()).toBe(before)
    })
  })
})
