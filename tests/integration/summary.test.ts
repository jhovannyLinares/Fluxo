import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RepoSummary } from '../../src/shared/summary'
import { dispatch } from '../../src/backend/handlers'
import { commit, git, tempDir } from '../fixtures/make-repo'

/** Resumen de cada repo en la gestión de repositorios: rama, ↑↓ y cambios sin commit. */
describe('resumen de repo', () => {
  const tmp = tempDir('cg-sum-')
  const server = join(tmp.dir, 'server.git')
  const mine = join(tmp.dir, 'mio')
  const summary = async (path: string) => {
    const r = await dispatch('repo:summary', { path })
    if (!r.ok) throw new Error(r.error.message)
    return (r.data as { summary: RepoSummary | null }).summary
  }

  beforeAll(() => {
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', server])
    git(tmp.dir, ['clone', '-q', server, mine])
    commit(mine, 'base')
    git(mine, ['push', '-q', 'origin', 'main'])
    commit(mine, 'sin subir')
    const tracked = git(mine, ['ls-files']).trim().split('\n')
    writeFileSync(join(mine, tracked[0]!), 'cambiado')
    git(mine, ['mv', tracked[1]!, 'renombrado.txt'])
    writeFileSync(join(mine, 'nuevo.txt'), 'n')
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('rama, ↑↓ y cambios (un renombre cuenta una vez)', async () => {
    expect(await summary(mine)).toEqual({ branch: 'main', ahead: 1, behind: 0, modified: 2, added: 1 })
  })

  it('carpeta que ya no existe o que no es repo: null', async () => {
    expect(await summary(join(tmp.dir, 'no-existe'))).toBeNull()
    expect(await summary(tmp.dir)).toBeNull()
  })
})
