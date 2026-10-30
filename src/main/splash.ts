import { BrowserWindow } from 'electron'
import { LOGO_CSS, logoSvg } from '@shared/logo'

/**
 * A11: HTML de la pantalla de carga: el logo animado de Fluxo y el texto «Cargando…».
 * Solo CSS y SVG, sin scripts.
 */
export function splashHtml(theme: 'dark' | 'light', loading: string): string {
  const bg = theme === 'light' ? '#fcfcfc' : '#1c1e23'
  const text = theme === 'light' ? '#1c1e23' : '#ffffff'
  const muted = theme === 'light' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.6)'
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fluxo</title><style>
html,body{margin:0;height:100%;background:${bg};overflow:hidden;font-family:'Open Sans',Arial,sans-serif;-webkit-user-select:none;user-select:none}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;-webkit-app-region:drag}
${LOGO_CSS}
h1{margin:0;font-size:34px;font-weight:600;letter-spacing:6px;color:${text}}
p{margin:0;font-size:13px;color:${muted}}
</style></head><body>
${logoSvg()}
<h1>FLUXO</h1><p>${loading}</p>
</body></html>`
}

/** Abre la pantalla de carga: sin marco, encima, sin Node ni preload. Se cierra con `close()` cuando la ventana está lista. */
export function openSplash(theme: 'dark' | 'light', loading: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 260,
    height: 480,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    show: false,
    backgroundColor: theme === 'light' ? '#fcfcfc' : '#1c1e23',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, javascript: false }
  })
  win.once('ready-to-show', () => win.show())
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(theme, loading))}`)
  return win
}
