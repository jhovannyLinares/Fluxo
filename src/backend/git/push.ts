import { AppException } from '@shared/errors'
import type { LostCommit, PushRequest, PushResult, PushTarget } from '@shared/push'
import { print } from './pull'
import { runGit, runGitOk } from './runner'

/** Un push por repo a la vez. */
const running = new Map<string, Promise<PushResult>>()

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

const config = async (root: string, key: string): Promise<string | null> => {
  const r = await runGit(['config', '--get', key], { cwd: root })
  return r.code === 0 ? r.stdout.trim() || null : null
}

/** Rama actual, su upstream (si branch.<rama>.remote y .merge existen) y los remotos del repo. */
export async function pushTarget(root: string): Promise<PushTarget> {
  const head = await runGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root })
  const branch = head.code === 0 ? head.stdout.trim() : null
  const remotes = (await runGitOk(['remote'], { cwd: root })).split('\n').filter(Boolean)
  if (!branch) return { branch: null, upstream: null, remotes }
  const remote = await config(root, `branch.${branch}.remote`)
  const merge = await config(root, `branch.${branch}.merge`)
  const upstream = remote && remote !== '.' && merge?.startsWith('refs/heads/') ? `${remote}/${merge.slice('refs/heads/'.length)}` : null
  return { branch, upstream, remotes }
}

/**
 * Push de la rama actual, como GitKraken: al upstream sin preguntar; sin upstream, al destino elegido en el diálogo
 * (y queda como upstream). Si el remoto lo rechaza por tener commits que la rama no tiene, no falla: trae esa rama
 * remota y responde `rejected` con los commits que un force push descartaría. El force usa --force-with-lease con el
 * hash que se le mostró al usuario: si alguien subió algo después, se cancela en vez de pisarlo. Cuarta escritura.
 */
export function push(root: string, req: PushRequest): Promise<PushResult> {
  const key = root.toLowerCase()
  const current = running.get(key)
  if (current) return current
  const p = (async (): Promise<PushResult> => {
    const t0 = performance.now()
    const target = await pushTarget(root)
    if (!target.branch) throw fail('No estás en una rama (HEAD desacoplado).', 'Cambia a una rama con doble clic antes de hacer push.')
    let remote: string
    let remoteBranch: string
    if (req.to) {
      if (!target.remotes.includes(req.to.remote)) throw fail(`El remoto ${req.to.remote} no existe.`, 'Elige uno de la lista.')
      remote = req.to.remote
      remoteBranch = req.to.branch
    } else if (target.upstream) {
      // de la configuración, no del texto `origin/x`: un remoto puede tener `/` en el nombre
      remote = (await config(root, `branch.${target.branch}.remote`))!
      remoteBranch = (await config(root, `branch.${target.branch}.merge`))!.slice('refs/heads/'.length)
    } else {
      throw fail('La rama todavía no existe en el remoto.', 'Elige a qué remoto y rama subirla.')
    }
    const dest = `refs/heads/${remoteBranch}`
    const args = ['push', '--porcelain']
    if (req.to) args.push('--set-upstream')
    if (req.forceExpected) args.push(`--force-with-lease=${dest}:${req.forceExpected}`)
    args.push('--end-of-options', remote, `refs/heads/${target.branch}:${dest}`)

    const before = await print(root)
    const r = await runGit(args, { cwd: root, timeoutMs: 300_000 })
    const out = r.stdout + r.stderr
    if (r.code !== 0) {
      if (req.forceExpected && /stale info|\(stale/i.test(out)) {
        throw fail(
          `Alguien subió algo nuevo a ${remote}/${remoteBranch} mientras confirmabas: no se forzó.`,
          'Vuelve a hacer Push para ver lo nuevo antes de decidir.',
          out.trim()
        )
      }
      if (/\[rejected\]|non-fast-forward|fetch first|\(rejected\)/i.test(out) && !/protected|declined|TF402455|GH006/i.test(out)) {
        return rejected(root, target.branch, remote, remoteBranch, out.trim())
      }
      throw pushError(out)
    }
    return { status: 'pushed', changed: (await print(root)) !== before, ms: Math.round(performance.now() - t0) }
  })().finally(() => running.delete(key))
  running.set(key, p)
  return p
}

/** Trae la rama remota y lista los commits suyos que la rama local no tiene (los que un force push descartaría). */
async function rejected(root: string, branch: string, remote: string, remoteBranch: string, gitOutput: string): Promise<PushResult> {
  const tracking = `refs/remotes/${remote}/${remoteBranch}`
  const f = await runGit(['fetch', '--quiet', '--end-of-options', remote, `+refs/heads/${remoteBranch}:${tracking}`], { cwd: root, timeoutMs: 300_000 })
  if (f.code !== 0) throw pushError(f.stdout + f.stderr)
  const expected = (await runGitOk(['rev-parse', '--verify', tracking], { cwd: root })).trim()
  const log = await runGitOk(['log', '--format=%h%x00%s%x00%an%x00%ar', `refs/heads/${branch}..${tracking}`, '--'], { cwd: root })
  const lost: LostCommit[] = log
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash = '', subject = '', author = '', when = ''] = l.split('\0')
      return { hash, subject, author, when }
    })
  return { status: 'rejected', target: `${remote}/${remoteBranch}`, lost, expected, gitOutput }
}

/** Traduce los demás fallos de `git push` a un mensaje y una sugerencia legibles. */
export function pushError(out: string): AppException {
  const gitOutput = out.trim()
  if (/protected branch|GH006|TF402455|pre-receive hook declined|hook declined/i.test(out)) {
    return fail('El remoto rechazó el push: la rama está protegida o una regla del servidor no lo permite.', 'Súbela con un pull request desde otra rama.', gitOutput)
  }
  if (/authentication|could not read username|403|401|repository not found|permission denied/i.test(out)) {
    return fail('El push no pudo iniciar sesión en el remoto o no tienes permiso.', 'Revisa la cuenta en Preferencias ▸ Cuentas.', gitOutput)
  }
  if (/does not appear to be a git repository|no such remote|could not resolve host|unable to access/i.test(out)) {
    return fail('No se pudo llegar al remoto.', 'Revisa la conexión y la URL del remoto (Ayuda ▸ Entorno de git).', gitOutput)
  }
  return fail('El push falló.', 'Revisa la salida de git.', gitOutput)
}
