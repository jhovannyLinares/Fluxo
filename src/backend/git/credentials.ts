import type { GitRun } from './accounts'
import { runGit } from './runner'

export interface TokenQuery {
  path?: string
  /** carpeta del repo: git aplica la cuenta fijada en su .git/config (avatar), no la que Git Credential Manager elija */
  root?: string
  /** cuenta concreta, cuando hay más de una guardada para el host */
  username?: string
  run?: GitRun
}

/**
 * Token que Git Credential Manager tiene para ese host, pedido en memoria con `git credential fill` y sin abrir
 * ventanas. Nunca se guarda ni se registra; null si no hay.
 */
export async function credentialToken(host: string, q: TokenQuery = {}): Promise<string | null> {
  const input = `protocol=https\nhost=${host}\n${q.path ? `path=${q.path}\n` : ''}${q.username ? `username=${q.username}\n` : ''}\n`
  const r = await (q.run ?? runGit)(['credential', 'fill'], { cwd: q.root, input, env: { GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 30_000 })
  if (r.code !== 0) return null
  const m = /^password=(.*)$/m.exec(r.stdout)
  return m?.[1]?.trim() || null
}

/** Azure DevOps: GCM guarda un token OAuth (JWT, con puntos); un PAT va como contraseña con usuario vacío. */
export const azureAuthorization = (token: string): string => (token.includes('.') ? `Bearer ${token}` : `Basic ${Buffer.from(`:${token}`).toString('base64')}`)
