import type { AppError } from '@shared/errors'
import { AppEventSchema, type AppEvent, type Channel, type Req, type Res, type RpcResult } from '@shared/ipc-contracts'

/** Suscripción a eventos push del backend; descarta mensajes que no cumplan contrato. */
export function onAppEvent(cb: (event: AppEvent) => void): () => void {
  return window.api.onEvent((raw) => {
    const parsed = AppEventSchema.safeParse(raw)
    if (parsed.success) cb(parsed.data)
  })
}

export class ApiError extends Error {
  constructor(public readonly info: AppError) {
    super(info.message)
  }
}

/** Llamada tipada: canal y payload verificados por TypeScript aquí y por zod en main/backend. */
export async function call<C extends Channel>(channel: C, payload: Req<C>): Promise<Res<C>> {
  const r = (await window.api.invoke(channel, payload)) as RpcResult<Res<C>>
  if (!r.ok) throw new ApiError(r.error)
  return r.data
}

/** Cualquier fallo de una llamada como el error estándar que muestran los diálogos. */
export const toAppError = (e: unknown): ApiError['info'] => (e instanceof ApiError ? e.info : { code: 'INTERNAL', message: String(e) })
