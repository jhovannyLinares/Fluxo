import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Interactive Rebase: Pick / Reword / Squash / Drop y reordenar, contra repos git reales. */
describe('interactive rebase', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-ir-')
  let n = 0
  let d = ''
  let repoId = ''
  let c: string[] = []
  const commit = (f: string, s: string, msg: string) => {
    writeFileSync(join(d, f), s)
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', msg])
    return git(d, ['rev-parse', 'HEAD']).trim()
  }
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const subjects = () => git(d, ['log', '--format=%s']).trim().split('\n')
  const step = (i: number, action: 'pick' | 'reword' | 'squash' | 'drop', message?: string) => ({ hash: c[i]!, action, ...(message ? { message } : {}) })

  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    commit('base.txt', 'base\n', 'base')
    git(d, ['branch', 'destino'])
    c = [commit('a.txt', 'a\n', 'uno'), commit('b.txt', 'b\n', 'dos'), commit('c.txt', 'c\n', 'tres')]
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('el plan lista los commits de la rama que no están en el destino, del más viejo al más nuevo', async () => {
    const r = await call('repo:rebasePlan', { ref: 'refs/heads/destino' })
    expect(r.ok && (r.data as { commits: { subject: string }[] }).commits.map((x) => x.subject)).toEqual(['uno', 'dos', 'tres'])
  })

  it('todo en pick no cambia la historia', async () => {
    const before = git(d, ['rev-parse', 'HEAD']).trim()
    const r = await call('repo:rebaseInteractive', { ref: 'refs/heads/destino', steps: [step(0, 'pick'), step(1, 'pick'), step(2, 'pick')] })
    expect(r.ok && (r.data as { status: string }).status).toBe('done')
    expect(subjects()).toEqual(['tres', 'dos', 'uno', 'base'])
    expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(before)
  })

  it('drop quita el commit', async () => {
    await call('repo:rebaseInteractive', { ref: 'refs/heads/destino', steps: [step(0, 'pick'), step(1, 'drop'), step(2, 'pick')] })
    expect(subjects()).toEqual(['tres', 'uno', 'base'])
    expect(existsSync(join(d, 'b.txt'))).toBe(false)
  })

  it('reword cambia el mensaje y conserva el contenido', async () => {
    await call('repo:rebaseInteractive', { ref: 'refs/heads/destino', steps: [step(0, 'pick'), step(1, 'reword', 'dos corregido'), step(2, 'pick')] })
    expect(subjects()).toEqual(['tres', 'dos corregido', 'uno', 'base'])
    expect(readFileSync(join(d, 'b.txt'), 'utf8')).toBe('b\n')
  })

  it('squash une el commit con el anterior', async () => {
    await call('repo:rebaseInteractive', { ref: 'refs/heads/destino', steps: [step(0, 'pick'), step(1, 'squash'), step(2, 'pick')] })
    expect(git(d, ['rev-list', '--count', 'destino..HEAD']).trim()).toBe('2')
    expect(existsSync(join(d, 'a.txt')) && existsSync(join(d, 'b.txt'))).toBe(true)
  })

  it('reordenar cambia el orden de los commits', async () => {
    await call('repo:rebaseInteractive', { ref: 'refs/heads/destino', steps: [step(1, 'pick'), step(0, 'pick'), step(2, 'pick')] })
    expect(subjects()).toEqual(['tres', 'uno', 'dos', 'base'])
  })

  it('un squash al principio o un commit que falta se rechazan sin tocar nada', async () => {
    const before = git(d, ['rev-parse', 'HEAD']).trim()
    const a = await call('repo:rebaseInteractive', { ref: 'refs/heads/destino', steps: [step(0, 'squash'), step(1, 'pick'), step(2, 'pick')] })
    expect(!a.ok && a.error.message).toMatch(/squash/i)
    const b = await call('repo:rebaseInteractive', { ref: 'refs/heads/destino', steps: [step(0, 'pick'), step(1, 'pick')] })
    expect(b.ok).toBe(false)
    expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(before)
  })

  it('con un merge commit entre medias no se ofrece (como GitKraken)', async () => {
    git(d, ['checkout', '-q', '-b', 'lado', 'destino'])
    commit('lado.txt', 'l\n', 'lado')
    git(d, ['checkout', '-q', 'main'])
    git(d, ['merge', '-q', '--no-edit', 'lado'])
    const r = await call('repo:rebasePlan', { ref: 'refs/heads/destino' })
    expect(!r.ok && r.error.message).toMatch(/merge/i)
  })

  it('con cambios sin commit los guarda y los devuelve', async () => {
    writeFileSync(join(d, 'local.txt'), 'x\n')
    const r = await call('repo:rebaseInteractive', { ref: 'refs/heads/destino', steps: [step(0, 'pick'), step(1, 'drop'), step(2, 'pick')] })
    expect(r.ok && (r.data as { status: string }).status).toBe('done')
    expect(existsSync(join(d, 'local.txt'))).toBe(true)
  })

  it('si choca queda a medias y Abort vuelve a como estaba', async () => {
    writeFileSync(join(d, 'b.txt'), 'b2\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'cuatro'])
    c.push(git(d, ['rev-parse', 'HEAD']).trim())
    const before = git(d, ['rev-parse', 'HEAD']).trim()
    const r = await call('repo:rebaseInteractive', {
      ref: 'refs/heads/destino',
      steps: [step(0, 'pick'), step(1, 'drop'), step(2, 'pick'), step(3, 'pick')]
    })
    expect(r.ok && (r.data as { status: string }).status).toBe('conflict')
    expect((await call('repo:operation', { action: 'abort' })).ok).toBe(true)
    expect(git(d, ['rev-parse', 'HEAD']).trim()).toBe(before)
  })
})
