import { runGit } from '../git/runner'

export const MIN_GIT_VERSION = '2.40.0'

export function parseGitVersion(out: string): string | null {
  const m = /git version (\d+\.\d+\.\d+)/.exec(out)
  return m?.[1] ?? null
}

export function versionAtLeast(v: string, min: string): boolean {
  const a = v.split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

/** Quita usuario y contraseña de una URL de proxy antes de mostrarla. */
export function maskProxy(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1***@')
}

export type CheckId = 'git' | 'gcm' | 'helper' | 'proxy' | 'ssl'
/** ok: listo · info: dato sin problema · warn: funciona con límites · error: impide abrir repos */
export type CheckStatus = 'ok' | 'info' | 'warn' | 'error'

export interface EnvCheck {
  id: CheckId
  status: CheckStatus
  /** valor detectado (versión, helper, proxy sin credenciales); null si no hay */
  value: string | null
}

/** Datos crudos leídos de git y del entorno; `evaluateEnvironment` los convierte en chequeos. */
export interface RawEnvironment {
  gitVersion: string | null
  gitPath: string | null
  gcmVersion: string | null
  helpers: string[]
  gitProxy: string | null
  envProxy: string | null
  sslBackend: string | null
}

export function evaluateEnvironment(raw: RawEnvironment): EnvCheck[] {
  const gitOk = raw.gitVersion !== null && versionAtLeast(raw.gitVersion, MIN_GIT_VERSION)
  const checks: EnvCheck[] = [{ id: 'git', status: gitOk ? 'ok' : 'error', value: raw.gitVersion }]
  // sin git no se puede preguntar nada más
  if (raw.gitVersion === null) return checks
  checks.push({ id: 'gcm', status: raw.gcmVersion ? 'ok' : 'warn', value: raw.gcmVersion })
  // el último helper es el que responde (uno vacío anula los anteriores); `manager` (o `manager-core`, nombre antiguo) es GCM
  const helper = raw.helpers.at(-1) || null
  checks.push({ id: 'helper', status: helper && /^manager(-core)?$/.test(helper) ? 'ok' : 'warn', value: helper })
  const proxy = raw.gitProxy ?? raw.envProxy
  checks.push({ id: 'proxy', status: 'info', value: proxy ? maskProxy(proxy) : null })
  // schannel usa los certificados de Windows (CA corporativa); openssl usa su propio paquete
  checks.push({ id: 'ssl', status: raw.sslBackend === 'schannel' ? 'ok' : 'info', value: raw.sslBackend ?? 'openssl' })
  return checks
}

/** Primer arranque (9.1 / H05): git, versión, GCM, helper de credenciales, proxy y backend SSL. */
export async function checkEnvironment() {
  const git = async (args: string[]): Promise<string | null> => {
    try {
      const r = await runGit(args, { timeoutMs: 10_000 })
      return r.code === 0 ? r.stdout : null
    } catch {
      return null // git ausente: spawn falla
    }
  }
  const gitVersion = parseGitVersion((await git(['--version'])) ?? '')
  let raw: RawEnvironment = {
    gitVersion,
    gitPath: null,
    gcmVersion: null,
    helpers: [],
    gitProxy: null,
    envProxy: null,
    sslBackend: null
  }
  if (gitVersion) {
    const [gitPath, gcm, helpers, gitProxy, sslBackend] = await Promise.all([
      git(['--exec-path']),
      git(['credential-manager', '--version']),
      git(['config', '--get-all', 'credential.helper']),
      git(['config', '--get', 'http.proxy']),
      git(['config', '--get', 'http.sslBackend'])
    ])
    const env = process.env
    raw = {
      gitVersion,
      gitPath: gitPath?.trim() || null,
      gcmVersion: gcm?.split('+')[0]!.trim() || null,
      // una línea por valor, sin recortar: un valor vacío al final es un reinicio de la lista
      helpers: helpers ? helpers.replace(/\r?\n$/, '').split(/\r?\n/).map((h) => h.trim()) : [],
      gitProxy: gitProxy?.trim() || null,
      envProxy: env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || null,
      sslBackend: sslBackend?.trim() || null
    }
  }
  const checks = evaluateEnvironment(raw)
  return {
    gitFound: gitVersion !== null,
    gitVersion,
    gitVersionOk: checks[0]!.status === 'ok',
    gcmFound: raw.gcmVersion !== null,
    minGitVersion: MIN_GIT_VERSION,
    gitPath: raw.gitPath,
    checks
  }
}
