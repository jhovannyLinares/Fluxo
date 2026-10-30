import { z } from 'zod'
import { FileChangeSchema } from './commit'

/** Un commit del historial de un archivo (A1): con la ruta que tenía el archivo en ese commit. */
export const FileHistoryEntrySchema = z.object({
  hash: z.string(),
  author: z.string(),
  email: z.string(),
  time: z.number(),
  subject: z.string(),
  status: FileChangeSchema.shape.status,
  path: z.string(),
  /** ruta anterior si en este commit se renombró o copió */
  oldPath: z.string().optional()
})
export type FileHistoryEntry = z.infer<typeof FileHistoryEntrySchema>

/** Una línea del archivo en HEAD con el commit que la escribió (blame). */
export const BlameLineSchema = z.object({
  hash: z.string(),
  author: z.string(),
  time: z.number(),
  subject: z.string(),
  text: z.string()
})
export type BlameLine = z.infer<typeof BlameLineSchema>
