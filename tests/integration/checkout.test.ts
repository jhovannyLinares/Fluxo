import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Doble clic sobre una rama: cambiar a ella, como en GitKraken. */
describe('checkout', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-co-')
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
  const checkout = (ref: string) => dispatch('repo:checkout', { repoId, ref })
  const head = () => git(mine, ['symbolic-ref', '-q', 'HEAD']).trim()
  const hostil = 'x$(touch${IFS}pwned);echo'

  // servidor con main, «otra» y una rama de nombre hostil; «mío» (el que abre Fluxo) solo tiene main local
  beforeEach(async () => {
    const base = join(tmp.dir, `caso${n++}`)
    const server = `${base}-server.git`
    mine = `${base}-mio`
    other = `${base}-otro`
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', server])
    git(tmp.dir, ['clone', '-q', server, other])
    commitFile(other, 'a.txt', 'base\n', 'base')
    git(other, ['push', '-q', 'origin', 'main'])
    git(other, ['checkout', '-q', '-b', 'otra'])
    commitFile(other, 'a.txt', 'de otra\n', 'otra')
    git(other, ['push', '-q', 'origin', 'otra'])
    git(other, ['checkout', '-q', '-b', hostil, 'main'])
    git(other, ['push', '-q', 'origin', hostil])
    git(tmp.dir, ['clone', '-q', server, mine])
    const open = await dispatch('repo:open', { path: mine })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('rama remota sin local: crea la local que la sigue y cambia a ella', async () => {
    const r = await checkout('refs/remotes/origin/otra')
    expect(r.ok && (r.data as { changed: boolean }).changed).toBe(true)
    expect(head()).toBe('refs/heads/otra')
    expect(git(mine, ['rev-parse', '--abbrev-ref', '@{u}']).trim()).toBe('origin/otra')
  })

  it('rama local: cambia a ella; la actual no hace nada', async () => {
    git(mine, ['branch', 'local-sola'])
    expect((await checkout('refs/heads/local-sola')).ok).toBe(true)
    expect(head()).toBe('refs/heads/local-sola')
    const again = await checkout('refs/heads/local-sola')
    expect(again.ok && (again.data as { changed: boolean }).changed).toBe(false)
  })

  it('remota con local atrasada: avanza la local (fast-forward) y cambia a ella', async () => {
    await checkout('refs/remotes/origin/otra')
    await checkout('refs/heads/main')
    commitFile(other, 'b.txt', 'b\n', 'otra 2')
    git(other, ['push', '-q', 'origin', 'otra'])
    git(mine, ['fetch', '-q'])
    expect((await checkout('refs/remotes/origin/otra')).ok).toBe(true)
    expect(head()).toBe('refs/heads/otra')
    expect(git(mine, ['rev-parse', 'otra'])).toBe(git(mine, ['rev-parse', 'origin/otra']))
  })

  it('remota con local divergente: cambia a la local sin moverla', async () => {
    await checkout('refs/remotes/origin/otra')
    commitFile(mine, 'c.txt', 'c\n', 'local')
    const local = git(mine, ['rev-parse', 'HEAD'])
    await checkout('refs/heads/main')
    commitFile(other, 'b.txt', 'b\n', 'remoto')
    git(other, ['push', '-q', 'origin', 'otra'])
    git(mine, ['fetch', '-q'])
    expect((await checkout('refs/remotes/origin/otra')).ok).toBe(true)
    expect(git(mine, ['rev-parse', 'HEAD'])).toBe(local)
  })

  it('nombre hostil: cambia sin ejecutar nada', async () => {
    const r = await checkout(`refs/remotes/origin/${hostil}`)
    expect(r.ok).toBe(true)
    expect(head()).toBe(`refs/heads/${hostil}`)
    expect(existsSync(join(mine, 'pwned'))).toBe(false)
  })

  it('cambios sin commit que chocan: no toca nada y lo dice', async () => {
    write(mine, 'a.txt', 'a medio editar\n')
    const r = await checkout('refs/remotes/origin/otra')
    expect(!r.ok && r.error.message).toMatch(/cambios sin commit/)
    expect(head()).toBe('refs/heads/main')
  })

  it('rama abierta en otro worktree u operación a medias: se niega antes de tocar el repo', async () => {
    git(mine, ['worktree', 'add', '-q', join(tmp.dir, `wt${n}`), '-b', 'en-wt'])
    const wt = await checkout('refs/heads/en-wt')
    expect(!wt.ok && wt.error.message).toMatch(/otro worktree/)
    writeFileSync(join(mine, '.git', 'MERGE_HEAD'), git(mine, ['rev-parse', 'HEAD']))
    const op = await checkout('refs/remotes/origin/otra')
    expect(!op.ok && op.error.message).toMatch(/merge a medias/)
    expect(head()).toBe('refs/heads/main')
  })

  it('solo acepta ramas: un tag o una opción disfrazada no pasan del contrato', async () => {
    expect((await checkout('refs/tags/v1')).ok).toBe(false)
    expect((await checkout('refs/heads/-f')).ok).toBe(false)
  })
})
