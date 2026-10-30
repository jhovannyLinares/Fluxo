import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import type { WipFiles } from '../../src/shared/wip'
import { git, tempDir } from '../fixtures/make-repo'

/** Commit desde la fila WIP: stage y unstage por archivo o de todo, commit y amend, contra un repo real. */
describe('commit desde WIP', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-cw-')
  let n = 0
  let d = ''
  let repoId = ''
  const write = (f: string, s: string) => writeFileSync(join(d, f), s)
  const ok = async <T>(channel: string, payload: object = {}) => {
    const r = await dispatch(channel, { repoId, ...payload })
    if (!r.ok) throw new Error(r.error.message)
    return r.data as T
  }
  const files = () => ok<WipFiles>('wip:files')
  const names = (l: { path: string }[]) => l.map((f) => f.path).sort()

  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    write('a.txt', 'a\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'inicio'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('stage y unstage por archivo; nombres raros son solo nombres', async () => {
    write('a.txt', 'a2\n')
    write('-f', 'opción disfrazada\n')
    // como pathspec, «[a].txt» también tomaría a.txt; literal, solo es ese archivo
    write('[a].txt', 'glob\n')
    await ok('wip:stage', { paths: ['-f', '[a].txt'] })
    let f = await files()
    expect(names(f.staged)).toEqual(['-f', '[a].txt'])
    expect(names(f.unstaged)).toEqual(['a.txt'])
    await ok('wip:unstage', { paths: ['-f'] })
    f = await files()
    expect(names(f.staged)).toEqual(['[a].txt'])
  })

  it('stage de todo incluye nuevos y borrados; quitar todo los devuelve', async () => {
    write('b.txt', 'b\n')
    git(d, ['rm', '-q', '--cached', 'a.txt'])
    await ok('wip:stage')
    expect(names((await files()).unstaged)).toEqual([])
    await ok('wip:unstage')
    expect((await files()).staged).toEqual([])
  })

  it('commit con resumen y descripción; sin nada en stage, se niega', async () => {
    const sin = await dispatch('wip:commit', { repoId, message: 'nada', amend: false })
    expect(!sin.ok && sin.error.message).toMatch(/nada en stage/)
    write('a.txt', 'a2\n')
    await ok('wip:stage', { paths: ['a.txt'] })
    const { hash } = await ok<{ hash: string }>('wip:commit', { message: 'Resumen $(touch pwned)\n\nLa descripción', amend: false })
    expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(hash)
    expect(git(d, ['log', '-1', '--format=%B']).trim()).toBe('Resumen $(touch pwned)\n\nLa descripción')
    expect(existsSync(join(d, 'pwned'))).toBe(false)
  })

  it('amend: trae el mensaje, dice si ya está subido y reemplaza el último commit', async () => {
    const remote = join(tmp.dir, `remoto${n}.git`)
    git(tmp.dir, ['init', '-q', '--bare', remote])
    git(d, ['remote', 'add', 'origin', remote])
    git(d, ['push', '-q', 'origin', 'main'])
    const { last } = await ok<{ last: { summary: string; pushedTo: string | null } }>('wip:lastCommit')
    expect(last).toMatchObject({ summary: 'inicio', pushedTo: 'origin/main' })
    const before = git(d, ['rev-parse', 'HEAD']).trim()
    await ok('wip:commit', { message: 'inicio corregido', amend: true })
    expect(git(d, ['rev-list', '--count', 'HEAD']).trim()).toBe('1')
    expect(git(d, ['rev-parse', 'HEAD']).trim()).not.toBe(before)
    expect(git(d, ['log', '-1', '--format=%s']).trim()).toBe('inicio corregido')
  })

  it('hook que rechaza: no hay commit y el error trae su salida', async () => {
    writeFileSync(join(d, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "falta el ticket" >&2\nexit 1\n', { mode: 0o755 })
    write('a.txt', 'a3\n')
    await ok('wip:stage')
    const r = await dispatch('wip:commit', { repoId, message: 'x', amend: false })
    expect(!r.ok && r.error.gitOutput).toMatch(/falta el ticket/)
    expect(git(d, ['rev-list', '--count', 'HEAD']).trim()).toBe('1')
  })
})
