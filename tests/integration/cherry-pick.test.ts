import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Cherry pick de varios commits desde el menú del commit. */
describe('cherry pick', () => {
  const tmp = tempDir('cg-cp-')
  let n = 0
  let d = ''
  let repoId = ''
  const commitFile = (f: string, s: string, msg: string) => {
    writeFileSync(join(d, f), s)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
    return git(d, ['rev-parse', 'HEAD']).trim()
  }
  const pick = (hashes: string[]) => dispatch('repo:cherryPick', { repoId, hashes })

  // repo con main y una rama «agente» de 3 commits; se vuelve a main para elegir commits de la otra rama
  let a: string[] = []
  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    commitFile('base.txt', 'base\n', 'base')
    git(d, ['checkout', '-q', '-b', 'agente'])
    a = [commitFile('uno.txt', '1\n', 'uno'), commitFile('dos.txt', '2\n', 'dos'), commitFile('tres.txt', '3\n', 'tres')]
    git(d, ['checkout', '-q', 'main'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('varios commits, en el orden dado, sobre la rama actual y con su mensaje original', async () => {
    const r = await pick([a[0]!, a[2]!])
    expect(r.ok).toBe(true)
    expect(git(d, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['tres', 'uno', 'base'])
    expect(existsSync(join(d, 'dos.txt'))).toBe(false)
  })

  it('commit que ya está en la rama: se detiene y lo dice', async () => {
    await pick([a[0]!])
    const r = await pick([a[0]!])
    expect(!r.ok && r.error.message).toMatch(/ya está en tu rama/)
  })

  it('commit que ya es parte de la historia de la rama: no toca el repo y lo dice', async () => {
    const base = git(d, ['rev-parse', 'main']).trim()
    const r = await pick([base, a[0]!])
    expect(!r.ok && r.error.message).toMatch(/historia de tu rama/)
    expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(base)
    expect(existsSync(join(d, '.git', 'CHERRY_PICK_HEAD'))).toBe(false)
    expect(git(d, ['status', '--porcelain']).trim()).toBe('')
  })

  it('el menú sabe de antemano qué commits ya están en la rama', async () => {
    const base = git(d, ['rev-parse', 'main']).trim()
    const ask = (hashes: string[]) => dispatch('repo:inHistory', { repoId, hashes })
    expect(await ask([a[0]!, a[1]!])).toEqual({ ok: true, data: { hash: null } })
    expect(await ask([a[0]!, base])).toEqual({ ok: true, data: { hash: base } })
  })

  it('conflicto: error legible y el repo queda en un cherry pick a medias', async () => {
    commitFile('uno.txt', 'otro contenido\n', 'choca')
    const r = await pick([a[0]!])
    expect(!r.ok && r.error.message).toMatch(/conflictos/)
    expect(existsSync(join(d, '.git', 'CHERRY_PICK_HEAD'))).toBe(true)
  })
})
