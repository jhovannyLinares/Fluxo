import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

type Seg = { type: 'text'; lines: string[] } | { type: 'conflict'; ours: string[]; theirs: string[] }

/** Editor de conflictos: bloques, guardar el resultado, tomar un lado y marcar todo como resuelto. */
describe('conflictos', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-cf-')
  let n = 0
  let d = ''
  let repoId = ''
  const commit = (f: string, s: string, msg: string) => {
    writeFileSync(join(d, f), s)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
  }
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const status = () => git(d, ['status', '--porcelain']).trim()
  // merge y rebase con conflicto terminan con código distinto de cero: solo importa el estado en que dejan el repo
  const gitTry = (args: string[]) => {
    try {
      return git(d, args)
    } catch {
      return ''
    }
  }

  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    commit('a.txt', 'uno\ncomún\ncuatro\n', 'base')
    git(d, ['checkout', '-q', '-b', 'otra'])
    commit('a.txt', 'uno\nde otra\ncuatro\n', 'otra')
    git(d, ['checkout', '-q', 'main'])
    commit('a.txt', 'uno\nde main\ncuatro\n', 'main')
    gitTry(['merge', '--no-edit', 'otra'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('el WIP separa los archivos en conflicto de los modificados', async () => {
    const r = await call('wip:files')
    const data = (r.ok ? r.data : null) as { conflicted: { path: string }[]; unstaged: { path: string }[] }
    expect(data.conflicted.map((f) => f.path)).toEqual(['a.txt'])
    expect(data.unstaged.map((f) => f.path)).not.toContain('a.txt')
  })

  it('lee los bloques: el texto común y los dos lados, con sus nombres', async () => {
    const r = await call('conflict:read', { path: 'a.txt' })
    const d2 = (r.ok ? r.data : null) as { segments: Seg[]; ours: { label: string; commit: string | null }; theirs: { label: string; commit: string | null } }
    expect(d2.segments).toEqual([
      { type: 'text', lines: ['uno'] },
      { type: 'conflict', ours: ['de main'], theirs: ['de otra'] },
      { type: 'text', lines: ['cuatro'] }
    ])
    expect(d2.ours.label).toBe('HEAD')
    expect(d2.theirs.label).toBe('otra')
    expect(d2.ours.commit).toMatch(/^[0-9a-f]{7,}$/)
    expect(d2.theirs.commit).toMatch(/^[0-9a-f]{7,}$/)
  })

  it('guardar escribe el resultado y deja el archivo resuelto en el stage', async () => {
    const r = await call('conflict:save', { path: 'a.txt', content: 'uno\nde main\nde otra\ncuatro\n' })
    expect(r.ok).toBe(true)
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('uno\nde main\nde otra\ncuatro\n')
    expect(status()).toBe('M  a.txt')
    const w = await call('wip:files')
    expect(((w.ok ? w.data : null) as { conflicted: unknown[] }).conflicted).toEqual([])
  })

  it('tomar el lado actual o el que entra resuelve el archivo entero', async () => {
    await call('conflict:take', { path: 'a.txt', side: 'theirs' })
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('uno\nde otra\ncuatro\n')
    expect(status()).toBe('M  a.txt')
  })

  it('tomar el lado actual deja lo de la rama actual', async () => {
    await call('conflict:take', { path: 'a.txt', side: 'ours' })
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('uno\nde main\ncuatro\n')
  })

  it('marcar todo como resuelto pone en el stage los archivos en conflicto', async () => {
    writeFileSync(join(d, 'a.txt'), 'uno\nresuelto a mano\ncuatro\n')
    const r = await call('conflict:resolveAll')
    expect(r.ok && (r.data as { count: number }).count).toBe(1)
    expect(status()).toBe('M  a.txt')
  })

  it('una ruta fuera del repo o con .. se rechaza', async () => {
    for (const path of ['../fuera.txt', '.git/config']) {
      expect((await call('conflict:read', { path })).ok).toBe(false)
      expect((await call('conflict:save', { path, content: 'x' })).ok).toBe(false)
    }
  })

  it('un archivo sin conflicto se dice y no se toca', async () => {
    await call('conflict:take', { path: 'a.txt', side: 'ours' })
    const r = await call('conflict:read', { path: 'a.txt' })
    expect(!r.ok && r.error.message).toMatch(/no tiene conflicto/i)
  })

  it('el conflicto de un rebase se lee con los nombres de la rama y del commit', async () => {
    git(d, ['merge', '--abort'])
    gitTry(['rebase', 'otra'])
    const r = await call('conflict:read', { path: 'a.txt' })
    expect(r.ok).toBe(true)
    const t = (r.ok ? r.data : null) as { theirs: { commit: string | null } }
    expect(t.theirs.commit).toMatch(/^[0-9a-f]{7,}$/)
  })
})
