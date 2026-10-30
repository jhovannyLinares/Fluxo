import { z } from 'zod'

/** Nombre de rama en el remoto: sin opciones disfrazadas ni caracteres que git no admite. */
export const RemoteBranchSchema = z.string().regex(/^(?!-)[^\0\s~^:?*[\\]+$/).max(255)
const LoginSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/)

/** Lo que el formulario «Crear pull request» necesita: ramas, plantillas, personas, etiquetas y la regla de la rama. */
export const PrPrepareSchema = z.object({
  /** owner/repo en GitHub */
  slug: z.string(),
  /** cuenta con que se va a crear (la del avatar del repo) */
  account: z.string().nullable(),
  remote: z.string(),
  /** rama de origen en el remoto; null = la local todavía no está subida */
  head: z.string().nullable(),
  /** la rama local de origen (para «Publicar y seguir») */
  localHead: z.string(),
  base: z.string(),
  branches: z.array(z.string()),
  templates: z.array(z.object({ name: z.string(), body: z.string() })),
  people: z.array(z.string()),
  labels: z.array(z.string()),
  /** aprobaciones que exige la rama destino (rulesets); null = no se pudo leer o no exige */
  approvals: z.number().int().nullable(),
  /** commits y archivos de head que no están en base; conflicts = git merge-tree encontró conflicto */
  diff: z.object({ commits: z.number().int(), files: z.number().int(), conflicts: z.boolean() }).nullable()
})
export type PrPrepare = z.infer<typeof PrPrepareSchema>

export const PrCreateRequestSchema = z.object({
  base: RemoteBranchSchema,
  head: RemoteBranchSchema,
  title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536),
  draft: z.boolean(),
  reviewers: z.array(LoginSchema).max(50),
  assignees: z.array(LoginSchema).max(10),
  labels: z.array(z.string().min(1).max(100)).max(50)
})
export type PrCreateRequest = z.infer<typeof PrCreateRequestSchema>
