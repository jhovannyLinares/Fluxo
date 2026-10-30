import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { AppException } from '@shared/errors'
import type { PrCreateRequest, PrPrepare } from '@shared/pr-create'
import { parseRemote } from '@shared/web-links'
import { credentialToken, type TokenQuery } from './credentials'
import { pushTarget } from './push'
import { repoAccount } from './repo-account'
import { runGit, runGitOk } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

/** Repo de GitHub del remoto `remote` y el token de la cuenta del repo (la del avatar). */
type TokenOf = (host: string, q: TokenQuery) => Promise<string | null>

async function github(root: string, remote: string, fetchImpl: typeof fetch, tokenOf: TokenOf) {
  const url = (await runGitOk(['remote', 'get-url', '--end-of-options', remote], { cwd: root })).trim()
  const r = parseRemote(url)
  if (r?.host !== 'github') throw fail('Crear pull request solo funciona con GitHub por ahora.', 'El remoto no es de GitHub.')
  const slug = r.base.slice('https://github.com/'.length)
  const token = await tokenOf('github.com', { root })
  if (!token) throw fail('No hay sesión de GitHub para este repo.', 'Elige la cuenta en el avatar de arriba a la derecha o inicia sesión.')
  const api = async (path: string, init?: { method: string; body: unknown }) => {
    const res = await fetchImpl(`https://api.github.com/repos/${slug}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Fluxo',
        ...(init ? { 'Content-Type': 'application/json' } : {})
      },
      body: init ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000)
    })
    return res
  }
  return { slug, api }
}

/** Plantillas de PR del repo (en la rama que está abierta), donde GitHub las busca. */
export function prTemplates(root: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []
  const read = (dir: string, only?: RegExp) => {
    const abs = join(root, dir)
    if (!existsSync(abs)) return
    for (const f of readdirSync(abs, { withFileTypes: true })) {
      if (!f.isFile() || !/\.(md|txt)$/i.test(f.name) || (only && !only.test(f.name))) continue
      const name = dir ? `${dir}/${f.name}` : f.name
      // en Windows y macOS `PULL_REQUEST_TEMPLATE` y `pull_request_template` son la misma carpeta: no se repite
      if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue
      out.push({ name, body: readFileSync(join(abs, f.name), 'utf8') })
    }
  }
  const single = /^pull_request_template\.(md|txt)$/i
  read('.github', single)
  read('', single)
  read('docs', single)
  for (const d of ['.github/PULL_REQUEST_TEMPLATE', '.github/pull_request_template']) read(d)
  return out
}

/**
 * Datos para el formulario: la rama de origen en el remoto (o null si falta subirla), la destino (la pedida o la
 * principal del repo), plantillas, personas que se pueden asignar, etiquetas, aprobaciones que exige la rama destino
 * y cuánto entra. Todo se lee; nada se escribe.
 */
export async function prPrepare(root: string, localHead: string | undefined, base: string | undefined, fetchImpl: typeof fetch = fetch, tokenOf: TokenOf = credentialToken): Promise<PrPrepare> {
  const target = await pushTarget(root)
  const branch = localHead ?? target.branch
  if (!branch) throw fail('No estás en una rama (HEAD desacoplado).', 'Elige la rama de origen del pull request.')
  const cfg = async (key: string) => {
    const r = await runGit(['config', '--get', key], { cwd: root })
    return r.code === 0 ? r.stdout.trim() : null
  }
  const upRemote = await cfg(`branch.${branch}.remote`)
  const upMerge = await cfg(`branch.${branch}.merge`)
  const remote = upRemote && upRemote !== '.' ? upRemote : target.remotes.includes('origin') ? 'origin' : (target.remotes[0] ?? null)
  if (!remote) throw fail('El repo no tiene remotos.', 'Agrega el remoto de GitHub.')
  const head = upRemote === remote && upMerge?.startsWith('refs/heads/') ? upMerge.slice('refs/heads/'.length) : null

  const { slug, api } = await github(root, remote, fetchImpl, tokenOf)
  const branches = (await runGitOk(['for-each-ref', '--format=%(refname)', `refs/remotes/${remote}/`], { cwd: root }))
    .split('\n')
    .map((r) => r.trim().slice(`refs/remotes/${remote}/`.length))
    .filter((b) => b && b !== 'HEAD' && b !== head)

  const json = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      const res = await api(path)
      return res.ok ? ((await res.json()) as T) : fallback
    } catch {
      return fallback
    }
  }
  const [repoInfo, people, labels] = await Promise.all([
    json<{ default_branch?: string }>('', {}),
    json<{ login: string }[]>('/assignees?per_page=100', []),
    json<{ name: string }[]>('/labels?per_page=100', [])
  ])
  const chosen = base ?? repoInfo.default_branch ?? (branches.includes('main') ? 'main' : (branches[0] ?? 'main'))
  const rules = await json<{ type: string; parameters?: { required_approving_review_count?: number } }[]>(
    `/rules/branches/${chosen.split('/').map(encodeURIComponent).join('/')}`,
    []
  )
  const approvals = Math.max(0, ...rules.filter((r) => r.type === 'pull_request').map((r) => r.parameters?.required_approving_review_count ?? 0)) || null

  let diff: PrPrepare['diff'] = null
  if (head && branches.includes(chosen)) {
    const b = `refs/remotes/${remote}/${chosen}`
    const h = `refs/remotes/${remote}/${head}`
    const [commits, files, merge] = await Promise.all([
      runGit(['rev-list', '--count', `${b}..${h}`], { cwd: root }),
      runGit(['diff', '--name-only', '-z', `${b}...${h}`], { cwd: root }),
      // sin `--quiet` (no existe en git 2.48): código 1 = hay conflictos; la salida (árbol y avisos) se ignora
      runGit(['merge-tree', '--write-tree', b, h], { cwd: root })
    ])
    if (commits.code === 0 && files.code === 0) {
      diff = { commits: Number(commits.stdout.trim()), files: files.stdout.split('\0').filter(Boolean).length, conflicts: merge.code === 1 }
    }
  }

  return {
    slug,
    account: (await repoAccount(root)).current,
    remote,
    head,
    localHead: branch,
    base: chosen,
    branches,
    templates: prTemplates(root),
    people: people.map((p) => p.login),
    labels: labels.map((l) => l.name),
    approvals,
    diff
  }
}

/** Crea el PR en GitHub y después pide revisores, asignados y etiquetas. Devuelve su número y su página. */
export async function prCreate(root: string, remote: string, req: PrCreateRequest, fetchImpl: typeof fetch = fetch, tokenOf: TokenOf = credentialToken): Promise<{ number: number; url: string; warning: string | null }> {
  const { api } = await github(root, remote, fetchImpl, tokenOf)
  const res = await api('/pulls', { method: 'POST', body: { title: req.title, body: req.body, head: req.head, base: req.base, draft: req.draft } })
  if (!res.ok) {
    const text = await res.text()
    const msg = (() => {
      try {
        const j = JSON.parse(text) as { message?: string; errors?: { message?: string }[] }
        return [j.message, ...(j.errors ?? []).map((e) => e.message)].filter(Boolean).join(' · ')
      } catch {
        return text
      }
    })()
    if (/already exists/i.test(msg)) throw fail('Ya hay un pull request abierto entre esas ramas.', 'Ábrelo desde el panel de pull requests.', msg)
    if (/No commits between/i.test(msg)) throw fail('No hay commits nuevos entre esas ramas.', 'Elige otra rama destino o sube los commits.', msg)
    if (res.status === 403 || res.status === 404) throw fail('GitHub rechazó el pull request: la cuenta no tiene permiso.', 'Revisa la cuenta en el avatar de arriba a la derecha.', msg)
    throw fail(`GitHub respondió ${res.status} al crear el pull request.`, 'Revisa la salida.', msg)
  }
  const pr = (await res.json()) as { number: number; html_url: string }
  // si una de estas falla (persona sin permiso, etiqueta borrada), el PR ya existe: se avisa sin fallar
  const failed: string[] = []
  const extra = async (what: string, path: string, body: unknown, method = 'POST') => {
    const r = await api(path, { method, body }).catch(() => null)
    if (!r?.ok) failed.push(what)
  }
  if (req.reviewers.length) await extra('revisores', `/pulls/${pr.number}/requested_reviewers`, { reviewers: req.reviewers })
  if (req.assignees.length) await extra('asignados', `/issues/${pr.number}/assignees`, { assignees: req.assignees })
  if (req.labels.length) await extra('etiquetas', `/issues/${pr.number}/labels`, { labels: req.labels })
  return { number: pr.number, url: pr.html_url, warning: failed.length ? `El pull request se creó, pero no se pudieron agregar: ${failed.join(', ')}.` : null }
}
