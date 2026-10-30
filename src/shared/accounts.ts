import { z } from 'zod'

/** A12: lo que Git Credential Manager tiene guardado; Fluxo no guarda credenciales. */
export const AccountsInfoSchema = z.object({
  /** false si Git Credential Manager no está instalado */
  gcm: z.boolean(),
  version: z.string().nullable(),
  github: z.array(z.string()),
  azure: z.array(z.object({ org: z.string(), user: z.string() }))
})
export type AccountsInfo = z.infer<typeof AccountsInfoSchema>

/** Nombre de cuenta de GitHub; las gestionadas (EMU) llevan `_` (ext-usuario_empresa). */
export const GithubAccountSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/)

/** Cuenta de GitHub del repo: `current` = la fijada en su .git/config (null = GCM elige); sin remoto GitHub, todo null. */
export const RepoAccountSchema = z.object({
  remote: z.string().nullable(),
  owner: z.string().nullable(),
  current: z.string().nullable(),
  accounts: z.array(z.string())
})
export type RepoAccount = z.infer<typeof RepoAccountSchema>

/** Resultado de probar una cuenta contra el remoto: entra, la organización pide SSO, o no tiene acceso. */
export const AccountAccessSchema = z.enum(['ok', 'sso', 'none'])
export type AccountAccess = z.infer<typeof AccountAccessSchema>
