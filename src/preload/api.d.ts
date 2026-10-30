export {}

declare global {
  interface Window {
    api: {
      invoke: (channel: string, payload: unknown) => Promise<unknown>
      onEvent: (cb: (event: unknown) => void) => () => void
    }
  }
}
