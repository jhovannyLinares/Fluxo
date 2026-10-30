import { AppException } from '@shared/errors'
import { gitDirOf, readOperation } from './operation'
import { runGit, runGitOk } from './runner'

/** Un checkout por repo a la vez. */
const running = new Map<string, Promise<{ changed: boolean; ms: number }>>()

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

/**
 * Cambiar a una rama con doble clic, como GitKraken: una rama local se activa; una remota activa la local del
 * mismo nombre (avanzándola antes si solo le faltan commits del remoto) o, si no existe, la crea siguiendo a la
 * remota. Tercera escritura de Fluxo. Los cambios sin commit que no chocan viajan a la otra rama (lo que hace
 * git); si chocan, git se niega y no se toca nada.
 */
export function checkout(root: string, ref: string): Promise<{ changed: boolean; ms: number }> {
  const key = root.toLowerCase()
  const current = running.get(key)
  if (current) return current
  const p = (async () => {
    const t0 = performance.now()
    const done = (changed: boolean) => ({ changed, ms: Math.round(performance.now() - t0) })
    const op = await readOperation(root, await gitDirOf(root))
    if (op) throw fail(`Hay un ${op.kind} a medias en este repo.`, 'Termínalo o cancélalo antes de cambiar de rama; el aviso de arriba del grafo dice cómo.')
    if ((await runGit(['show-ref', '--verify', '-q', ref], { cwd: root })).code !== 0) {
      throw fail('Esa rama ya no existe.', 'El grafo se actualiza solo; vuelve a intentarlo sobre la rama que se ve ahora.')
    }

    let name: string
    let track: string | null = null
    if (ref.startsWith('refs/heads/')) {
      name = ref.slice('refs/heads/'.length)
    } else {
      const short = ref.slice('refs/remotes/'.length)
      const remotes = (await runGitOk(['remote'], { cwd: root })).split('\n').filter(Boolean)
      const remote = remotes.filter((r) => short.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
      if (!remote) throw fail(`No se reconoce el remoto de ${short}.`, 'Cámbiate a esa rama desde la terminal.')
      name = short.slice(remote.length + 1)
      track = short
    }
    const local = `refs/heads/${name}`
    const head = await runGit(['symbolic-ref', '-q', 'HEAD'], { cwd: root })
    if (head.stdout.trim() === local) return done(false)

    const wt = await runGitOk(['worktree', 'list', '--porcelain'], { cwd: root })
    const other = wt.split('\n\n').find((b) => b.split('\n').includes(`branch ${local}`))
    if (other) {
      const path = other.split('\n')[0]!.replace(/^worktree /, '')
      throw fail(`La rama ${name} ya está abierta en otro worktree: ${path}.`, 'Ábrela desde el panel WORKTREES.')
    }

    const exists = (await runGit(['show-ref', '--verify', '-q', local], { cwd: root })).code === 0
    if (track && exists) {
      // la local solo va atrás de la remota: se avanza antes de activarla (update-ref con el valor viejo, sin carreras)
      const oldHash = (await runGitOk(['rev-parse', '--verify', local], { cwd: root })).trim()
      const newHash = (await runGitOk(['rev-parse', '--verify', ref], { cwd: root })).trim()
      if (oldHash !== newHash && (await runGit(['merge-base', '--is-ancestor', oldHash, newHash], { cwd: root })).code === 0) {
        await runGitOk(['update-ref', '-m', `fluxo: fast-forward a ${track}`, local, newHash, oldHash], { cwd: root })
      }
    }
    const args = track && !exists ? ['switch', '--no-guess', '-c', name, '--track', '--end-of-options', track] : ['switch', '--no-guess', '--end-of-options', name]
    const r = await runGit(args, { cwd: root, timeoutMs: 300_000 })
    if (r.code !== 0) throw checkoutError(r.stdout + r.stderr, name)
    return done(true)
  })().finally(() => running.delete(key))
  running.set(key, p)
  return p
}

/** Traduce los fallos de `git switch` a un mensaje y una sugerencia legibles. */
export function checkoutError(out: string, name: string): AppException {
  const gitOutput = out.trim()
  if (/would be overwritten|commit your changes or stash them|your local changes/i.test(out)) {
    return fail(`Tus cambios sin commit chocan con la rama ${name}.`, 'Haz commit o stash de esos cambios y vuelve a intentar.', gitOutput)
  }
  if (/already (checked out|used by worktree)/i.test(out)) {
    return fail(`La rama ${name} ya está abierta en otro worktree.`, 'Ábrela desde el panel WORKTREES.', gitOutput)
  }
  if (/resolve your current index|unmerged|in progress/i.test(out)) {
    return fail('Hay una operación a medias en este repo.', 'Termínala o cancélala antes de cambiar de rama.', gitOutput)
  }
  return fail(`No se pudo cambiar a la rama ${name}.`, 'Revisa la salida de git.', gitOutput)
}
