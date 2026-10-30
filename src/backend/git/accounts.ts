import { AppException } from '@shared/errors'
import type { AccountsInfo } from '@shared/accounts'
import { runGit, type RunOptions, type RunResult } from './runner'

/** Cómo se lanza git; las pruebas lo cambian por uno falso para no tocar las cuentas reales. */
export type GitRun = (args: readonly string[], opts?: RunOptions) => Promise<RunResult>

/** GCM puede abrir su ventana o el navegador solo cuando la persona lo pidió con un botón. */
const INTERACTIVE = { GCM_INTERACTIVE: 'always' }
const QUIET = { GCM_INTERACTIVE: 'never' }

const fail = (message: string, r: RunResult, suggestion?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, gitOutput: (r.stdout + r.stderr).trim() })

/**
 * A12: cuentas de GitHub que guarda Git Credential Manager y las organizaciones de Azure DevOps enlazadas. Fluxo no
 * guarda credenciales: solo muestra lo que tiene GCM. Sin GCM, `gcm` es false y la pantalla lo dice.
 */
export async function listAccounts(run: GitRun = runGit): Promise<AccountsInfo> {
  const version = await run(['credential-manager', '--version'], { env: QUIET, timeoutMs: 20_000 })
  if (version.code !== 0) return { gcm: false, version: null, github: [], azure: [] }
  const gh = await run(['credential-manager', 'github', 'list'], { env: QUIET, timeoutMs: 20_000 })
  const az = await run(['credential-manager', 'azure-repos', 'list'], { env: QUIET, timeoutMs: 20_000 })
  return {
    gcm: true,
    version: version.stdout.trim().split('+')[0] ?? null,
    github: gh.code === 0 ? parseLines(gh.stdout) : [],
    azure: az.code === 0 ? parseAzure(az.stdout) : []
  }
}

/** Una cuenta por línea, sin vacías ni repetidas. */
export function parseLines(out: string): string[] {
  return [...new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))]
}

/**
 * `azure-repos list`: «organización:» y debajo «  (global) -> usuario» o «  url -> usuario». Formato supuesto: en la
 * máquina de Gio no hay organizaciones enlazadas para verlo; se confirma en la beta.
 */
export function parseAzure(out: string): { org: string; user: string }[] {
  const res: { org: string; user: string }[] = []
  let org = ''
  for (const line of out.split(/\r?\n/)) {
    const head = /^(\S[^:]*):\s*$/.exec(line)
    if (head) org = head[1]!.trim()
    const bind = /->\s*(\S.*)$/.exec(line)
    if (org && bind) res.push({ org, user: bind[1]!.trim() })
  }
  return res
}

/** «Iniciar sesión con GitHub»: GCM abre el navegador y guarda la cuenta. Espera hasta 10 minutos. */
export async function githubLogin(run: GitRun = runGit): Promise<void> {
  const r = await run(['credential-manager', 'github', 'login', '--browser'], { env: INTERACTIVE, timeoutMs: 600_000 })
  if (r.code !== 0) throw fail('No se pudo iniciar sesión en GitHub.', r, 'Si cerraste la ventana del navegador, vuelve a intentar.')
}

/** «Cerrar sesión»: GCM borra la cuenta de GitHub de las credenciales de Windows. */
export async function githubLogout(account: string, run: GitRun = runGit): Promise<void> {
  // GCM no entiende --end-of-options; el contrato solo deja pasar nombres de GitHub, que no empiezan con guion
  const r = await run(['credential-manager', 'github', 'logout', account], { env: QUIET, timeoutMs: 30_000 })
  if (r.code !== 0) throw fail(`No se pudo cerrar la sesión de ${account}.`, r)
}

/**
 * «Probar» (y primer inicio de sesión en Azure DevOps): `git ls-remote` contra el remoto del repo abierto. Si falta la
 * credencial, GCM abre su ventana, la pide y la guarda. Solo lee del servidor.
 */
export async function testRemote(root: string, remote: string, run: GitRun = runGit): Promise<{ ms: number }> {
  const t0 = performance.now()
  const r = await run(['ls-remote', '--heads', '--end-of-options', remote], { cwd: root, env: INTERACTIVE, timeoutMs: 600_000 })
  if (r.code !== 0) {
    const auth = /authentication|403|401|could not read Username|denied/i.test(r.stderr)
    throw fail(
      auth ? 'El servidor rechazó la credencial.' : 'No se pudo conectar con el remoto.',
      r,
      auth ? 'Inicia sesión otra vez con esa cuenta.' : 'Revisa la red, el proxy o la URL del remoto.'
    )
  }
  return { ms: Math.round(performance.now() - t0) }
}
