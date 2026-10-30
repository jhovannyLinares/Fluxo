import { AppException } from '@shared/errors'
import { runGit } from './runner'

/** Un cherry pick por repo a la vez. */
const running = new Map<string, Promise<{ ms: number }>>()

/**
 * Cherry pick de uno o varios commits sobre la rama actual, en el orden recibido (la ventana los manda del más viejo
 * al más nuevo). Segunda escritura de Fluxo (decisión de Gio del 2026-10-22). Nunca espera un editor: usa el mensaje
 * del commit original. Si se detiene (conflicto o commit que ya está en la rama), el repo queda en un cherry pick a
 * medias y el aviso de operación en curso (H21) dice cómo seguir o cancelar.
 */
export function cherryPick(root: string, hashes: string[]): Promise<{ ms: number }> {
  const key = root.toLowerCase()
  const current = running.get(key)
  if (current) return current
  const p = (async () => {
    const t0 = performance.now()
    // un commit que ya es parte de la historia de la rama choca consigo mismo: se avisa antes de tocar el repo
    const h = await inHistory(root, hashes)
    if (h) {
      throw new AppException({
        code: 'GIT_FAILED',
        message: `El commit ${h.slice(0, 7)} ya es parte de la historia de tu rama: no hay nada que copiar.`,
        suggestion: 'Elige commits de otra rama que todavía no estén en la actual.'
      })
    }
    const r = await runGit(['cherry-pick', '--end-of-options', ...hashes], {
      cwd: root,
      timeoutMs: 300_000,
      env: { GIT_EDITOR: 'true' }
    })
    if (r.code !== 0) throw cherryPickError(r.stdout + r.stderr)
    return { ms: Math.round(performance.now() - t0) }
  })().finally(() => running.delete(key))
  running.set(key, p)
  return p
}

/** Primer commit de la lista que ya es parte de la historia de HEAD, o null; el menú lo usa para poner en gris el cherry pick. */
export async function inHistory(root: string, hashes: string[]): Promise<string | null> {
  for (const h of hashes) {
    const r = await runGit(['merge-base', '--is-ancestor', '--end-of-options', h, 'HEAD'], { cwd: root })
    if (r.code === 0) return h
  }
  return null
}

/** Traduce los fallos de `git cherry-pick` a un mensaje y una sugerencia legibles. */
export function cherryPickError(out: string): AppException {
  const gitOutput = out.trim()
  const fail = (message: string, suggestion: string) => new AppException({ code: 'GIT_FAILED', message, suggestion, gitOutput })
  if (/is a merge but no -m option/i.test(out)) {
    return fail('No se puede hacer cherry pick de un commit de merge.', 'Elige los commits de la rama, sin el merge.')
  }
  if (/would be overwritten|commit your changes or stash them|your local changes/i.test(out)) {
    return fail('Tus cambios sin commit chocan con los commits elegidos.', 'Haz commit o stash de esos cambios en la terminal y vuelve a intentar.')
  }
  if (/is now empty|nothing to commit|allow-empty/i.test(out)) {
    return fail(
      'Uno de los commits ya está en tu rama: el cherry pick se detuvo.',
      'Sigue con git cherry-pick --skip o cancela con git cherry-pick --abort en la terminal.'
    )
  }
  if (/CONFLICT|could not apply|after resolving the conflicts/i.test(out)) {
    return fail('El cherry pick dejó conflictos por resolver.', 'Resuélvelos en tu terminal o editor; el aviso de arriba del grafo dice cómo continuar o cancelar.')
  }
  if (/cherry-pick is already in progress|in progress/i.test(out)) {
    return fail('Ya hay un cherry pick a medias en este repo.', 'Termínalo o cancélalo en la terminal antes de empezar otro.')
  }
  return fail('El cherry pick falló.', 'Revisa la salida de git.')
}
