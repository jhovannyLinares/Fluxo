import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** A1: historial de un archivo (siguiendo renombres), su diff por commit y blame, contra lo que dice git. */
describe('historial de un archivo', () => {
  const tmp = tempDir('cg-fh-')
  const d = join(tmp.dir, 'repo')
  const nuevo = 'src/canción.txt'
  let repoId = ''
  const write = (f: string, s: string) => writeFileSync(join(d, f), s)
  const commit = (msg: string) => {
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
  }
  const ok = async <T>(p: Promise<{ ok: boolean; data?: unknown; error?: { message: string } }>): Promise<T> => {
    const r = await p
    if (!r.ok) throw new Error(r.error!.message)
    return r.data as T
  }

  // creado, editado, otro archivo, renombrado (con acento y carpeta), editado dos veces
  beforeAll(async () => {
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    write('a.txt', 'uno\n')
    commit('crea a')
    write('a.txt', 'uno\ndos\n')
    commit('edita a')
    write('b.txt', 'otro\n')
    commit('solo b')
    mkdirSync(join(d, 'src'))
    git(d, ['mv', 'a.txt', nuevo])
    commit('renombra a')
    write(nuevo, 'uno\ndos\ntres\n')
    commit('edita canción')
    write(nuevo, 'UNO\ndos\ntres\n')
    commit('cambia la primera')
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  type Entry = { hash: string; subject: string; author: string; path: string; oldPath?: string; status: string }

  it('busca archivos por nombre o ruta, sin importar mayúsculas', async () => {
    const r = await ok<{ paths: string[] }>(dispatch('file:search', { repoId, query: 'CANC' }))
    expect(r.paths).toEqual([nuevo])
    const all = await ok<{ paths: string[] }>(dispatch('file:search', { repoId, query: '' }))
    expect(all.paths.sort()).toEqual(['b.txt', nuevo])
  })

  it('lista los commits que tocaron el archivo, siguiendo el renombre, igual que git log --follow', async () => {
    const r = await ok<{ entries: Entry[] }>(dispatch('file:history', { repoId, path: nuevo }))
    const expected = git(d, ['log', '--follow', '--format=%H', '--', nuevo]).trim().split('\n')
    expect(r.entries.map((e) => e.hash)).toEqual(expected)
    expect(r.entries.map((e) => e.subject)).toEqual(['cambia la primera', 'edita canción', 'renombra a', 'edita a', 'crea a'])
    expect(r.entries[2]).toMatchObject({ status: 'R', path: nuevo, oldPath: 'a.txt' })
    expect(r.entries[3]).toMatchObject({ status: 'M', path: 'a.txt' })
    expect(r.entries[4]).toMatchObject({ status: 'A', path: 'a.txt' })
  })

  it('el diff de cada commit es el de git log --follow -p', async () => {
    const { entries } = await ok<{ entries: Entry[] }>(dispatch('file:history', { repoId, path: nuevo }))
    expect(entries).toHaveLength(5) // control: sin commits, el bucle no compara nada
    // referencia: una sola corrida de git log --follow -p, partida por commit
    const byHash = new Map(
      git(d, ['log', '--follow', '-p', '--format=%x01%H', '--', nuevo])
        .split('\x01')
        .filter(Boolean)
        .map((part) => [part.slice(0, 40), part.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))])
    )
    for (const e of entries) {
      const diff = await ok<{ hunks: { lines: { t: string; text: string }[] }[] }>(
        dispatch('commit:diff', { repoId, hash: e.hash, path: e.path, oldPath: e.oldPath, full: false, ignoreSpace: false })
      )
      const ours = diff.hunks.flatMap((h) => h.lines.filter((l) => l.t !== ' ').map((l) => l.t + l.text))
      expect(ours, e.subject).toEqual(byHash.get(e.hash))
    }
  })

  it('blame dice el commit de cada línea, igual que git blame', async () => {
    const r = await ok<{ lines: { hash: string; author: string; text: string }[] }>(dispatch('file:blame', { repoId, path: nuevo }))
    const expected = git(d, ['blame', '--porcelain', '--', nuevo])
      .split('\n')
      .filter((l) => /^[0-9a-f]{40} \d+ \d+/.test(l))
      .map((l) => l.slice(0, 40))
    expect(r.lines.map((l) => l.hash)).toEqual(expected)
    expect(r.lines.map((l) => l.text)).toEqual(['UNO', 'dos', 'tres'])
  })
})
