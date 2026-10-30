import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CommitDetail } from '../../src/shared/commit'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** H18 contra un repo real: mensaje completo, coautores, archivos, merge de 4 padres, stash y commit raíz. */
describe('detalle de commit (H18)', () => {
  const tmp = tempDir('cg-detail-')
  const d = tmp.dir
  const w = (f: string, s: string | Buffer) => writeFileSync(join(d, f), s)
  let repoId = ''
  const detail = async (rev: string) => {
    const hash = git(d, ['rev-parse', rev]).trim()
    const r = await dispatch('commit:detail', { repoId, hash })
    if (!r.ok) throw new Error(r.error.message)
    return r.data as CommitDetail
  }

  beforeAll(async () => {
    git(d, ['init', '-q', '-b', 'main'])
    w('a.txt', 'uno\ndos\n')
    w('viejo.md', 'contenido que se renombra\n')
    w('borrar.txt', 'adiós\n')
    w('bin.dat', Buffer.from([0, 1, 2, 3, 255, 0, 7]))
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'raíz'])
    w('a.txt', 'uno\ntres\ncuatro\n')
    git(d, ['mv', 'viejo.md', 'nuevo.md'])
    rmSync(join(d, 'borrar.txt'))
    w('bin.dat', Buffer.from([9, 9, 0, 9]))
    w('nuevo.txt', 'n\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'cambios varios\n\nCuerpo largo del agente.\nSegunda línea.\n\nCo-authored-by: Claude <noreply@anthropic.com>'])
    // merge de 4 padres (octopus)
    for (const b of ['b1', 'b2', 'b3']) {
      git(d, ['checkout', '-q', '-b', b, 'main~1'])
      w(`${b}.txt`, b)
      git(d, ['add', '-A'])
      git(d, ['commit', '-q', '-m', b])
    }
    git(d, ['checkout', '-q', 'main'])
    git(d, ['merge', '-q', '-m', 'octopus', 'b1', 'b2', 'b3'])
    w('a.txt', 'guardado en stash\n')
    git(d, ['stash', 'push', '-q', '-m', 'mi stash'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('mensaje completo, coautor y cada tipo de cambio con sus líneas', async () => {
    const c = await detail('main~1')
    expect(c.subject).toBe('cambios varios')
    expect(c.body).toBe('Cuerpo largo del agente.\nSegunda línea.\n\nCo-authored-by: Claude <noreply@anthropic.com>')
    expect(c.coAuthors).toEqual([{ name: 'Claude', email: 'noreply@anthropic.com' }])
    const f = Object.fromEntries(c.files.map((x) => [x.path, x]))
    expect(f['a.txt']).toMatchObject({ status: 'M', additions: 2, deletions: 1, binary: false })
    expect(f['nuevo.md']).toMatchObject({ status: 'R', oldPath: 'viejo.md' })
    expect(f['borrar.txt']).toMatchObject({ status: 'D', deletions: 1 })
    expect(f['bin.dat']).toMatchObject({ status: 'M', binary: true })
    expect(f['nuevo.txt']).toMatchObject({ status: 'A', additions: 1 })
    expect(c.files).toHaveLength(5)
  })

  it('merge de 4 padres: todos los padres y archivos contra el primero (C18)', async () => {
    const c = await detail('main')
    expect(c.parents).toHaveLength(4)
    expect(c.parents[0]).toBe(git(d, ['rev-parse', 'main^1']).trim())
    expect(c.files.map((x) => x.path).sort()).toEqual(['b1.txt', 'b2.txt', 'b3.txt'])
  })

  it('stash con su propio sha (N15) y sus cambios', async () => {
    const c = await detail('stash@{0}')
    expect(c.hash).toBe(git(d, ['rev-parse', 'stash@{0}']).trim())
    expect(c.subject).toContain('mi stash')
    expect(c.files.map((x) => x.path)).toEqual(['a.txt'])
  })

  it('commit raíz: todo añadido', async () => {
    const c = await detail('main~1^')
    expect(c.parents).toEqual([])
    expect(c.files.every((x) => x.status === 'A')).toBe(true)
    expect(c.files.map((x) => x.path).sort()).toEqual(['a.txt', 'bin.dat', 'borrar.txt', 'viejo.md'])
  })

  it('ver todos los archivos del commit (C19)', async () => {
    const hash = git(d, ['rev-parse', 'main~1']).trim()
    const r = await dispatch('commit:tree', { repoId, hash })
    expect(r.ok && (r.data as { paths: string[] }).paths.sort()).toEqual(['a.txt', 'bin.dat', 'nuevo.md', 'nuevo.txt'])
  })

  it('hash inexistente: error legible', async () => {
    const r = await dispatch('commit:detail', { repoId, hash: 'deadbeefdeadbeef' })
    expect(r.ok).toBe(false)
  })
})
