import { AsyncLocalStorage } from 'node:async_hooks'

/** Comandos de git que corrió una operación de la fila de escrituras, para la bitácora. */
export interface OpContext {
  cmds: { args: string[]; code: number; ms: number }[]
}

export const opContext = new AsyncLocalStorage<OpContext>()

/** runner.ts: anota cada git que corre dentro de una operación de la fila (fuera de ella no hace nada). */
export function noteGit(args: readonly string[], code: number, ms: number): void {
  opContext.getStore()?.cmds.push({ args: [...args], code, ms: Math.round(ms) })
}
