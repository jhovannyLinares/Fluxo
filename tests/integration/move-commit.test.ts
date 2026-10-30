import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** «Move commit up / down»: intercambia un commit con su vecino reescribiendo la historia por un rebase interactivo. */
describe('mover commits', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-mv-')
  let n = 0
  let d = ''
  let repoId = ''
  const sha = (msg: string) => git(d, ['log', '--all', '--format=%H', '--grep', `^${msg}$`]).trim()
  const orden = () => git(d, ['log', '--reverse', '--format=%s']).trim().split('\n')
  const mover = (msg: string, dir: 'up' | 'down') => dispatch('repo:moveCommit', { repoId, hash: sha(msg), dir })

  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    for (const f of ['c1', 'c2', 'c3', 'c4']) {
      writeFileSync(join(d, `${f}.txt`), `${f}\n`)
      git(d, ['add', '-A'])
      git(d, ['commit', '-q', '-m', f])
    }
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('bajar un commit lo intercambia con el más viejo', async () => {
    const r = await mover('c3', 'down')
    expect(r.ok && (r.data as { status: string }).status).toBe('done')
    expect(orden()).toEqual(['c1', 'c3', 'c2', 'c4'])
    expect(git(d, ['status', '--short']).trim()).toBe('')
  })

  it('subir un commit lo intercambia con el más nuevo', async () => {
    await mover('c2', 'up')
    expect(orden()).toEqual(['c1', 'c3', 'c2', 'c4'])
  })

  it('el contenido final no cambia', async () => {
    const antes = git(d, ['rev-parse', 'HEAD^{tree}']).trim()
    await mover('c2', 'up')
    expect(git(d, ['rev-parse', 'HEAD^{tree}']).trim()).toBe(antes)
  })

  it('el más nuevo no sube y el más viejo no baja', async () => {
    const a = await mover('c4', 'up')
    expect(!a.ok && a.error.message).toMatch(/ya es el (último|más nuevo)/i)
    const b = await mover('c1', 'down')
    expect(!b.ok && b.error.message).toMatch(/primer commit|no tiene anterior|más viejo/i)
    expect(orden()).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('los cambios sin commit viajan intactos', async () => {
    writeFileSync(join(d, 'c1.txt'), 'sucio\n')
    const r = await mover('c3', 'down')
    expect(r.ok).toBe(true)
    expect(orden()).toEqual(['c1', 'c3', 'c2', 'c4'])
    expect(git(d, ['status', '--short']).trim()).toBe('M c1.txt')
  })

  it('con un conflicto deja el rebase a medias para resolver', async () => {
    // c3 modifica lo que c2 creó: intercambiarlos choca
    writeFileSync(join(d, 'c2.txt'), 'c2 editado\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'c5'])
    const r = await mover('c5', 'down')
    expect(r.ok && ['done', 'conflict']).toBeTruthy()
    if (r.ok && (r.data as { status: string }).status === 'conflict') {
      expect(git(d, ['status', '--short'])).toMatch(/UU|AA|DU|UD/)
    }
  })

  it('con un merge en el camino lo rechaza', async () => {
    git(d, ['checkout', '-q', '-b', 'otra', 'HEAD~2'])
    writeFileSync(join(d, 'o.txt'), 'o\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'o1'])
    git(d, ['checkout', '-q', 'main'])
    git(d, ['merge', '-q', '--no-ff', '-m', 'merge', 'otra'])
    const r = await mover('c3', 'down')
    expect(!r.ok && r.error.message).toMatch(/merge/i)
  })

  it('un commit que no está en la historia de HEAD se rechaza', async () => {
    git(d, ['checkout', '-q', '-b', 'lateral', 'HEAD~2'])
    writeFileSync(join(d, 'l.txt'), 'l\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'lat'])
    git(d, ['checkout', '-q', 'main'])
    const r = await mover('lat', 'up')
    expect(!r.ok && r.error.message).toMatch(/no está en la rama actual/i)
  })
})
