import { z } from 'zod'

/** Variantes de Pull: fast-forward si se puede (si no, merge), solo fast-forward, rebase. */
export const PULL_MODES = ['ff', 'ff-only', 'rebase'] as const
export const PullModeSchema = z.enum(PULL_MODES)
export type PullMode = z.infer<typeof PullModeSchema>

/** Lo que hace el botón Pull al hacer clic: Fetch All o una de las variantes de Pull (por defecto, fast-forward si se puede). */
export const PullDefaultSchema = z.enum(['fetch', ...PULL_MODES])
export type PullDefault = z.infer<typeof PullDefaultSchema>
export const DEFAULT_PULL: PullDefault = 'ff'
