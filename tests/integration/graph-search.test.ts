import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** A2: buscar commits por mensaje, autor, SHA o archivo; mismos commits que git log --grep / --author / -- <ruta>. */
describe('buscar commits', () => {
  const tmp = tempDir('cg-gs-')
  const d = join(tmp.dir, 'repo')
  let repoId = ''
  const commit = (file: string, msg: string, author: string) => {
    writeFileSync(join(d, file), `${msg}\n`)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg], {
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@ejemplo.com`
    })
  }

  beforeAll(async () => {
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    mkdirSync(join(d, 'src'))
    commit('README.md', 'inicio del proyecto', 'Ana')
    commit('src/login.ts', 'agrega el Login', 'Beto')
    commit('src/menu.ts', 'arregla el menú', 'Ana')
    commit('src/login.ts', 'corrige login sin red', 'Carla')
    git(d, ['checkout', '-q', '-b', 'otra'])
    commit('docs.md', 'documenta el login', 'Beto')
    git(d, ['checkout', '-q', 'main'])
    git(d, ['commit', '-q', '--allow-empty', '-m', 'ajusta', '-m', 'detalle oculto en el cuerpo'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
    // la carga completa del grafo
    await dispatch('graph:load', { repoId, filter: { mode: 'all', hidden: [], pinned: null } })
  }, 60_000)
  afterAll(() => tmp.cleanup())

  const found = async (query: string) => {
    const r = await dispatch('graph:search', { repoId, query })
    if (!r.ok) throw new Error(r.error.message)
    const { indices } = r.data as { indices: number[] }
    const rows = await dispatch('graph:rows', { repoId, offset: 0, limit: 1000 })
    if (!rows.ok) throw new Error(rows.error.message)
    const all = (rows.data as { rows: { hash: string }[] }).rows
    return indices.map((i) => all[i]!.hash).sort()
  }
  const gitLog = (args: string[]) => git(d, ['log', '--all', '--format=%H', ...args]).trim().split('\n').filter(Boolean).sort()

  it('por mensaje, sin importar mayúsculas: igual que git log --grep -i', async () => {
    expect(await found('LOGIN')).toEqual(gitLog(['-i', '--grep=login']))
    expect(await found('LOGIN')).toHaveLength(3)
  })

  it('también en el cuerpo del mensaje, que no está en las filas del grafo', async () => {
    expect(await found('OCULTO')).toEqual(gitLog(['-i', '--grep=oculto']))
    expect(await found('OCULTO')).toHaveLength(1)
  })

  it('por autor: igual que git log --author', async () => {
    expect(await found('carla')).toEqual(gitLog(['-i', '--author=carla']))
  })

  it('por SHA abreviado', async () => {
    const h = gitLog(['--grep=menú'])[0]!
    expect(await found(h.slice(0, 8))).toEqual([h])
  })

  it('por archivo con el prefijo archivo:, igual que git log -- <ruta>', async () => {
    expect(await found('archivo:login.ts')).toEqual(gitLog(['--', 'src/login.ts']))
    expect(await found('file:docs')).toEqual(gitLog(['--', 'docs.md']))
  })

  it('sin coincidencias: lista vacía', async () => {
    expect(await found('no-existe-en-ningun-lado')).toEqual([])
  })
})
