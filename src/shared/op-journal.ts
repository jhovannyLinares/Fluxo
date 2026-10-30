import { z } from 'zod'

const HeadSchema = z.object({ sha: z.string().nullable(), branch: z.string().nullable() })

/**
 * Una escritura de Fluxo en la bitácora: qué, en qué repo, cuánto esperó y a quién, cuánto tardó, HEAD antes y
 * después, los comandos de git con su código de salida y el resultado. Con esto se reconstruye una secuencia sin el
 * reflog de git.
 */
export const OpEntrySchema = z.object({
  id: z.number().int(),
  op: z.string(),
  repo: z.string(),
  auto: z.boolean(),
  account: z.string().optional(),
  queuedAt: z.string(),
  waitedMs: z.number(),
  waitedFor: z.string().optional(),
  ms: z.number(),
  before: HeadSchema,
  after: HeadSchema,
  git: z.array(z.object({ cmd: z.string(), code: z.number(), ms: z.number() })),
  result: z.enum(['ok', 'error']),
  error: z.string().optional()
})
export type OpEntry = z.infer<typeof OpEntrySchema>
