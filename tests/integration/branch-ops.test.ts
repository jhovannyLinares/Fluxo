import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Rename, Delete, Set Upstream, Fast-forward, Merge y Rebase contra repos git reales. */
describe('operaciones de rama', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-bo-')
  let n = 0
  let d = ''
  let repoId = ''
  const write = (f: string, s: string) => writeFileSync(join(d, f), s)
  const commit = (f: string, s: string, msg: string) => {
    write(f, s)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
  }
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const branches = () => git(d, ['branch', '--format=%(refname:short)']).trim().split('\n').filter(Boolean)
  const stashes = () => git(d, ['stash', 'list', '--format=%gs']).trim().split('\n').filter(Boolean)
  const head = () => git(d, ['symbolic-ref', '--short', 'HEAD']).trim()

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

  describe('rename', () => {
    it('renombra y conserva el commit', async () => {
      git(d, ['branch', 'vieja'])
      const sha = git(d, ['rev-parse', 'vieja']).trim()
      expect((await call('repo:renameBranch', { from: 'vieja', to: 'nueva' })).ok).toBe(true)
      expect(branches()).toContain('nueva')
      expect(branches()).not.toContain('vieja')
      expect(git(d, ['rev-parse', 'nueva']).trim()).toBe(sha)
    })
    it('rechaza un nombre repetido, inválido o una rama que no existe', async () => {
      git(d, ['branch', 'uno'])
      git(d, ['branch', 'dos'])
      const rep = await call('repo:renameBranch', { from: 'uno', to: 'dos' })
      expect(!rep.ok && rep.error.message).toMatch(/ya existe/)
      const mal = await call('repo:renameBranch', { from: 'uno', to: 'con..puntos' })
      expect(!mal.ok && mal.error.message).toMatch(/no es un nombre válido/)
      const nada = await call('repo:renameBranch', { from: 'fantasma', to: 'otra' })
      expect(!nada.ok && nada.error.message).toMatch(/ya no existe/)
      expect(branches()).toEqual(expect.arrayContaining(['uno', 'dos']))
    })
    it('puede renombrar la rama actual', async () => {
      expect((await call('repo:renameBranch', { from: 'main', to: 'principal' })).ok).toBe(true)
      expect(head()).toBe('principal')
    })
  })

  describe('delete', () => {
    it('borra una rama local', async () => {
      git(d, ['branch', 'x'])
      expect((await call('repo:deleteBranch', { name: 'x' })).ok).toBe(true)
      expect(branches()).not.toContain('x')
    })
    it('no borra la rama actual', async () => {
      const r = await call('repo:deleteBranch', { name: 'main' })
      expect(!r.ok && r.error.message).toMatch(/cambiar de rama/)
      expect(branches()).toContain('main')
    })
    it('borra aunque no esté fusionada (como GitKraken, que ya confirmó)', async () => {
      git(d, ['checkout', '-q', '-b', 'sin-fusionar'])
      commit('b.txt', 'b\n', 'solo aquí')
      git(d, ['checkout', '-q', 'main'])
      expect((await call('repo:deleteBranch', { name: 'sin-fusionar' })).ok).toBe(true)
      expect(branches()).not.toContain('sin-fusionar')
    })
    it('una rama que no existe se dice sin tocar nada', async () => {
      const r = await call('repo:deleteBranch', { name: 'fantasma' })
      expect(!r.ok && r.error.message).toMatch(/ya no existe/)
    })
  })

  describe('set upstream', () => {
    it('asocia la rama a una remota existente', async () => {
      const bare = join(tmp.dir, `bare${n}.git`)
      git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', bare])
      git(d, ['remote', 'add', 'origin', bare])
      git(d, ['push', '-q', 'origin', 'main'])
      git(d, ['branch', 'x'])
      git(d, ['push', '-q', 'origin', 'x'])
      expect((await call('repo:setUpstream', { branch: 'x', remote: 'origin', remoteBranch: 'x' })).ok).toBe(true)
      expect(git(d, ['rev-parse', '--abbrev-ref', 'x@{upstream}']).trim()).toBe('origin/x')
    })
    it('rechaza una remota que no existe', async () => {
      git(d, ['branch', 'x'])
      const r = await call('repo:setUpstream', { branch: 'x', remote: 'origin', remoteBranch: 'x' })
      expect(!r.ok && r.error.message).toMatch(/no existe/)
    })
  })

  describe('integrar', () => {
    const feature = (file = 'b.txt', content = 'b\n') => {
      git(d, ['checkout', '-q', '-b', 'feat'])
      commit(file, content, 'feat')
      git(d, ['checkout', '-q', 'main'])
    }
    it('fast-forward avanza la rama actual', async () => {
      feature()
      const r = await call('repo:integrate', { kind: 'ff', ref: 'refs/heads/feat' })
      expect(r.ok && (r.data as { status: string }).status).toBe('done')
      expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(git(d, ['rev-parse', 'feat']).trim())
    })
    it('fast-forward se niega si no es en línea recta y no toca nada', async () => {
      feature()
      commit('c.txt', 'c\n', 'en main')
      const before = git(d, ['rev-parse', 'HEAD']).trim()
      const r = await call('repo:integrate', { kind: 'ff', ref: 'refs/heads/feat' })
      expect(!r.ok && r.error.message).toMatch(/línea recta|fast-forward/i)
      expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(before)
    })
    it('merge sin conflicto crea el commit de fusión', async () => {
      feature()
      commit('c.txt', 'c\n', 'en main')
      const r = await call('repo:integrate', { kind: 'merge', ref: 'refs/heads/feat' })
      expect(r.ok && (r.data as { status: string }).status).toBe('done')
      expect(git(d, ['rev-list', '--parents', '-n1', 'HEAD']).trim().split(' ')).toHaveLength(3)
    })
    it('merge con conflicto lo deja a medias y Abort lo deshace', async () => {
      feature('a.txt', 'de feat\n')
      commit('a.txt', 'de main\n', 'cambio en main')
      const before = git(d, ['rev-parse', 'HEAD']).trim()
      const r = await call('repo:integrate', { kind: 'merge', ref: 'refs/heads/feat' })
      expect(r.ok && (r.data as { status: string }).status).toBe('conflict')
      expect(existsSync(join(d, '.git', 'MERGE_HEAD'))).toBe(true)
      expect((await call('repo:operation', { action: 'abort' })).ok).toBe(true)
      expect(existsSync(join(d, '.git', 'MERGE_HEAD'))).toBe(false)
      expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(before)
    })
    it('rebase sin conflicto mueve la rama actual encima de la otra', async () => {
      feature()
      git(d, ['checkout', '-q', '-b', 'otra'])
      commit('c.txt', 'c\n', 'otra')
      const r = await call('repo:integrate', { kind: 'rebase', ref: 'refs/heads/feat' })
      expect(r.ok && (r.data as { status: string }).status).toBe('done')
      expect(git(d, ['merge-base', 'feat', 'otra']).trim()).toBe(git(d, ['rev-parse', 'feat']).trim())
      expect(head()).toBe('otra')
    })
    it('rebase con conflicto: Abort vuelve a la rama original', async () => {
      feature('a.txt', 'de feat\n')
      git(d, ['checkout', '-q', '-b', 'otra'])
      commit('a.txt', 'de otra\n', 'otra')
      const before = git(d, ['rev-parse', 'HEAD']).trim()
      const r = await call('repo:integrate', { kind: 'rebase', ref: 'refs/heads/feat' })
      expect(r.ok && (r.data as { status: string }).status).toBe('conflict')
      expect((await call('repo:operation', { action: 'abort' })).ok).toBe(true)
      expect(head()).toBe('otra')
      expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(before)
    })
    it('con cambios sin commit los guarda solos y los reaplica al terminar', async () => {
      feature()
      commit('c.txt', 'c\n', 'en main')
      write('a.txt', 'a\nlocal\n')
      write('nuevo.txt', 'n\n')
      const r = await call('repo:integrate', { kind: 'merge', ref: 'refs/heads/feat' })
      expect(r.ok && (r.data as { status: string }).status).toBe('done')
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('a\nlocal\n')
      expect(existsSync(join(d, 'nuevo.txt'))).toBe(true)
      expect(stashes()).toHaveLength(0)
    })
    it('si el merge choca, los cambios se quedan en «Auto stash before merge…»', async () => {
      feature('a.txt', 'de feat\n')
      commit('a.txt', 'de main\n', 'cambio en main')
      write('b.txt', 'local\n')
      const r = await call('repo:integrate', { kind: 'merge', ref: 'refs/heads/feat' })
      expect(r.ok && (r.data as { status: string }).status).toBe('conflict')
      expect(stashes()[0]).toContain('Auto stash before merge of "main" and "feat"')
      await call('repo:operation', { action: 'abort' })
      expect(stashes()).toHaveLength(1)
    })
    it('un fast-forward imposible devuelve los cambios que había guardado', async () => {
      feature()
      commit('c.txt', 'c\n', 'en main')
      write('a.txt', 'a\nlocal\n')
      const r = await call('repo:integrate', { kind: 'ff', ref: 'refs/heads/feat' })
      expect(r.ok).toBe(false)
      expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('a\nlocal\n')
      expect(stashes()).toHaveLength(0)
    })
    it('no integra si ya hay una operación a medias', async () => {
      feature('a.txt', 'de feat\n')
      commit('a.txt', 'de main\n', 'cambio en main')
      await call('repo:integrate', { kind: 'merge', ref: 'refs/heads/feat' })
      const r = await call('repo:integrate', { kind: 'merge', ref: 'refs/heads/feat' })
      expect(!r.ok && r.error.message).toMatch(/a medias/)
    })
  })
})
