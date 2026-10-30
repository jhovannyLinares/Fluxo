import { z } from 'zod'

/** Operación de git a medio hacer en el repo (H21) y cuántos archivos tienen conflicto; null = ninguna. */
export const OperationSchema = z
  .object({
    kind: z.enum(['merge', 'rebase', 'cherry-pick', 'revert', 'bisect']),
    conflicts: z.number().int()
  })
  .nullable()
export type Operation = z.infer<typeof OperationSchema>
