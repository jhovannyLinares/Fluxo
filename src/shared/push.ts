import { z } from 'zod'

/** A dónde sube Push la rama actual: su upstream, o null si todavía no existe en el remoto (se pregunta). */
export const PushTargetSchema = z.object({
  /** rama actual; null = HEAD desacoplado */
  branch: z.string().nullable(),
  /** `origin/x` según branch.<rama>.remote y .merge; null = sin upstream */
  upstream: z.string().nullable(),
  remotes: z.array(z.string())
})
export type PushTarget = z.infer<typeof PushTargetSchema>

/** Commit del remoto que un force push descartaría. */
export const LostCommitSchema = z.object({ hash: z.string(), subject: z.string(), author: z.string(), when: z.string() })
export type LostCommit = z.infer<typeof LostCommitSchema>

/**
 * Resultado de Push: subió, o el remoto lo rechazó porque tiene commits que la rama no tiene. En el rechazo ya se
 * trajo la rama remota: `lost` son esos commits y `expected` el hash que el force push exige que siga ahí.
 */
export const PushResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pushed'), changed: z.boolean(), ms: z.number() }),
  z.object({
    status: z.literal('rejected'),
    target: z.string(),
    lost: z.array(LostCommitSchema),
    expected: z.string(),
    gitOutput: z.string()
  })
])
export type PushResult = z.infer<typeof PushResultSchema>

const NAME = /^(?!-)[^\0\s~^:?*[\\]+$/

/** Lo que pide Push: nada (al upstream), el destino elegido en el diálogo, o el force con el hash esperado. */
export const PushRequestSchema = z.object({
  to: z.object({ remote: z.string().max(256).regex(NAME), branch: z.string().max(1024).regex(NAME) }).optional(),
  forceExpected: z.string().regex(/^[0-9a-f]{40,64}$/).optional()
})
export type PushRequest = z.infer<typeof PushRequestSchema>
