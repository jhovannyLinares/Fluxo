import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

type Wt = { path: string; branch: string | null; locked?: boolean; current: boolean }

/** Quitar, bloquear y desbloquear worktrees, contra repos git reales. */
describe('worktrees', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-wt-')
  const base = () => realpathSync.native(tmp.dir) // git informa la ruta larga, no la 8.3 del TEMP
  let n = 0
  let d = ''
  let wt = ''
  let repoId = ''
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const worktrees = async () => {
    const r = await call('refs:list')
    return (r.ok ? (r.data as { worktrees: Wt[] }).worktrees : []) as Wt[]
  }
  const branches = () => git(d, ['branch', '--format=%(refname:short)']).trim().split('\n')

  beforeEach(async () => {
    const id = n++
    d = join(base(), `caso${id}`)
    wt = join(base(), `wt${id}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    writeFileSync(join(d, 'a.txt'), 'a\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'inicio'])
    git(d, ['worktree', 'add', '-q', '-b', 'otra', wt])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('crear con una rama nueva desde una rama: el worktree queda en la rama nueva', async () => {
    const dir = join(base(), `nuevo${n}`)
    expect((await call('repo:addWorktree', { path: dir, ref: 'main', newBranch: 'trabajo' })).ok).toBe(true)
    expect(git(dir, ['branch', '--show-current']).trim()).toBe('trabajo')
    expect(git(d, ['rev-parse', 'trabajo']).trim()).toBe(git(d, ['rev-parse', 'main']).trim())
    expect((await worktrees()).some((w) => w.branch === 'trabajo')).toBe(true)
  })

  it('crear con una rama nueva desde un commit', async () => {
    const dir = join(base(), `nuevoc${n}`)
    const hash = git(d, ['rev-parse', 'HEAD']).trim()
    expect((await call('repo:addWorktree', { path: dir, hash, newBranch: 'desde-commit' })).ok).toBe(true)
    expect(git(dir, ['branch', '--show-current']).trim()).toBe('desde-commit')
  })

  it('crear con el mismo nombre de la rama que se saca no crea otra rama', async () => {
    const dir = join(base(), `igual${n}`)
    expect((await call('repo:addWorktree', { path: dir, ref: 'otra', newBranch: 'otra' })).ok).toBe(false)
    git(d, ['worktree', 'remove', '--force', wt])
    expect((await call('repo:addWorktree', { path: dir, ref: 'otra', newBranch: 'otra' })).ok).toBe(true)
    expect(git(dir, ['branch', '--show-current']).trim()).toBe('otra')
  })

  it('rechaza un nombre de rama inválido o que ya existe, sin crear la carpeta', async () => {
    const dir = join(base(), `malo${n}`)
    const inv = await call('repo:addWorktree', { path: dir, ref: 'main', newBranch: 'mala rama' })
    expect(!inv.ok && inv.error.message).toMatch(/nombre de rama/i)
    const ya = await call('repo:addWorktree', { path: dir, ref: 'main', newBranch: 'otra' })
    expect(!ya.ok && ya.error.message).toMatch(/ya existe/i)
    expect(existsSync(dir)).toBe(false)
  })

  it('la lista dice cuáles están bloqueados', async () => {
    expect((await worktrees()).every((w) => !w.locked)).toBe(true)
    git(d, ['worktree', 'lock', wt])
    expect((await worktrees()).find((w) => w.branch === 'otra')?.locked).toBe(true)
  })

  it('bloquear y desbloquear', async () => {
    expect((await call('worktree:lock', { path: wt, lock: true })).ok).toBe(true)
    expect(git(d, ['worktree', 'list', '--porcelain'])).toContain('locked')
    expect((await call('worktree:lock', { path: wt, lock: false })).ok).toBe(true)
    expect(git(d, ['worktree', 'list', '--porcelain'])).not.toContain('locked')
  })

  it('quitar borra la carpeta y deja la rama', async () => {
    expect((await call('worktree:remove', { path: wt, deleteBranch: false })).ok).toBe(true)
    expect(existsSync(wt)).toBe(false)
    expect(branches()).toContain('otra')
  })

  it('quitar y borrar la rama', async () => {
    expect((await call('worktree:remove', { path: wt, deleteBranch: true })).ok).toBe(true)
    expect(existsSync(wt)).toBe(false)
    expect(branches()).not.toContain('otra')
  })

  it('con cambios sin commit no lo quita y lo dice', async () => {
    writeFileSync(join(wt, 'sucio.txt'), 'x\n')
    const r = await call('worktree:remove', { path: wt, deleteBranch: false })
    expect(!r.ok && r.error.message).toMatch(/cambios sin commit/i)
    expect(existsSync(wt)).toBe(true)
  })

  it('uno bloqueado no se quita', async () => {
    git(d, ['worktree', 'lock', wt])
    const r = await call('worktree:remove', { path: wt, deleteBranch: false })
    expect(!r.ok && r.error.message).toMatch(/bloqueado/i)
    expect(existsSync(wt)).toBe(true)
  })

  it('el worktree actual y una carpeta que no es un worktree se rechazan', async () => {
    const actual = await call('worktree:remove', { path: d, deleteBranch: false })
    expect(!actual.ok && actual.error.message).toMatch(/actual/i)
    const otra = await call('worktree:remove', { path: join(base(), 'cualquiera'), deleteBranch: false })
    expect(!otra.ok && otra.error.message).toMatch(/no es un worktree/i)
  })
})
