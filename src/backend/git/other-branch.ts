import { AppException } from '@shared/errors'
import { runGit } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

const ms = (t0: number) => Math.round(performance.now() - t0)

/** Remoto y rama remota de `branch.<rama>.remote/.merge`; `null` si no tiene upstream. */
async function upstreamOf(root: string, branch: string): Promise<{ remote: string; merge: string }> {
  if ((await runGit(['show-ref', '--verify', '-q', `refs/heads/${branch}`], { cwd: root })).code !== 0) {
    throw fail('Esa rama ya no existe.', 'El grafo se actualiza solo; vuelve a intentarlo sobre la rama que se ve ahora.')
  }
  const get = async (k: string) => (await runGit(['config', '--get', `branch.${branch}.${k}`], { cwd: root })).stdout.trim()
  const remote = await get('remote')
  const merge = await get('merge')
  if (!remote || remote === '.' || !merge.startsWith('refs/heads/')) {
    throw fail(`La rama ${branch} no sigue a ninguna rama remota.`, 'Configúrala con «Set Upstream» en su menú.')
  }
  return { remote, merge }
}

/** «Pull» de una rama que no es la actual: la avanza (solo en línea recta) hasta su upstream, sin cambiarte de rama. */
export async function pullBranch(root: string, branch: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  const { remote, merge } = await upstreamOf(root, branch)
  const cur = (await runGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root })).stdout.trim()
  if (cur === branch) throw fail('Esa es la rama actual.', 'Usa el Pull de la barra.')
  const r = await runGit(['fetch', remote, `${merge}:refs/heads/${branch}`], { cwd: root, timeoutMs: 300_000 })
  if (r.code !== 0) {
    const out = (r.stdout + r.stderr).trim()
    if (/non-fast-forward|rejected|could not be updated/i.test(out)) {
      throw fail(`${branch} no se puede avanzar en línea recta (fast-forward).`, 'Cámbiate a esa rama y haz Pull con merge o rebase.', out)
    }
    throw fail(`No se pudo hacer pull de ${branch}.`, 'Revisa la conexión y tus permisos en el remoto.', out)
  }
  return { ms: ms(t0) }
}

/** «Push» de una rama que no es la actual a su upstream; sin force: si el remoto la rechaza, se dice. */
export async function pushBranch(root: string, branch: string, to?: { remote: string; branch: string }): Promise<{ ms: number }> {
  const t0 = performance.now()
  let remote: string
  let merge: string
  if (to) {
    if ((await runGit(['show-ref', '--verify', '-q', `refs/heads/${branch}`], { cwd: root })).code !== 0) {
      throw fail('Esa rama ya no existe.', 'El grafo se actualiza solo; vuelve a intentarlo sobre la rama que se ve ahora.')
    }
    if (!(await runGit(['remote'], { cwd: root })).stdout.split('\n').includes(to.remote)) throw fail(`El remoto ${to.remote} no existe.`, 'Elige uno de la lista.')
    remote = to.remote
    merge = `refs/heads/${to.branch}`
  } else {
    ;({ remote, merge } = await upstreamOf(root, branch))
  }
  const r = await runGit(['push', '--porcelain', '--end-of-options', remote, `refs/heads/${branch}:${merge}`], { cwd: root, timeoutMs: 300_000 })
  if (r.code !== 0) {
    const out = (r.stdout + r.stderr).trim()
    if (/rejected|non-fast-forward|fetch first/i.test(out)) {
      throw fail(`El remoto rechazó ${branch}: tiene commits que tu rama no tiene.`, 'Haz pull de esa rama antes de subirla.', out)
    }
    throw fail(`No se pudo hacer push de ${branch}.`, 'Revisa la conexión y tus permisos en el remoto.', out)
  }
  return { ms: ms(t0) }
}
