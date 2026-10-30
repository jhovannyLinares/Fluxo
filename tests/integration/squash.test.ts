import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Squash de commits seguidos de la rama actual que todavía no se subieron (decisión de Gio del 2026-10-22). */
describe('squash', () => {
  const tmp = tempDir('cg-sq-')
  let n = 0
  let d = ''
  let repoId = ''
  const commitFile = (f: string, s: string, msg: string) => {
    writeFileSync(join(d, f), s)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
    return git(d, ['rev-parse', 'HEAD']).trim()
  }
  const squash = (hashes: string[]) => dispatch('repo:squash', { repoId, hashes })
  const check = (hashes: string[]) => dispatch('repo:squashCheck', { repoId, hashes })
  const subjects = () => git(d, ['log', '--format=%s']).trim().split('\n')

  // main: base (subido a origin) · uno · dos · tres · cuatro (sin subir)
  let c: string[] = []
  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    const base = commitFile('base.txt', 'base\n', 'base')
    git(d, ['update-ref', 'refs/remotes/origin/main', base])
    c = [commitFile('uno.txt', '1\n', 'uno'), commitFile('dos.txt', '2\n', 'dos'), commitFile('tres.txt', '3\n', 'tres'), commitFile('cuatro.txt', '4\n', 'cuatro')]
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('los últimos commits se unen en uno con los mensajes juntos y el mismo árbol', async () => {
    const tree = git(d, ['rev-parse', 'HEAD^{tree}']).trim()
    expect(await check([c[3]!, c[2]!])).toEqual({ ok: true, data: { why: null } })
    expect(await squash([c[3]!, c[2]!])).toEqual({ ok: true, data: { ms: expect.any(Number) } })
    expect(subjects()).toEqual(['tres', 'dos', 'uno', 'base'])
    expect(git(d, ['log', '-1', '--format=%B']).trim()).toBe('tres\n\ncuatro')
    expect(git(d, ['rev-parse', 'HEAD^{tree}']).trim()).toBe(tree)
  })

  it('commits del medio: se unen y los de arriba se vuelven a aplicar encima', async () => {
    const tree = git(d, ['rev-parse', 'HEAD^{tree}']).trim()
    expect(await squash([c[0]!, c[1]!])).toMatchObject({ ok: true })
    expect(subjects()).toEqual(['cuatro', 'tres', 'uno', 'base'])
    expect(git(d, ['rev-parse', 'HEAD^{tree}']).trim()).toBe(tree)
  })

  it('con cambios sin commit, los últimos commits se unen y los cambios quedan', async () => {
    writeFileSync(join(d, 'uno.txt'), 'editado\n')
    expect(await squash([c[2]!, c[3]!])).toMatchObject({ ok: true })
    expect(git(d, ['status', '--porcelain']).trim()).toBe('M uno.txt')
  })

  it('no toca el repo si alguno ya se subió, si no son seguidos o si son uno solo', async () => {
    const head = git(d, ['rev-parse', 'HEAD']).trim()
    git(d, ['update-ref', 'refs/remotes/origin/main', c[0]!])
    const pushed = await squash([c[0]!, c[1]!])
    expect(!pushed.ok && pushed.error.message).toMatch(/ya se subió/)
    const gap = await check([c[1]!, c[3]!])
    expect(gap.ok && (gap.data as { why: string }).why).toMatch(/seguidos/)
    const one = await check([c[3]!])
    expect(one.ok && (one.data as { why: string }).why).toMatch(/dos o más/)
    expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(head)
  })

  it('commits de otra rama: no se pueden unir desde aquí', async () => {
    git(d, ['checkout', '-q', '-b', 'otra', c[0]!])
    const r = await check([c[2]!, c[3]!])
    expect(r.ok && (r.data as { why: string }).why).toMatch(/rama actual/)
  })
})
