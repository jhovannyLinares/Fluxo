import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** «Create branch here»: rama local nueva en un commit, sin moverse de la actual. */
describe('createBranch', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-br-')
  let n = 0
  let dir = ''
  let repoId = ''
  let first = ''
  const commitFile = (f: string, s: string, msg: string) => {
    writeFileSync(join(dir, f), s)
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', msg])
  }
  const create = (name: string, at: string) => dispatch('repo:createBranch', { repoId, name, at })
  const head = () => git(dir, ['symbolic-ref', '-q', 'HEAD']).trim()

  beforeEach(async () => {
    dir = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', dir])
    commitFile('a.txt', 'uno\n', 'primero')
    first = git(dir, ['rev-parse', 'HEAD']).trim()
    commitFile('a.txt', 'dos\n', 'segundo')
    const open = await dispatch('repo:open', { path: dir })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('crea la rama en ese commit y no cambia de rama', async () => {
    const r = await create('nueva', first)
    expect(r.ok && (r.data as { ref: string }).ref).toBe('refs/heads/nueva')
    expect(git(dir, ['rev-parse', 'refs/heads/nueva']).trim()).toBe(first)
    expect(head()).toBe('refs/heads/main')
  })

  it('un nombre repetido se rechaza y no mueve la rama existente', async () => {
    git(dir, ['branch', 'existe'])
    const before = git(dir, ['rev-parse', 'existe']).trim()
    const r = await create('existe', first)
    expect(!r.ok && r.error.message).toMatch(/ya existe/)
    expect(git(dir, ['rev-parse', 'existe']).trim()).toBe(before)
  })

  it('un nombre que git no admite se rechaza', async () => {
    for (const name of ['con..puntos', 'termina.lock', 'con~tilde', 'con:dos', '@']) {
      const r = await create(name, first)
      expect(!r.ok && r.error.message, name).toMatch(/no es un nombre válido/)
    }
  })

  it('un nombre que parece opción o trae shell no pasa del contrato ni ejecuta nada', async () => {
    expect((await create('-f', first)).ok).toBe(false)
    expect((await create('con espacio', first)).ok).toBe(false)
    const hostil = 'x$(touch${IFS}pwned);echo'
    await create(hostil, first)
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
  })

  it('un commit que no existe se rechaza', async () => {
    const r = await create('fantasma', 'deadbeefdeadbeef')
    expect(!r.ok && r.error.message).toMatch(/commit/)
    expect(git(dir, ['branch', '--list', 'fantasma']).trim()).toBe('')
  })
})
