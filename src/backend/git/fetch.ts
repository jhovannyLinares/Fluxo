import { createHash } from 'node:crypto'
import { AppException } from '@shared/errors'
import { runGit, runGitOk } from './runner'

/** Huella de todas las refs: si no cambia, el fetch no trajo nada y no hace falta recargar el grafo. */
async function refsPrint(root: string): Promise<string> {
  const out = await runGitOk(['for-each-ref', '--format=%(objectname) %(refname)'], { cwd: root })
  return createHash('sha1').update(out).digest('hex')
}

/** Un fetch por repo a la vez: el segundo pedido espera al que ya corre. */
const running = new Map<string, Promise<{ changed: boolean; ms: number }>>()

/**
 * Fetch de todos los remotos (H10). Es una de las dos escrituras de la v1.0 (con clonar):
 * actualiza refs remotas y poda las que se borraron en el servidor.
 * `auto`: autofetch en segundo plano, GCM nunca abre ventanas de inicio de sesión.
 */
export function fetchAll(root: string, auto = false): Promise<{ changed: boolean; ms: number }> {
  const key = root.toLowerCase()
  const current = running.get(key)
  if (current) return current
  const p = (async () => {
    const t0 = performance.now()
    const before = await refsPrint(root)
    const r = await runGit(['fetch', '--all', '--prune', '--quiet'], {
      cwd: root,
      timeoutMs: 120_000,
      env: auto ? { GCM_INTERACTIVE: 'never' } : {}
    })
    if (r.code !== 0) {
      const auth = /authentication|could not read username|403|401/i.test(r.stderr)
      throw new AppException({
        code: 'GIT_FAILED',
        message: auth ? 'El fetch no pudo iniciar sesión en el remoto.' : 'El fetch falló.',
        gitOutput: r.stderr.trim(),
        suggestion: auth
          ? 'Revisa Git Credential Manager en la pantalla Entorno y haz un fetch manual para iniciar sesión.'
          : 'Revisa la conexión y la URL del remoto (git remote -v).'
      })
    }
    return { changed: (await refsPrint(root)) !== before, ms: Math.round(performance.now() - t0) }
  })().finally(() => running.delete(key))
  running.set(key, p)
  return p
}
