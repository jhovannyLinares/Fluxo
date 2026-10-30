import { z } from 'zod'

/** Archivo cambiado en un commit (H18). A añadido · M modificado · D borrado · R renombrado · C copiado · T cambio de tipo. */
export const FileChangeSchema = z.object({
  status: z.enum(['A', 'M', 'D', 'R', 'C', 'T', 'U', 'X']),
  path: z.string(),
  oldPath: z.string().optional(),
  additions: z.number().int(),
  deletions: z.number().int(),
  binary: z.boolean(),
  /** cambios sin commit: archivo nuevo sin seguimiento (sin conteo de líneas) */
  untracked: z.boolean().optional()
})
export type FileChange = z.infer<typeof FileChangeSchema>

export const CommitDetailSchema = z.object({
  hash: z.string(),
  parents: z.array(z.string()),
  author: z.string(),
  email: z.string(),
  time: z.number(),
  committer: z.string(),
  committerEmail: z.string(),
  commitTime: z.number(),
  subject: z.string(),
  /** mensaje sin el asunto (C10) */
  body: z.string(),
  coAuthors: z.array(z.object({ name: z.string(), email: z.string() })),
  /** contra el primer padre (C18) */
  files: z.array(FileChangeSchema)
})
export type CommitDetail = z.infer<typeof CommitDetailSchema>

/** Resumen por tipo de cambio: { A: 2, M: 3, R: 1 } */
export function changeSummary(files: readonly FileChange[]): Partial<Record<FileChange['status'], number>> {
  const out: Partial<Record<FileChange['status'], number>> = {}
  for (const f of files) out[f.status] = (out[f.status] ?? 0) + 1
  return out
}
