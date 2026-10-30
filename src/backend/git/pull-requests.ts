import { AppException } from '@shared/errors'
import { parseAzurePulls, parseGithubPulls, type PullRequest } from '@shared/pull-requests'
import { parseRemote } from '@shared/web-links'
import { azureAuthorization, credentialToken } from './credentials'
import { runGit } from './runner'

/** Resultado para el panel: sin remoto de GitHub o Azure, `provider` es null y la sección no se muestra. */
export interface PullRequestsResult {
  provider: 'github' | 'azure' | null
  prs: PullRequest[]
  /** sin credencial guardada: el panel ofrece ir a Cuentas */
  needsLogin: boolean
}

/** URL del remoto (el del upstream de la rama actual o `origin`). */
async function remoteUrl(root: string): Promise<string | null> {
  const up = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd: root })
  const name = up.code === 0 ? up.stdout.trim().split('/')[0]! : 'origin'
  const r = await runGit(['remote', 'get-url', '--end-of-options', name], { cwd: root })
  return r.code === 0 ? r.stdout.trim() : null
}

/** A4: PR abiertos del remoto del repo, de GitHub o de Azure DevOps. Solo lee. */
export async function listPullRequests(root: string, fetchImpl: typeof fetch = fetch): Promise<PullRequestsResult> {
  const url = await remoteUrl(root)
  const remote = url ? parseRemote(url) : null
  if (!remote) return { provider: null, prs: [], needsLogin: false }
  const signal = AbortSignal.timeout(20_000)
  if (remote.host === 'github') {
    const [, owner, repo] = /github\.com\/([^/]+)\/([^/]+)$/.exec(remote.base)!
    const token = await credentialToken('github.com', { root })
    const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Fluxo', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal
    })
    // repo privado sin credencial o con una cuenta sin acceso: GitHub responde 404; organización con SSO sin autorizar: 403
    if (res.status === 401 || (res.status === 404 && !token)) return { provider: 'github', prs: [], needsLogin: true }
    if (res.status === 404 || (res.status === 403 && /SAML|SSO/i.test(await res.clone().text()))) {
      return { provider: 'github', prs: [], needsLogin: true }
    }
    if (!res.ok) throw apiError('GitHub', res.status)
    return { provider: 'github', prs: parseGithubPulls(await res.json()), needsLogin: false }
  }
  // Azure DevOps: https://dev.azure.com/org/proj/_git/repo o https://org.visualstudio.com/proj/_git/repo
  const m = /^https:\/\/(?:dev\.azure\.com\/([^/]+)|([^.]+)\.visualstudio\.com)\/([^/]+)\/_git\/([^/]+)$/.exec(remote.base)!
  const org = m[1] ?? m[2]!
  const api = `https://dev.azure.com/${org}/${m[3]}/_apis/git/repositories/${m[4]}/pullrequests?searchCriteria.status=active&api-version=7.0`
  const token = (await credentialToken('dev.azure.com', { path: org })) ?? (await credentialToken(`${org}.visualstudio.com`))
  if (!token) return { provider: 'azure', prs: [], needsLogin: true }
  const res = await fetchImpl(api, { headers: { Authorization: azureAuthorization(token), Accept: 'application/json' }, signal })
  if (res.status === 401 || res.status === 203) return { provider: 'azure', prs: [], needsLogin: true }
  if (!res.ok) throw apiError('Azure DevOps', res.status)
  return { provider: 'azure', prs: parseAzurePulls(await res.json(), remote.base), needsLogin: false }
}

const apiError = (who: string, status: number) =>
  new AppException({
    code: 'GIT_FAILED',
    message: `${who} respondió ${status} al pedir los PR.`,
    suggestion: status === 403 ? 'Puede ser el límite de consultas; vuelve a intentar en unos minutos.' : 'Revisa la red o la cuenta en Preferencias ▸ Cuentas.'
  })
