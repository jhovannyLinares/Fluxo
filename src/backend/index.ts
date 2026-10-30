/**
 * Backend en Electron utilityProcess: git, red y credenciales viven aquí, nunca en renderer.
 * Recibe peticiones de main y responde con el mismo id; eventos push salen por mismo puerto.
 */
import type { BackendEvent, BackendRequest, BackendResponse } from '@shared/ipc-contracts'
import { setEmitter } from './events'
import { dispatch } from './handlers'

const port = process.parentPort
if (!port) {
  console.error('backend debe correr como utilityProcess')
  process.exit(1)
}

setEmitter((event) => {
  const msg: BackendEvent = { event }
  port.postMessage(msg)
})

port.on('message', async (e: { data: BackendRequest }) => {
  const { id, channel, payload } = e.data ?? ({} as BackendRequest)
  if (typeof id !== 'number') return
  const result = await dispatch(channel, payload)
  const response: BackendResponse = { id, result }
  port.postMessage(response)
})
