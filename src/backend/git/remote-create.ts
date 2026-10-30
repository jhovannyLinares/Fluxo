import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AppException } from '@shared/errors'
import type { GitRun } from './accounts'
import { azureAuthorization, credentialToken } from './credentials'
import { initRepo, type InitOptions } from './init'
import { runGit, type RunResult } from './runner'

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: () => Promise<string> }>
type Created = { cloneUrl: string; webUrl: string }

export type Provider = 'github' | 'azure'

export interface RemoteCreateOptions extends Omit<InitOptions, 'name' | 'parent'> {
  provider: Provider
  /** GitHub: cuenta de GCM; Azure DevOps: usuario enlazado a la organización */
  account: string
  /** solo Azure DevOps */
  org?: string | undefined
  project?: string | undefined
  name: string
  description?: string | undefined
  private?: boolean | undefined
  /** «Clone after init»: inicializa la carpeta local, la enlaza y sube el primer commit */
  parent?: string | undefined
}

/** Las pruebas cambian estas dependencias por un servidor local; en producción son GitHub y Azure DevOps reales. */
export interface RemoteCreateDeps {
  run?: GitRun
  fetch?: Fetch
  token?: (host: string, account: string) => Promise<string>
  githubApi?: string
  azureApi?: string
}

const GITHUB_API = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
const AZURE_API = 'https://dev.azure.com'
const AZURE_API_VERSION = '7.1'
const REQUEST_TIMEOUT_MS = 30_000
const PUSH_TIMEOUT_MS = 10 * 60_000
const AZURE_ORG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const GITHUB_REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/
const HTTP_CREATED = 201
const HTTP_OK = 200
const HTTP_CONFLICT = 409
const HTTP_UNPROCESSABLE = 422

const invalid = (message: string, suggestion?: string) =>
  new AppException({ code: 'INVALID_REQUEST', message, ...(suggestion ? { suggestion } : {}) })

const realFetch: Fetch = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  return { status: r.status, text: () => r.text() }
}

/** La credencial que Git Credential Manager ya tiene para esa cuenta; sin ella no hay forma de hablar con el servidor. */
export async function savedToken(host: string, account: string, run?: GitRun): Promise<string> {
  const token = await credentialToken(host, { username: account, ...(run ? { run } : {}) })
  if (token) return token
  throw new AppException({
    code: 'GIT_FAILED',
    message: `No hay una sesión guardada de ${account} en ${host}.`,
    suggestion: 'Inicia sesión desde Cuentas y vuelve a intentar.'
  })
}

