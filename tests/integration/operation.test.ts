import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/shared/ipc-contracts'
import { setEmitter } from '../../src/backend/events'
import { dispatch, stopWatching } from '../../src/backend/handlers'
import { gitDirOf, readOperation } from '../../src/backend/git/operation'
import { git, tempDir } from '../fixtures/make-repo'

/** git que puede fallar a propósito (un merge con conflicto sale con código 1). */
const tryGit = (cwd: string, args: string[]) => {
  try {
    git(cwd, args)
  } catch {
    // conflicto esperado
  }
}

/** H21 contra un repo real: cada operación en curso, sus conflictos, y el aviso en vivo al abrir y cerrar un merge. */
describe('operación en curso (H21)', () => {
  const tmp = tempDir('cg-op-')
  const d = tmp.dir
  const w = (s: string) => writeFileSync(join(d, 'a.txt'), s)
  const events: AppEvent[] = []
  let gitDir = ''

  beforeAll(() => {
    setEmitter((e) => events.push(e))
    git(d, ['init', '-q', '-b', 'main'])
    w('base\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'base'])
    git(d, ['checkout', '-q', '-b', 'otra'])
    w('otra\n')
    git(d, ['commit', '-q', '-am', 'otra'])
    git(d, ['checkout', '-q', 'main'])
    w('main\n')
    git(d, ['commit', '-q', '-am', 'main'])
  })
  afterAll(async () => {
    stopWatching()
    setEmitter(() => {})
    await new Promise((r) => setTimeout(r, 500))
    tmp.cleanup()
  })

  it('sin operación: null', async () => {
    gitDir = await gitDirOf(d)
    expect(await readOperation(d, gitDir)).toBeNull()
  })

  it('rebase, cherry-pick y revert con conflicto; bisect sin conflicto', async () => {
    tryGit(d, ['rebase', 'otra'])
    expect(await readOperation(d, gitDir)).toEqual({ kind: 'rebase', conflicts: 1 })
    git(d, ['rebase', '--abort'])
    tryGit(d, ['cherry-pick', 'otra'])
    expect(await readOperation(d, gitDir)).toEqual({ kind: 'cherry-pick', conflicts: 1 })
    git(d, ['cherry-pick', '--abort'])
    tryGit(d, ['revert', '--no-edit', 'main~1'])
    expect((await readOperation(d, gitDir))?.kind).toBe('revert')
    tryGit(d, ['revert', '--abort'])
    git(d, ['bisect', 'start'])
    expect(await readOperation(d, gitDir)).toEqual({ kind: 'bisect', conflicts: 0 })
    git(d, ['bisect', 'reset'])
    expect(await readOperation(d, gitDir)).toBeNull()
  })

  it('merge con conflicto: al abrir lo dice, y en vivo desaparece al abortar', async () => {
    tryGit(d, ['merge', 'otra'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    const { repoId, operation } = open.data as { repoId: string; operation: unknown }
    expect(operation).toEqual({ kind: 'merge', conflicts: 1 })
    await dispatch('graph:load', { repoId })
    await dispatch('repo:watch', { repoId })
    const from = events.length
    execFileSync('git', ['merge', '--abort'], { cwd: d })
    const t0 = Date.now()
    const ended = () =>
      events.slice(from).find((e) => e.type === 'repo:changed' && e.operation === null) as Extract<AppEvent, { type: 'repo:changed' }> | undefined
    while (Date.now() - t0 < 8000 && !ended()) await new Promise((r) => setTimeout(r, 50))
    expect(ended()).toBeDefined()
  })
})
