import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { commit, git, tempDir } from '../fixtures/make-repo'

/** H10 contra un remoto local: un bare como servidor y otro clon que empuja como si fuera un agente. */
describe('fetch (H10)', () => {
  const tmp = tempDir('cg-fetch-')
  const server = join(tmp.dir, 'server.git')
  const mine = join(tmp.dir, 'mio')
  const agent = join(tmp.dir, 'agente')
  let repoId = ''
  const fetch = async () => {
    const r = await dispatch('repo:fetch', { repoId })
    if (!r.ok) throw new Error(r.error.message)
    return r.data as { changed: boolean; ms: number }
  }

  beforeAll(async () => {
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', server])
    git(tmp.dir, ['clone', '-q', server, agent])
    commit(agent, 'inicio')
    git(agent, ['push', '-q', 'origin', 'main'])
    git(tmp.dir, ['clone', '-q', server, mine])
    const r = await dispatch('repo:open', { path: mine })
    if (!r.ok) throw new Error(r.error.message)
    repoId = (r.data as { repoId: string }).repoId
  })
  afterAll(() => tmp.cleanup())

  it('sin novedades en el remoto: no hay cambio', async () => {
    expect((await fetch()).changed).toBe(false)
  })

  it('push de otro clon: el fetch lo trae y avisa que cambió', async () => {
    commit(agent, 'trabajo del agente')
    git(agent, ['push', '-q', 'origin', 'main'])
    git(agent, ['push', '-q', 'origin', 'main:claude/rama-nueva'])
    expect((await fetch()).changed).toBe(true)
    const remote = git(mine, ['rev-parse', 'origin/main']).trim()
    expect(remote).toBe(git(agent, ['rev-parse', 'HEAD']).trim())
    expect(git(mine, ['branch', '-r'])).toContain('origin/claude/rama-nueva')
    // otra vez sin novedades
    expect((await fetch()).changed).toBe(false)
  })

  it('rama borrada en el servidor se poda', async () => {
    git(agent, ['push', '-q', 'origin', '--delete', 'claude/rama-nueva'])
    expect((await fetch()).changed).toBe(true)
    expect(git(mine, ['branch', '-r'])).not.toContain('claude/rama-nueva')
  })

  it('dos fetch a la vez comparten el mismo proceso', async () => {
    const [a, b] = await Promise.all([dispatch('repo:fetch', { repoId }), dispatch('repo:fetch', { repoId })])
    expect(a).toEqual(b)
  })

  it('remoto inalcanzable: error legible con salida de git', async () => {
    git(mine, ['remote', 'add', 'roto', join(tmp.dir, 'no-existe.git')])
    const r = await dispatch('repo:fetch', { repoId, auto: true })
    git(mine, ['remote', 'remove', 'roto'])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('GIT_FAILED')
      expect(r.error.gitOutput).toBeTruthy()
      expect(r.error.suggestion).toBeTruthy()
    }
  })
})