async function callApi(f: Fetch, method: string, url: string, headers: Record<string, string>, body?: object): Promise<{ status: number; json: Record<string, unknown> }> {
  const baseHeaders = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Fluxo' }
  let res
  try {
    res = await f(url, { method, headers: { ...baseHeaders, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
  } catch (e) {
    throw new AppException({ code: 'GIT_FAILED', message: 'No se pudo conectar con el servidor.', suggestion: 'Revisa la red o el proxy.', gitOutput: String(e) })
  }
  try {
    return { status: res.status, json: JSON.parse(await res.text()) as Record<string, unknown> }
  } catch {
    // el servidor respondió sin cuerpo JSON (p. ej. una página de error): del código de estado basta para decidir
    return { status: res.status, json: {} }
  }
}

function rejected(status: number, what: string): AppException {
  const authFailed = status === 401 || status === 403
  return new AppException({
    code: 'GIT_FAILED',
    message: authFailed ? 'El servidor rechazó la credencial.' : `No se pudo ${what}.`,
    suggestion: authFailed ? 'Inicia sesión otra vez con esa cuenta (o autoriza el SSO de la organización).' : `El servidor respondió ${status}.`
  })
}

function checkAzureOrg(org: string): void {
  if (!AZURE_ORG.test(org)) throw invalid('Esa organización no es válida.')
}

/** Proyectos de una organización de Azure DevOps, para el desplegable «Project». */
export async function azureProjects(org: string, account: string, d: RemoteCreateDeps = {}): Promise<string[]> {
  checkAzureOrg(org)
  const token = await (d.token ?? savedToken)('dev.azure.com', account)
  const url = `${d.azureApi ?? AZURE_API}/${encodeURIComponent(org)}/_apis/projects?api-version=${AZURE_API_VERSION}`
  const r = await callApi(d.fetch ?? realFetch, 'GET', url, { Authorization: azureAuthorization(token) })
  if (r.status !== HTTP_OK) throw rejected(r.status, 'listar los proyectos')
  const projects = (r.json.value as { name?: string }[] | undefined) ?? []
  return projects.map((p) => p.name ?? '').filter(Boolean).sort((a, b) => a.localeCompare(b))
}

async function createOnGithub(o: RemoteCreateOptions, d: RemoteCreateDeps): Promise<Created> {
  if (!GITHUB_REPO_NAME.test(o.name)) throw invalid('El nombre solo puede llevar letras, números, punto, guion y guion bajo.')
  const token = await (d.token ?? savedToken)('github.com', o.account)
  const headers = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': GITHUB_API_VERSION }
  const r = await callApi(d.fetch ?? realFetch, 'POST', `${d.githubApi ?? GITHUB_API}/user/repos`, headers, {
    name: o.name,
    description: o.description ?? '',
    private: o.private ?? false
  })
  if (r.status === HTTP_UNPROCESSABLE) throw invalid(`Ya existe un repositorio «${o.name}» en la cuenta ${o.account}, o el nombre no es válido.`, 'Elige otro nombre.')
  if (r.status !== HTTP_CREATED) throw rejected(r.status, 'crear el repositorio en GitHub')
  return { cloneUrl: String(r.json.clone_url), webUrl: String(r.json.html_url) }
}

async function createOnAzure(o: RemoteCreateOptions, d: RemoteCreateDeps): Promise<Created> {
  const org = o.org ?? ''
  if (!AZURE_ORG.test(org) || !o.project) throw invalid('Elige la organización y el proyecto de Azure DevOps.')
  const token = await (d.token ?? savedToken)('dev.azure.com', o.account)
  const url = `${d.azureApi ?? AZURE_API}/${encodeURIComponent(org)}/${encodeURIComponent(o.project)}/_apis/git/repositories?api-version=${AZURE_API_VERSION}`
  const r = await callApi(d.fetch ?? realFetch, 'POST', url, { Authorization: azureAuthorization(token) }, { name: o.name })
  if (r.status === HTTP_CONFLICT) throw invalid(`Ya existe un repositorio «${o.name}» en ${o.project}.`, 'Elige otro nombre.')
  if (r.status !== HTTP_OK && r.status !== HTTP_CREATED) throw rejected(r.status, 'crear el repositorio en Azure DevOps')
  return { cloneUrl: String(r.json.remoteUrl), webUrl: String(r.json.webUrl) }
}

const createOnServer = (o: RemoteCreateOptions, d: RemoteCreateDeps): Promise<Created> => (o.provider === 'github' ? createOnGithub(o, d) : createOnAzure(o, d))

/** Enlaza la carpeta local como `origin` y sube la rama inicial; si falla, el error dice que el remoto ya existe. */
async function publishLocal(o: RemoteCreateOptions, path: string, created: Created, run: GitRun): Promise<void> {
  const failed = (what: string, r: RunResult) =>
    new AppException({
      code: 'GIT_FAILED',
      message: `El repositorio se creó en ${created.webUrl}, pero ${what}.`,
      suggestion: `La carpeta local quedó en ${path}; enlázala y sube la rama a mano.`,
      gitOutput: (r.stdout + r.stderr).trim()
    })
  const add = await run(['remote', 'add', 'origin', '--', created.cloneUrl], { cwd: path })
  if (add.code !== 0) throw failed('no se pudo enlazar como origin', add)
  // GCM elige cuenta por URL: sin esto subiría con la última cuenta de GitHub usada, no con la elegida
  const account = o.provider === 'github' ? ['-c', `credential.https://github.com.username=${o.account}`] : []
  const branch = (o.branch ?? '').trim() || 'main'
  const push = await run([...account, 'push', '-u', 'origin', branch], { cwd: path, timeoutMs: PUSH_TIMEOUT_MS })
  if (push.code !== 0) throw failed('no se pudo subir la rama inicial', push)
}

/**
 * «Create Repository and Clone» de GitKraken: crea el repo vacío en GitHub o Azure DevOps y, con «Clone after init»,
 * lo inicializa en la carpeta local (README, .gitignore, licencia, commit inicial) y sube la rama. Lo local va primero
 * para validar plantillas, rama y carpeta antes de crear nada en el servidor; si el servidor falla, se deshace.
 */
export async function createRemoteRepo(o: RemoteCreateOptions, d: RemoteCreateDeps = {}): Promise<{ path: string | null; url: string; webUrl: string }> {
  if (!o.parent) {
    const created = await createOnServer(o, d)
    return { path: null, url: created.cloneUrl, webUrl: created.webUrl }
  }
  const dest = join(o.parent, o.name.trim())
  const folderExisted = existsSync(dest)
  const { path } = await initRepo({ ...o, name: o.name, parent: o.parent })
  let created: Created
  try {
    created = await createOnServer(o, d)
  } catch (e) {
    rmSync(dest, { recursive: true, force: true })
    if (folderExisted) mkdirSync(dest, { recursive: true })
    throw e
  }
  await publishLocal(o, path, created, d.run ?? runGit)
  return { path, url: created.cloneUrl, webUrl: created.webUrl }
}
