import { AppException } from '@shared/errors'
import type { AccountAccess, RepoAccount } from '@shared/accounts'
import { parseLines, type GitRun } from './accounts'
import { runGit } from './runner'

const QUIET = { GCM_INTERACTIVE: 'never' }
const INTERACTIVE = { GCM_INTERACTIVE: 'always' }
/** clave por URL: le gana a un `credential.username` global y solo aplica a github.com */
const KEY = 'credential.https://github.com.username'

/** Remoto de GitHub por HTTPS (origin primero): solo ahí se elige cuenta de Git Credential Manager. */
async function githubRemote(root: string, run: GitRun): Promise<{ name: string; url: string } | null> {
  const r = await run(['config', '--get-regexp', '^remote\\..*\\.url$'], { cwd: root })
  const remotes = r.stdout
    .split('\n')
    .map((l) => /^remote\.(.+)\.url\s+(\S+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m && /^https:\/\/github\.com\//i.test(m[2]!))
    .map((m) => ({ name: m[1]!, url: m[2]! }))
  return remotes.find((x) => x.name === 'origin') ?? remotes[0] ?? null
}

/** Cuenta de GitHub del repo: la fijada en su configuración (o ninguna = GCM elige) y las que guarda GCM. */
export async function repoAccount(root: string, run: GitRun = runGit): Promise<RepoAccount> {
  const remote = await githubRemote(root, run)
  if (!remote) return { remote: null, owner: null, current: null, accounts: [] }
  const [byUrl, plain, list] = await Promise.all([
    run(['config', '--get', KEY], { cwd: root }),
    run(['config', '--get', 'credential.username'], { cwd: root }),
    run(['credential-manager', 'github', 'list'], { env: QUIET, timeoutMs: 20_000 })
  ])
  const current = (byUrl.code === 0 && byUrl.stdout.trim()) || (plain.code === 0 && plain.stdout.trim()) || null
  const owner = /^https:\/\/github\.com\/([^/]+)/i.exec(remote.url)?.[1] ?? null
  return { remote: remote.name, owner, current, accounts: list.code === 0 ? parseLines(list.stdout) : [] }
}

/**
 * Prueba cada cuenta contra el remoto con `ls-remote` (solo lee, sin abrir ventanas): `ok`, `sso` (la organización
 * exige reautorizar el token con SAML SSO) o `none` (GitHub responde «not found» o rechaza la credencial).
 */
export async function accountAccess(root: string, accounts: string[], run: GitRun = runGit): Promise<Record<string, AccountAccess>> {
  const remote = await githubRemote(root, run)
  if (!remote) return {}
  const entries = await Promise.all(
    accounts.map(async (a) => {
      const r = await run(['-c', `${KEY}=${a}`, 'ls-remote', '--heads', '--end-of-options', remote.name], { cwd: root, env: QUIET, timeoutMs: 30_000 })
      const state: AccountAccess = r.code === 0 ? 'ok' : /SAML SSO|re-authorize/i.test(r.stderr) ? 'sso' : 'none'
      return [a, state] as const
    })
  )
  return Object.fromEntries(entries)
}

/** Fija la cuenta en el .git/config de este repo; null la quita y GCM vuelve a elegir sola. */
export async function setRepoAccount(root: string, account: string | null, run: GitRun = runGit): Promise<void> {
  const r = account
    ? await run(['config', '--local', KEY, account], { cwd: root })
    : await run(['config', '--local', '--unset-all', KEY], { cwd: root })
  // 5 = la clave no existía: quitarla ya está hecho
  if (r.code !== 0 && !(account === null && r.code === 5)) {
    throw new AppException({ code: 'GIT_FAILED', message: 'No se pudo guardar la cuenta del repo.', gitOutput: r.stderr.trim() })
  }
}

/** Renovar el token de una cuenta tras autorizar el SSO en el navegador: GCM cierra la sesión y vuelve a abrirla. */
export async function reloginAccount(account: string, run: GitRun = runGit): Promise<void> {
  await run(['credential-manager', 'github', 'logout', account], { env: QUIET, timeoutMs: 30_000 })
  const r = await run(['credential-manager', 'github', 'login', '--browser', '--username', account], { env: INTERACTIVE, timeoutMs: 600_000 })
  if (r.code !== 0) {
    throw new AppException({
      code: 'GIT_FAILED',
      message: `No se pudo iniciar sesión con ${account}.`,
      suggestion: 'Si cerraste la ventana del navegador, vuelve a intentar.',
      gitOutput: (r.stdout + r.stderr).trim()
    })
  }
}
