import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Borrar y subir tags, y «Restore file from this commit». */
describe('tags y restaurar archivos', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-tr-')
  let n = 0
  let d = ''
  let bare = ''
  let repoId = ''
  let c1 = ''
  const commit = (f: string, s: string, msg: string) => {
    writeFileSync(join(d, f), s)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
    return git(d, ['rev-parse', 'HEAD']).trim()
  }
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const tagsLocal = () => git(d, ['tag']).trim().split('\n').filter(Boolean)
  const tagsRemote = () => git(bare, ['tag']).trim().split('\n').filter(Boolean)

  beforeEach(async () => {
    const id = n++
    bare = join(tmp.dir, `bare${id}.git`)
    d = join(tmp.dir, `caso${id}`)
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', bare])
    git(tmp.dir, ['clone', '-q', bare, d])
    git(d, ['checkout', '-q', '-b', 'main'])
    git(d, ['config', 'core.autocrlf', 'false'])
    c1 = commit('a.txt', 'uno\n', 'primero')
    commit('a.txt', 'dos\n', 'segundo')
    git(d, ['push', '-q', '-u', 'origin', 'main'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('Push tag sube la etiqueta y Delete la borra local y remota', async () => {
    git(d, ['tag', 'v1', c1])
    expect(tagsRemote()).toEqual([])
    expect((await call('repo:pushTag', { name: 'v1' })).ok).toBe(true)
    expect(tagsRemote()).toEqual(['v1'])
    expect((await call('repo:deleteTag', { name: 'v1', scope: 'both', remote: 'origin' })).ok).toBe(true)
    expect(tagsLocal()).toEqual([])
    expect(tagsRemote()).toEqual([])
  })

  it('borrar solo la local deja la remota, y borrar solo la remota deja la local', async () => {
    git(d, ['tag', 'a', c1]); git(d, ['tag', 'b', c1])
    git(d, ['push', '-q', 'origin', 'a', 'b'])
    await call('repo:deleteTag', { name: 'a', scope: 'local' })
    expect(tagsLocal()).toEqual(['b'])
    expect(tagsRemote().sort()).toEqual(['a', 'b'])
    await call('repo:deleteTag', { name: 'b', scope: 'remote', remote: 'origin' })
    expect(tagsLocal()).toEqual(['b'])
    expect(tagsRemote()).toEqual(['a'])
  })

  it('una etiqueta que no existe o un nombre hostil se rechazan', async () => {
    const r = await call('repo:deleteTag', { name: 'fantasma', scope: 'local' })
    expect(!r.ok && r.error.message).toMatch(/ya no existe/)
    expect((await call('repo:deleteTag', { name: '-d', scope: 'local' })).ok).toBe(false)
    expect((await call('repo:pushTag', { name: 'fantasma' })).ok).toBe(false)
  })

  it('el panel dice qué tags están solo en local', async () => {
    git(d, ['tag', 'subido', c1]); git(d, ['tag', 'local', c1])
    git(d, ['push', '-q', 'origin', 'subido'])
    const r = await call('repo:tagsOnRemote')
    expect(r.ok && (r.data as { names: string[] }).names).toEqual(['subido'])
  })

  it('Restore file trae el archivo de ese commit sin tocar el resto ni el stage', async () => {
    writeFileSync(join(d, 'b.txt'), 'nuevo\n')
    git(d, ['add', '-A'])
    expect((await call('wip:restore', { hash: c1, paths: ['a.txt'] })).ok).toBe(true)
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('uno\n')
    expect(existsSync(join(d, 'b.txt'))).toBe(true)
    expect(git(d, ['status', '--porcelain']).split('\n').filter(Boolean).sort()).toEqual([' M a.txt', 'A  b.txt'])
  })

  it('Restore de un archivo que ese commit no tiene se dice y no toca nada', async () => {
    const r = await call('wip:restore', { hash: c1, paths: ['no-existe.txt'] })
    expect(!r.ok && r.error.message).toMatch(/no tiene ese archivo/i)
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('dos\n')
  })

  it('Restore rechaza rutas fuera del repo', async () => {
    expect((await call('wip:restore', { hash: c1, paths: ['../fuera.txt'] })).ok).toBe(false)
    expect((await call('wip:restore', { hash: c1, paths: ['.git/config'] })).ok).toBe(false)
  })
})
