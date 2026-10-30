import { AppException } from '@shared/errors'
import type { LastCommit } from '@shared/wip'
import { runGit, runGitOk } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

/** Una escritura del index o commit por repo a la vez: dos clics seguidos no se pisan. */
const running = new Map<string, Promise<unknown>>()
function single<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const key = root.toLowerCase()
  const prev = running.get(key) ?? Promise.resolve()
  const p = prev.catch(() => {}).then(fn)
  running.set(key, p)
  void p.finally(() => running.get(key) === p && running.delete(key)).catch(() => {})
  return p
}

const hasHead = async (root: string) => (await runGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: root })).code === 0

/** Rutas por stdin separadas por NUL y sin «magia» de pathspec: un archivo llamado `-f` o `:(top)` es solo un archivo. */
const pathspec = (paths: string[]) => ({ args: ['--pathspec-from-file=-', '--pathspec-file-nul'], input: paths.join('\0') })

const indexError = (r: { stderr: string }) => {
  const out = r.stderr.trim()
  if (/index\.lock/.test(out)) return fail('Otro proceso de git está usando el repo.', 'Espera a que termine e inténtalo de nuevo.', out)
  return fail('No se pudo actualizar el stage.', 'Revisa la salida de git.', out)
}

/** Stage de los archivos (incluye nuevos y borrados); sin rutas, de todo. */
export function stage(root: string, paths?: string[]): Promise<void> {
  return single(root, async () => {
    const spec = paths && pathspec(paths)
    const r = await runGit(['--literal-pathspecs', 'add', '-A', ...(spec ? spec.args : [])], { cwd: root, input: spec?.input })
    if (r.code !== 0) throw indexError(r)
  })
}

/** Quita del stage los archivos (en un renombre, las dos rutas); sin rutas, todo. Sin commits todavía, los saca del index. */
export function unstage(root: string, paths?: string[]): Promise<void> {
  return single(root, async () => {
    const spec = paths && pathspec(paths)
    const args = (await hasHead(root))
      ? ['--literal-pathspecs', 'reset', '-q', ...(spec ? spec.args : [])]
      : ['--literal-pathspecs', 'rm', '-r', '-q', '--cached', ...(spec ? spec.args : ['.'])]
    const r = await runGit(args, { cwd: root, input: spec?.input })
    if (r.code !== 0) throw indexError(r)
  })
}

/** Último commit para el amend: su mensaje y, si ya está en alguna rama remota, cuál (el Push pedirá force). */
export async function lastCommit(root: string): Promise<LastCommit | null> {
  if (!(await hasHead(root))) return null
  const message = await runGitOk(['log', '-1', '--format=%B'], { cwd: root })
  const [summary = '', ...rest] = message.replace(/\s+$/, '').split('\n')
  const remotes = (await runGitOk(['for-each-ref', '--contains', 'HEAD', '--format=%(refname:short)', 'refs/remotes'], { cwd: root }))
    .split('\n')
    .filter((r) => r && !r.endsWith('/HEAD'))
  return { summary, description: rest.join('\n').replace(/^\n+/, ''), pushedTo: remotes[0] ?? null }
}

/**
 * Commit de lo que está en stage (o amend del último) con el mensaje tal cual, por stdin: sin editor y sin
 * pasar el texto por la línea de comandos. Corre los hooks del repo; si uno lo rechaza, su salida va en el error.
 */
export function commit(root: string, message: string, amend: boolean): Promise<{ hash: string }> {
  return single(root, async () => {
    if (!message.trim()) throw fail('El commit necesita un resumen.', 'Escribe el resumen del commit.')
    if (amend && !(await hasHead(root))) throw fail('No hay commit anterior para corregir.', 'Desmarca «amend».')
    if (!amend && (await runGit(['diff', '--cached', '--quiet'], { cwd: root })).code === 0) {
      throw fail('No hay nada en stage.', 'Pasa archivos a stage antes de hacer commit.')
    }
    const r = await runGit(['commit', '-q', '--cleanup=strip', ...(amend ? ['--amend'] : []), '-F', '-'], { cwd: root, input: message })
    if (r.code !== 0) {
      const out = `${r.stdout}\n${r.stderr}`.trim()
      if (/tell me who you are|empty ident|user\.email/i.test(out)) {
        throw fail('git no sabe quién eres.', 'Configura user.name y user.email (git config --global user.name "Tu Nombre").', out)
      }
      if (/index\.lock/.test(out)) throw fail('Otro proceso de git está usando el repo.', 'Espera a que termine e inténtalo de nuevo.', out)
      throw fail('El commit no se hizo.', 'Un hook del repo pudo rechazarlo: revisa la salida.', out)
    }
    return { hash: (await runGitOk(['rev-parse', 'HEAD'], { cwd: root })).trim() }
  })
}
