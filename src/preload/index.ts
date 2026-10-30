import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * Única superficie expuesta al renderer: invocar canal tipado y escuchar eventos.
 * Sin Node, sin ipcRenderer crudo, sin require.
 */
const api = {
  invoke: (channel: string, payload: unknown) => ipcRenderer.invoke('rpc', { channel, payload }),
  onEvent: (cb: (event: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, event: unknown) => cb(event)
    ipcRenderer.on('app-event', listener)
    return () => {
      ipcRenderer.removeListener('app-event', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
