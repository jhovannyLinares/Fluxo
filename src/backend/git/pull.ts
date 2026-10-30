import { createHash } from 'node:crypto'
import { AppException } from '@shared/errors'
import type { PullMode } from '@shared/pull'
import { gitDirOf, readOperation } from './operation'
import { runGit, runGitOk } from './runner'
import { applyStash, createStash } from './stash'

/** Huella de refs y HEAD: si no cambia, el pull no movió nada y no hace falta recargar. */
export async function print(root: string): Promise<string> {
  const out = await runGitOk(['for-each-ref', '--format=%(objectname) %(refname)'], { cwd: root })
  const head = await runGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: root })
  return createHash('sha1').update(out + head.stdout).digest('hex')
}

const FLAGS: Record<PullMode, string[]> = {
  ff: ['--ff', '--no-rebase'],
  'ff-only': ['--ff-only'],
  rebase: ['--rebase']
}

/** Un pull por repo a la vez. */
const running = new Map<string, Promise<{ changed: boolean; ms: number }>>()

/**
 * Pull de la rama actual desde su upstream, en tres variantes: fast-forward si se puede (si no,
 * merge), solo fast-forward, o rebase. Primera escritura de Fluxo sobre la rama y el árbol de trabajo
 * (decisión de Gio del 2026-10-22). `--no-edit` y GIT_MERGE_AUTOEDIT=no: nunca se queda esperando un editor.
 * Si quedan conflictos, el repo queda en un merge o rebase a medias y el aviso de operación en curso (H21) lo dice.
 */
export function pull(root: string, mode: PullMode): Promise<{ changed: boolean; ms: number }> {
  const key = root.toLowerCase()
  const current = running.get(key)
  if (current) return current
  const p = (async () => {
    const t0 = performance.now()
    const before = await print(root)
    // como GitKraken: los cambios sin commit se guardan solos antes del pull y se reaplican después
    const cur = (await runGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root })).stdout.trim()
    const up = (await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: root })).stdout.trim()
    const dirty = (await runGit(['status', '--porcelain=v1', '-uall'], { cwd: root })).stdout.trim() !== ''
    const stash =
      dirty && cur && up
        ? (
            await createStash(root, {
              message: mode === 'rebase' ? `Auto stash before rebase of "${cur}" onto "${up}"` : `Auto stash before merge of "${cur}" and "${up}"`,
              includeUntracked: true
            })
          ).hash
        : null
    const r = await runGit(['pull', ...FLAGS[mode], '--no-edit', '--quiet'], {
      cwd: root,
      timeoutMs: 300_000,
      env: { GIT_MERGE_AUTOEDIT: 'no' }
    })
    if (r.code !== 0) {
      // sin operación a medias no pasó nada: los cambios vuelven a su sitio; con conflicto el stash se conserva
      if (stash && !(await readOperation(root, await gitDirOf(root)))) await applyStash(root, stash, true).catch(() => undefined)
      throw pullError(r.stdout + r.stderr)
    }
    if (stash) {
      try {
        await applyStash(root, stash, true)
      } catch {
        throw pullError('CONFLICT: tus cambios chocan con lo que trajo el pull; el stash automático se conservó')
      }
    }
    return { changed: (await print(root)) !== before, ms: Math.round(performance.now() - t0) }
  })().finally(() => running.delete(key))
  running.set(key, p)
  return p
}

/** Traduce los fallos más comunes de `git pull` a un mensaje y una sugerencia legibles. */
export function pullError(out: string): AppException {
  const gitOutput = out.trim()
  const fail = (message: string, suggestion: string) => new AppException({ code: 'GIT_FAILED', message, suggestion, gitOutput })
  if (/no tracking information|There is no tracking information/i.test(out)) {
    return fail('La rama actual no sigue a ninguna rama remota.', 'Configúrala en la terminal con git branch --set-upstream-to.')
  }
  if (/not possible to fast-forward|Not possible to fast-forward|diverging branches/i.test(out)) {
    return fail(
      'No se puede avanzar sin mezclar: tu rama y la remota tienen commits distintos.',
      'Usa «Pull (fast-forward if possible)» o «Pull (rebase)» desde la flecha del botón.'
    )
  }
  // otra operación cambió de rama mientras el pull traía datos: git avisa así y no toca nada de lo tuyo
  if (/fetch updated the current branch head/i.test(out)) {
    return fail('La rama cambió mientras corría el pull; no se tocó ningún archivo tuyo.', 'Vuelve a hacer Pull en la rama actual.')
  }
  if (/would be overwritten|commit your changes or stash them|unstaged changes|uncommitted changes/i.test(out)) {
    return fail('Tus cambios sin commit chocan con lo que trae el pull.', 'Haz commit o stash de esos cambios en la terminal y vuelve a intentar.')
  }
  if (/CONFLICT|Automatic merge failed|could not apply/i.test(out)) {
    return fail('El pull dejó conflictos por resolver.', 'Resuélvelos en tu terminal o editor; el aviso de arriba del grafo dice cómo continuar o cancelar.')
  }
  if (/authentication|could not read username|403|401/i.test(out)) {
    return fail('El pull no pudo iniciar sesión en el remoto.', 'Revisa Git Credential Manager en la pantalla Entorno.')
  }
  if (/not currently on a branch|detached/i.test(out)) {
    return fail('No estás en una rama (HEAD desacoplado).', 'Cambia a una rama en la terminal antes de hacer pull.')
  }
  return fail('El pull falló.', 'Revisa la salida de git.')
}
