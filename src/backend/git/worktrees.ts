import { resolve } from 'node:path'
import { AppException } from '@shared/errors'
import { runGit } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

const same = (a: string, b: string) => resolve(a).replace(/\\/g, '/').toLowerCase() === resolve(b).replace(/\\/g, '/').toLowerCase()

interface Entry {
  path: string
  branch: string | null
  locked: boolean
}

async function entries(root: string): Promise<Entry[]> {
  const out = (await runGit(['worktree', 'list', '--porcelain'], { cwd: root })).stdout
  return out
    .split(/\r?\n\r?\n/)
    .map((b) => b.split(/\r?\n/))
    .filter((lines) => lines[0]?.startsWith('worktree '))
    .map((lines) => ({
      path: lines[0]!.slice(9),
      branch: lines.find((l) => l.startsWith('branch '))?.slice(7).replace('refs/heads/', '') ?? null,
      locked: lines.some((l) => l === 'locked' || l.startsWith('locked '))
    }))
}

async function find(root: string, path: string): Promise<Entry> {
  const list = await entries(root)
  const e = list.find((x) => same(x.path, path))
  if (!e) throw fail('Esa carpeta no es un worktree de este repo.', 'El panel se actualiza solo; vuelve a intentarlo sobre un worktree que se vea.')
  if (same(list[0]!.path, path) || same(root, path)) throw fail('Ese es el worktree actual.', 'Ábrelo desde otra pestaña si quieres quitarlo.')
  return e
}

/** «Remove this worktree» (y, opcional, la rama que tenía). Con cambios sin commit o bloqueado, git se niega y no se toca nada. */
export async function removeWorktree(root: string, path: string, deleteBranch: boolean): Promise<{ ms: number }> {
  const t0 = performance.now()
  const e = await find(root, path)
  if (e.locked) throw fail('Ese worktree está bloqueado.', 'Desbloquéalo antes de quitarlo.')
  const r = await runGit(['worktree', 'remove', '--', e.path], { cwd: root, timeoutMs: 120_000 })
  if (r.code !== 0) {
    const out = (r.stdout + r.stderr).trim()
    if (/modified or untracked|contains/i.test(out)) throw fail('Ese worktree tiene cambios sin commit.', 'Haz commit, stash o descártalos antes de quitarlo.', out)
    throw fail('No se pudo quitar el worktree.', 'Revisa la salida de git.', out)
  }
  if (deleteBranch && e.branch) {
    const b = await runGit(['branch', '-D', '--end-of-options', e.branch], { cwd: root })
    if (b.code !== 0) throw fail(`El worktree se quitó, pero no se pudo borrar la rama ${e.branch}.`, 'Bórrala desde el panel de ramas.', (b.stdout + b.stderr).trim())
  }
  return { ms: Math.round(performance.now() - t0) }
}

/** «Lock / Unlock this worktree». */
export async function lockWorktree(root: string, path: string, lock: boolean): Promise<{ ms: number }> {
  const t0 = performance.now()
  const e = await find(root, path)
  const r = await runGit(['worktree', lock ? 'lock' : 'unlock', '--', e.path], { cwd: root })
  if (r.code !== 0) throw fail(lock ? 'No se pudo bloquear el worktree.' : 'No se pudo desbloquear el worktree.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: Math.round(performance.now() - t0) }
}
