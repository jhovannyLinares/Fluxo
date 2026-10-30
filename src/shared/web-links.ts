import { z } from 'zod'

/** Qué abrir en la web (H23). `name` = nombre de la rama en el remoto (sin `origin/`). */
export const WebTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commit'), hash: z.string().regex(/^[0-9a-f]{7,64}$/) }),
  z.object({ kind: z.literal('branch'), ref: z.string().min(1).max(1024) }),
  z.object({ kind: z.literal('prs'), ref: z.string().min(1).max(1024) })
])
export type WebTarget = z.infer<typeof WebTargetSchema>

export interface WebRemote {
  host: 'github' | 'azure'
  /** página del repo, sin barra final: `https://github.com/o/r`, `https://dev.azure.com/org/proj/_git/repo` */
  base: string
}

const clean = (s: string) => s.replace(/\.git$/, '').replace(/\/+$/, '')

/**
 * URL de un remoto → página del repo. Acepta HTTPS (con usuario o token delante de `@`, que se descarta) y SSH;
 * otro proveedor = null.
 */
export function parseRemote(url: string): WebRemote | null {
  const u = url.trim()
  let m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(u)
  if (m) return { host: 'github', base: `https://github.com/${m[1]}/${clean(m[2]!)}` }
  m = /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/.exec(u)
  if (m) return { host: 'azure', base: `https://dev.azure.com/${m[1]}/${m[2]}/_git/${clean(m[3]!)}` }
  m = /^(?:git@ssh\.dev\.azure\.com:v3\/|ssh:\/\/git@ssh\.dev\.azure\.com(?::22)?\/v3\/)([^/]+)\/([^/]+)\/([^/]+)$/.exec(u)
  if (m) return { host: 'azure', base: `https://dev.azure.com/${m[1]}/${m[2]}/_git/${clean(m[3]!)}` }
  // dominio antiguo de Azure DevOps; `DefaultCollection` es opcional
  m = /^https:\/\/(?:[^@/]+@)?([a-z0-9-]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/i.exec(u)
  if (m) return { host: 'azure', base: `https://${m[1]}.visualstudio.com/${m[2]}/_git/${clean(m[3]!)}` }
  return null
}

const segments = (name: string) => name.split('/').map(encodeURIComponent).join('/')

/** URL de la página de un commit, una rama o los PR de una rama; null si ese proveedor no la tiene sin su API. */
export function webUrl(remote: WebRemote, kind: WebTarget['kind'], value: string): string | null {
  if (kind === 'commit') return `${remote.base}/commit/${value}`
  if (remote.host === 'github') {
    return kind === 'branch' ? `${remote.base}/tree/${segments(value)}` : `${remote.base}/pulls?q=${encodeURIComponent(`is:pr head:${value}`)}`
  }
  // Azure: la lista de PR no se filtra por rama de origen en la URL; llega con la API (H22)
  return kind === 'branch' ? `${remote.base}?version=GB${encodeURIComponent(value)}` : null
}

/** Main solo abre en el navegador páginas https de estos proveedores. */
export function isProviderUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname === 'dev.azure.com' || u.hostname.endsWith('.visualstudio.com'))
  } catch {
    return false
  }
}
