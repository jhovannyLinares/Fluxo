import { z } from 'zod'

/** Resumen de un repo en la gestión de repositorios: rama, ↑↓ y cambios sin commit. */
export const RepoSummarySchema = z.object({
  branch: z.string().nullable(),
  ahead: z.number().int(),
  behind: z.number().int(),
  modified: z.number().int(),
  added: z.number().int()
})
export type RepoSummary = z.infer<typeof RepoSummarySchema>
