import { z } from 'zod'

/** A4: un PR abierto del remoto, igual para GitHub y Azure DevOps. */
export const PullRequestSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  author: z.string(),
  /** rama de origen, sin `refs/heads/` */
  head: z.string(),
  /** rama de destino, sin `refs/heads/` */
  base: z.string(),
  draft: z.boolean(),
  /** página del PR (https de GitHub o Azure DevOps) */
  url: z.string()
})
export type PullRequest = z.infer<typeof PullRequestSchema>

const branch = (ref: string) => ref.replace(/^refs\/heads\//, '')

/** Respuesta de `GET /repos/{o}/{r}/pulls` de GitHub. */
export function parseGithubPulls(json: unknown): PullRequest[] {
  if (!Array.isArray(json)) return []
  return json.map((p) => ({
    id: Number(p.number),
    title: String(p.title ?? ''),
    author: String(p.user?.login ?? ''),
    head: String(p.head?.ref ?? ''),
    base: String(p.base?.ref ?? ''),
    draft: !!p.draft,
    url: String(p.html_url ?? '')
  }))
}

/** Respuesta de `GET …/_apis/git/repositories/{r}/pullrequests` de Azure DevOps; `base` = página del repo. */
export function parseAzurePulls(json: unknown, base: string): PullRequest[] {
  const list = (json as { value?: unknown[] } | null)?.value
  if (!Array.isArray(list)) return []
  return list.map((v) => {
    const p = v as Record<string, any>
    return {
      id: Number(p.pullRequestId),
      title: String(p.title ?? ''),
      author: String(p.createdBy?.displayName ?? ''),
      head: branch(String(p.sourceRefName ?? '')),
      base: branch(String(p.targetRefName ?? '')),
      draft: !!p.isDraft,
      url: `${base}/pullrequest/${p.pullRequestId}`
    }
  })
}
