import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import type { PushResult, PushTarget } from '../../src/shared/push'
import { git, tempDir } from '../fixtures/make-repo'

/** Botón Push contra un servidor local, como GitKraken: upstream, publicar, rechazo y force con lease. */
describe('push', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-push-')
  let n = 0
  let mine = ''
  let other = ''
  let server = ''
  let repoId = ''
  const commitFile = (dir: string, f: string, s: string, msg: string) => {
    writeFileSync(join(dir, f), s)
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', msg])
  }
  const push = async (req: object = {}) => {
    const r = await dispatch('repo:push', { repoId, ...req })
    if (!r.ok) throw new Error(r.error.message)
    return r.data as PushResult
  }
  const remoteHead = (ref: string) => git(server, ['rev-parse', ref]).trim()

  // servidor con main; «mío» (el que abre Fluxo) y «otro» (sube cambios por su lado)
  beforeEach(async () => {
    const base = join(tmp.dir, `caso${n++}`)
    server = `${base}-server.git`
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

  it('con upstream: sube sin preguntar', async () => {
    commitFile(mine, 'b.txt', 'b\n', 'local')
    const r = await push()
    expect(r).toMatchObject({ status: 'pushed', changed: true })
    expect(remoteHead('main')).toBe(git(mine, ['rev-parse', 'HEAD']).trim())
  })

  it('sin upstream: el objetivo lo dice, y Push al destino elegido la publica y la deja como upstream', async () => {
    git(mine, ['checkout', '-q', '-b', 'deploy/0048-nueva'])
    commitFile(mine, 'c.txt', 'c\n', 'nueva')
    const t = await dispatch('repo:pushTarget', { repoId })
    expect(t.ok && (t.data as PushTarget)).toEqual({ branch: 'deploy/0048-nueva', upstream: null, remotes: ['origin'] })
    const sin = await dispatch('repo:push', { repoId })
    expect(!sin.ok && sin.error.message).toMatch(/no existe en el remoto/)
    expect((await push({ to: { remote: 'origin', branch: 'deploy/0048-nueva' } })).status).toBe('pushed')
    expect(remoteHead('deploy/0048-nueva')).toBe(git(mine, ['rev-parse', 'HEAD']).trim())
    expect(git(mine, ['rev-parse', '--abbrev-ref', '@{u}']).trim()).toBe('origin/deploy/0048-nueva')
  })

  it('el remoto tiene commits que tú no: rechazado, con esos commits; el force con lease los reemplaza', async () => {
    commitFile(other, 'r.txt', 'r\n', 'del remoto')
    git(other, ['push', '-q'])
    commitFile(mine, 'l.txt', 'l\n', 'local')
    const r = await push()
    expect(r.status).toBe('rejected')
    if (r.status !== 'rejected') return
    expect(r.target).toBe('origin/main')
    expect(r.lost.map((c) => c.subject)).toEqual(['del remoto'])
    expect(r.expected).toBe(remoteHead('main'))
    expect((await push({ forceExpected: r.expected })).status).toBe('pushed')
    expect(remoteHead('main')).toBe(git(mine, ['rev-parse', 'HEAD']).trim())
  })

  it('force con lease vencido (alguien subió después de ver la lista): se cancela sin pisar', async () => {
    commitFile(other, 'r.txt', 'r\n', 'del remoto')
    git(other, ['push', '-q'])
    commitFile(mine, 'l.txt', 'l\n', 'local')
    const r = await push()
    if (r.status !== 'rejected') throw new Error('debía rechazar')
    commitFile(other, 'r2.txt', 'r2\n', 'otro más')
    git(other, ['push', '-q'])
    const tarde = remoteHead('main')
    const f = await dispatch('repo:push', { repoId, forceExpected: r.expected })
    expect(!f.ok && f.error.message).toMatch(/mientras confirmabas/)
    expect(remoteHead('main')).toBe(tarde)
  })

  it('servidor que rechaza por regla (hook): mensaje legible, no se ofrece force', async () => {
    const hook = join(server, 'hooks', 'pre-receive')
    // Git for Windows corre el hook por su shebang, sin bit de ejecución
    writeFileSync(hook, '#!/bin/sh\necho "GH006: Protected branch update failed" >&2\nexit 1\n', { mode: 0o755 })
    commitFile(mine, 'b.txt', 'b\n', 'local')
    const r = await dispatch('repo:push', { repoId })
    expect(!r.ok && r.error.message).toMatch(/protegida/)
  })

  it('nombre hostil y opción disfrazada: el nombre sube sin ejecutar nada; «-f» no pasa el contrato', async () => {
    const hostil = 'x$(touch${IFS}pwned);echo'
    git(mine, ['checkout', '-q', '-b', hostil])
    expect((await push({ to: { remote: 'origin', branch: hostil } })).status).toBe('pushed')
    expect(existsSync(join(mine, 'pwned'))).toBe(false)
    expect((await dispatch('repo:push', { repoId, to: { remote: '-f', branch: 'x' } })).ok).toBe(false)
    expect((await dispatch('repo:push', { repoId, forceExpected: 'HEAD' })).ok).toBe(false)
  })

  it('HEAD desacoplado: lo dice sin tocar nada', async () => {
    git(mine, ['checkout', '-q', '--detach'])
    const r = await dispatch('repo:push', { repoId })
    expect(!r.ok && r.error.message).toMatch(/HEAD desacoplado/)
  })
})
