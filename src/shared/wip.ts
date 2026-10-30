import { z } from 'zod'
import { FileChangeSchema } from './commit'

/** De dónde sale el diff de un archivo sin commit. */
export const WipAreaSchema = z.enum(['staged', 'unstaged', 'untracked'])
export type WipArea = z.infer<typeof WipAreaSchema>

/** Archivos sin commit: en stage y sin stage (incluye los nuevos sin seguimiento). */
export const WipFilesSchema = z.object({
  staged: z.array(FileChangeSchema),
  unstaged: z.array(FileChangeSchema),
  /** archivos con conflicto sin resolver (merge, rebase, cherry pick, revert, stash) */
  conflicted: z.array(FileChangeSchema).default([])
})
export type WipFiles = z.infer<typeof WipFilesSchema>

/** Último commit, para el amend: mensaje partido en resumen y descripción, y la rama remota que ya lo tiene. */
export const LastCommitSchema = z.object({
  summary: z.string(),
  description: z.string(),
  pushedTo: z.string().nullable()
})
export type LastCommit = z.infer<typeof LastCommitSchema>

/** Rutas para stage o unstage; sin ellas, todo. */
export const WipPathsSchema = z.array(z.string().min(1).max(4096)).min(1).max(20_000).optional()
