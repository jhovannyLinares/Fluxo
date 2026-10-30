import type { AppEvent } from '@shared/ipc-contracts'

type Emitter = (event: AppEvent) => void
let emitter: Emitter = () => {}

/** index.ts conecta emisor real (parentPort); pruebas pueden capturar eventos. */
export function setEmitter(fn: Emitter): void {
  emitter = fn
}

export function emit(event: AppEvent): void {
  emitter(event)
}
