import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/shared/ipc-contracts'
import type { OpEntry } from '../../src/shared/op-journal'
import { setEmitter } from '../../src/backend/events'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/**
 * Fila de escrituras por repo: el caso del 2026-10-26 (Pull lanzado y, mientras traía datos, doble clic a otra rama)
 * ya no deja a git avanzando el árbol desde la rama vieja. Cada escritura deja su línea en la bitácora.
 */
describe('fila de escrituras y bitácora', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-queue-')
  const server = join(tmp.dir, 'server.git')
  const mine = join(tmp.dir, 'mio')
  const other = join(tmp.dir, 'otro')
  const events: AppEvent[] = []
  let repoId = ''
  const commitFile = (dir: string, f: string, msg: string) => {
    writeFileSync(join(dir, f), msg)
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', msg])
  }
  const journal = () => events.filter((e): e is Extract<AppEvent, { type: 'op:journal' }> => e.type === 'op:journal').map((e) => e.entry)

  beforeAll(async () => {
    setEmitter((e) => events.push(e))
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', server])
    git(tmp.dir, ['clone', '-q', server, other])
    commitFile(other, 'a.txt', 'base')
    git(other, ['push', '-q', 'origin', 'main'])
    git(other, ['checkout', '-q', '-b', 'desa'])
    commitFile(other, 'solo-desa.txt', 'archivo que solo tiene desa')
    git(other, ['push', '-q', 'origin', 'desa'])
    git(tmp.dir, ['clone', '-q', server, mine])
    git(mine, ['checkout', '-q', '-b', 'trabajo'])
    git(mine, ['branch', '-q', '--set-upstream-to=origin/main'])
    git(mine, ['checkout', '-q', 'desa'])
    git(mine, ['checkout', '-q', 'trabajo'])
    // el remoto avanza main: el pull de «trabajo» tiene algo que traer
    git(other, ['checkout', '-q', 'main'])
    commitFile(other, 'b.txt', 'nuevo en main')
    git(other, ['push', '-q', 'origin', 'main'])
    const open = await dispatch('repo:open', { path: mine })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => {
    setEmitter(() => {})
    tmp.cleanup()
  })

  it('pull y checkout lanzados a la vez: corren uno tras otro y los dos salen bien', async () => {
    const [p, c] = await Promise.all([dispatch('repo:pull', { repoId, mode: 'ff' }), dispatch('repo:checkout', { repoId, ref: 'refs/heads/desa' })])
    expect(p.ok, p.ok ? '' : p.error.message + (p.error.gitOutput ?? '')).toBe(true)
    expect(c.ok, c.ok ? '' : c.error.message).toBe(true)
    expect(git(mine, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe('desa')
    expect(git(mine, ['status', '--porcelain']).trim()).toBe('')
    // trabajo avanzó con el pull aunque ya no sea la rama actual
    expect(git(mine, ['rev-parse', 'trabajo'])).toBe(git(mine, ['rev-parse', 'origin/main']))
  })

  it('bitácora: una línea por escritura, con espera, HEAD antes y después y los comandos de git', () => {
    const [pull, checkout] = journal() as [OpEntry, OpEntry]
    expect(pull).toMatchObject({ op: 'pull ff', result: 'ok', before: { branch: 'trabajo' }, after: { branch: 'trabajo' } })
    expect(pull.git.some((g) => g.cmd.startsWith('pull ') && g.code === 0)).toBe(true)
    expect(checkout).toMatchObject({ op: 'checkout refs/heads/desa', result: 'ok', waitedFor: 'pull ff', before: { branch: 'trabajo' }, after: { branch: 'desa' } })
    expect(checkout.waitedMs).toBeGreaterThan(0)
  })

  it('crear un repo que aún no existe también deja su línea, con el HEAD que quedó después', async () => {
    const r = await dispatch('repo:init', { name: 'nuevo-repo', parent: tmp.dir })
    expect(r.ok, r.ok ? '' : r.error.message).toBe(true)
    expect(journal().at(-1)).toMatchObject({ op: 'init repository', repo: join(tmp.dir, 'nuevo-repo'), result: 'ok', before: { sha: null }, after: { branch: 'main' } })
    expect(journal().at(-1)!.after.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('una escritura que falla también queda, con su error', async () => {
    const r = await dispatch('repo:checkout', { repoId, ref: 'refs/heads/no-existe' })
    expect(r.ok).toBe(false)
    expect(journal().at(-1)).toMatchObject({ op: 'checkout refs/heads/no-existe', result: 'error' })
  })
})
