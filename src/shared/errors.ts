import { z } from 'zod'

/** Error estándar que viaja por IPC: mensaje legible + salida original de git + sugerencia. */
export const AppErrorSchema = z.object({
  code: z.enum([
    'INVALID_REQUEST',
    'GIT_NOT_FOUND',
    'GIT_FAILED',
    'NOT_A_REPO',
    'PATH_NOT_FOUND',
    'BARE_REPO',
    'REPO_NOT_OPEN',
    'TIMEOUT',
    'INTERNAL'
  ]),
  message: z.string(),
  gitOutput: z.string().optional(),
  suggestion: z.string().optional()
})
export type AppError = z.infer<typeof AppErrorSchema>

/** Una carga del grafo que otra más nueva dejó sin efecto: no es una falla y no va al registro de errores. */
export const SUPERSEDED = 'Carga reemplazada por otra más reciente.'

export class AppException extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message)
    this.name = 'AppException'
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppException) return err.appError
  if (err instanceof z.ZodError) {
    return {
      code: 'INVALID_REQUEST',
      message: 'Petición inválida rechazada.',
      gitOutput: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
    }
  }
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) }
}
