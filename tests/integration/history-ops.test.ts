import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Reset (soft/mixed/hard), Revert y etiquetas «Create tag here» contra repos git reales. */
describe('operaciones sobre un commit', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-ho-')
  let n = 0
  let d = ''
  let repoId = ''
  let c1 = ''
  let c2 = ''
  const write = (f: string, s: string) => writeFileSync(join(d, f), s)
  const commit = (f: string, s: string, msg: string) => {
    write(f, s)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
    return git(d, ['rev-parse', 'HEAD']).trim()
  }
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const head = () => git(d, ['rev-parse', 'HEAD']).trim()
  const status = () => git(d, ['status', '--porcelain']).trim()

  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    c1 = commit('a.txt', 'uno\n', 'primero')
    c2 = commit('a.txt', 'dos\n', 'segundo')
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  describe('reset', () => {
    it('soft mueve la rama y deja los cambios en el stage', async () => {
      expect((await call('repo:reset', { hash: c1, mode: 'soft' })).ok).toBe(true)
      expect(head()).toBe(c1)
      expect(status()).toBe('M  a.txt')
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('dos\n')
    })
    it('mixed mueve la rama y deja los cambios sin stage', async () => {
      await call('repo:reset', { hash: c1, mode: 'mixed' })
      expect(head()).toBe(c1)
      expect(status()).toBe('M a.txt')
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('dos\n')
    })
    it('hard descarta los cambios', async () => {
      write('a.txt', 'sucio\n')
      await call('repo:reset', { hash: c1, mode: 'hard' })
      expect(head()).toBe(c1)
      expect(status()).toBe('')
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('uno\n')
    })
    it('un commit que ya no existe se rechaza sin tocar nada', async () => {
      const r = await call('repo:reset', { hash: 'deadbeef', mode: 'hard' })
      expect(!r.ok && r.error.message).toMatch(/ya no está/)
      expect(head()).toBe(c2)
    })
  })

  describe('revert', () => {
    it('crea un commit que deshace el cambio', async () => {
      expect((await call('repo:revert', { hash: c2 })).ok).toBe(true)
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('uno\n')
      expect(git(d, ['log', '-1', '--format=%s']).trim()).toMatch(/^Revert "segundo"/)
    })
    it('con cambios sin commit que chocan, los guarda y los devuelve', async () => {
      write('b.txt', 'local\n')
      expect((await call('repo:revert', { hash: c2 })).ok).toBe(true)
      expect(existsSync(join(d, 'b.txt'))).toBe(true)
    })
    it('si choca deja el revert a medias y Abort lo deshace', async () => {
      commit('a.txt', 'tres\n', 'tercero')
      const before = head()
      const r = await call('repo:revert', { hash: c2 })
      expect(r.ok && (r.data as { status: string }).status).toBe('conflict')
      expect(existsSync(join(d, '.git', 'REVERT_HEAD'))).toBe(true)
      expect((await call('repo:operation', { action: 'abort' })).ok).toBe(true)
      expect(head()).toBe(before)
    })
  })

  describe('tags', () => {
    it('crea una etiqueta ligera en el commit', async () => {
      expect((await call('repo:createTag', { hash: c1, name: 'v1' })).ok).toBe(true)
      expect(git(d, ['rev-parse', 'v1^{commit}']).trim()).toBe(c1)
      expect(git(d, ['cat-file', '-t', 'v1']).trim()).toBe('commit')
    })
    it('crea una etiqueta anotada con su mensaje', async () => {
      expect((await call('repo:createTag', { hash: c1, name: 'v2', message: 'primera versión' })).ok).toBe(true)
      expect(git(d, ['cat-file', '-t', 'v2']).trim()).toBe('tag')
      expect(git(d, ['tag', '-l', '--format=%(contents:subject)', 'v2']).trim()).toBe('primera versión')
    })
    it('rechaza un nombre repetido o inválido sin mover la etiqueta', async () => {
      git(d, ['tag', 'v1', c1])
      const rep = await call('repo:createTag', { hash: c2, name: 'v1' })
      expect(!rep.ok && rep.error.message).toMatch(/ya existe/)
      expect(git(d, ['rev-parse', 'v1^{commit}']).trim()).toBe(c1)
      const mal = await call('repo:createTag', { hash: c2, name: 'con..puntos' })
      expect(!mal.ok && mal.error.message).toMatch(/no es un nombre válido/)
    })
  })
})
