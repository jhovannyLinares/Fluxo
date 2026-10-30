import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Botón Pull contra un servidor local: las tres variantes y sus fallos legibles. */
describe('pull', () => {
  const tmp = tempDir('cg-pull-')
  let n = 0
  let mine = ''
  let other = ''
  let repoId = ''
  const write = (dir: string, f: string, s: string) => writeFileSync(join(dir, f), s)
  const commitFile = (dir: string, f: string, s: string, msg: string) => {
    write(dir, f, s)
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', msg])
  }
  const pull = (mode: string) => dispatch('repo:pull', { repoId, mode })
  const parents = (dir: string) => git(dir, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ').length - 1

  // cada prueba con su propio servidor y dos clones: «mío» (el que abre Fluxo) y «otro» (empuja cambios)
  beforeEach(async () => {
    const base = join(tmp.dir, `caso${n++}`)
    const server = `${base}-server.git`
    mine = `${base}-mio`
    other = `${base}-otro`
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', server])
    git(tmp.dir, ['clone', '-q', server, other])
    commitFile(other, 'a.txt', 'base\n', 'base')
    git(other, ['push', '-q', 'origin', 'main'])
    git(tmp.dir, ['clone', '-q', server, mine])
    const open = await dispatch('repo:open', { path: mine })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('fast-forward: trae el commit del remoto y avisa que cambió', async () => {
    commitFile(other, 'b.txt', 'b\n', 'remoto')
    git(other, ['push', '-q'])
    const r = await pull('ff')
    expect(r.ok && (r.data as { changed: boolean }).changed).toBe(true)
    expect(git(mine, ['rev-parse', 'HEAD'])).toBe(git(other, ['rev-parse', 'HEAD']))
    const again = await pull('ff')
    expect(again.ok && (again.data as { changed: boolean }).changed).toBe(false)
  })

  it('ramas divergentes: ff-only se niega, ff hace merge sin editor, rebase deja la historia lineal', async () => {
    commitFile(other, 'b.txt', 'b\n', 'remoto')
    git(other, ['push', '-q'])
    commitFile(mine, 'c.txt', 'c\n', 'local')
    const only = await pull('ff-only')
    expect(only.ok).toBe(false)
    expect(!only.ok && only.error.message).toMatch(/sin mezclar/)
    const rebase = await pull('rebase')
    expect(rebase.ok).toBe(true)
    expect(parents(mine)).toBe(1)
    expect(git(mine, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['local', 'remoto', 'base'])
    // otra vez divergentes, ahora con merge
    commitFile(other, 'd.txt', 'd\n', 'remoto 2')
    git(other, ['pull', '-q', '--rebase'])
    git(other, ['push', '-q'])
    commitFile(mine, 'e.txt', 'e\n', 'local 2')
    const merge = await pull('ff')
    expect(merge.ok).toBe(true)
    expect(parents(mine)).toBe(2)
  }, 120_000) // tres pull y un reset de git: en equipos lentos pasan de los 30 s por defecto

  it('conflicto: error legible y el repo queda en un merge a medias', async () => {
    commitFile(other, 'a.txt', 'remoto\n', 'remoto')
    git(other, ['push', '-q'])
    commitFile(mine, 'a.txt', 'local\n', 'local')
    const r = await pull('ff')
    expect(!r.ok && r.error.message).toMatch(/conflictos/)
    expect(existsSync(join(mine, '.git', 'MERGE_HEAD'))).toBe(true)
  })

  it('cambios sin commit que chocan: se guardan solos, el pull avanza y el conflicto conserva el stash; rama sin upstream se dice', async () => {
    commitFile(other, 'a.txt', 'remoto\n', 'remoto')
    git(other, ['push', '-q'])
    write(mine, 'a.txt', 'a medio editar\n')
    const head = git(mine, ['rev-parse', 'HEAD'])
    const dirty = await pull('ff')
    expect(!dirty.ok && dirty.error.message).toMatch(/conflicto/i)
    expect(git(mine, ['rev-parse', 'HEAD'])).not.toBe(head)
    expect(git(mine, ['stash', 'list', '--format=%gs'])).toContain('Auto stash before merge of')
    git(mine, ['reset', '-q', '--hard'])
    git(mine, ['stash', 'drop', '-q'])
    git(mine, ['checkout', '-q', '-b', 'sola'])
    const lone = await pull('ff')
    expect(!lone.ok && lone.error.message).toMatch(/no sigue a ninguna rama remota/)
  }, 90_000)
})
