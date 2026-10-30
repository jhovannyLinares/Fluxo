import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import {
  AppEventSchema,
  type AppEvent,
  type BackendEvent,
  type BackendRequest,
  type BackendResponse,
  type Channel,
  type RpcResult
} from '@shared/ipc-contracts'

/** Cliente hacia backend utilityProcess: correlaciona peticiones por id, reenvía eventos y reinicia si cae. */
export class BackendClient {
  private child: UtilityProcess | null = null
  private nextId = 1
  private pending = new Map<number, (r: RpcResult) => void>()

  constructor(
    private readonly onEvent: (event: AppEvent) => void,
    /** aviso de caída, para el registro de errores */
    private readonly onCrash: (code: number) => void = () => {}
  ) {}

  start(): void {
    const child = utilityProcess.fork(join(__dirname, 'backend.js'), [], {
      serviceName: 'fluxo-backend',
      stdio: 'inherit'
    })
    child.on('message', (msg: BackendResponse | BackendEvent) => {
      if (msg && 'event' in msg) {
        const parsed = AppEventSchema.safeParse(msg.event)
        if (parsed.success) this.onEvent(parsed.data)
        return
      }
      const resolve = this.pending.get(msg?.id)
      if (!resolve) return
      this.pending.delete(msg.id)
      resolve(msg.result)
    })
    child.on('exit', (code) => {
      // peticiones en vuelo fallan con error legible; backend se reinicia
      this.onCrash(code)
      for (const resolve of this.pending.values()) {
        resolve({ ok: false, error: { code: 'INTERNAL', message: `Backend terminó (código ${code}); reiniciando.` } })
      }
      this.pending.clear()
      this.child = null
      setTimeout(() => this.start(), 500)
    })
    this.child = child
  }

  call(channel: Channel, payload: unknown, timeoutMs = 180_000): Promise<RpcResult> {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve({ ok: false, error: { code: 'INTERNAL', message: 'Backend no disponible.' } })
        return
      }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: { code: 'TIMEOUT', message: 'Backend no respondió a tiempo.' } })
      }, timeoutMs)
      this.pending.set(id, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      const req: BackendRequest = { id, channel, payload }
      this.child.postMessage(req)
    })
  }

  stop(): void {
    this.child?.removeAllListeners('exit')
    this.child?.kill()
    this.child = null
  }
}
