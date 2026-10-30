import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell, type IpcMainInvokeEvent } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type { OpenIn } from '@shared/menu'
import { menuTemplate } from './app-menu'
import { SUPERSEDED, toAppError } from '@shared/errors'
import { contracts, isChannel, MAIN_CHANNELS, type AppEvent, type RpcResult } from '@shared/ipc-contracts'
import { translate } from '@shared/i18n'
import { nextZoom, PreferencesSchema, resolveLanguage, type Preferences } from '@shared/preferences'
import { addRecent, pinRecent, removeRecent, type Recent } from '@shared/recents'
import { isProviderUrl } from '@shared/web-links'
import { BackendClient } from './backend-client'
import { ErrorLog } from './error-log'
import { openInPlan } from './open-in'
import { openSplash } from './splash'
import { ensureThemesDir, loadThemes } from './themes-store'
import { loadPreferences, savePreferences } from './preferences-store'
import { loadRecents, saveRecents } from './recents-store'
import { migrateDataDir } from './migrate-data'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
// A14: los ajustes de cuando la app se llamaba Flux pasan a la carpeta de Fluxo antes de que Chromium la abra
migrateDataDir(join(app.getPath('appData'), 'Flux'), app.getPath('userData'))
let mainWindow: BrowserWindow | null = null
const sendEvent = (event: AppEvent) => mainWindow?.webContents.send('app-event', event)
// B13: carpeta de temas (userData/themes)
let themesDir = ''
let splash: BrowserWindow | null = null
const closeSplash = () => {
  if (splash && !splash.isDestroyed()) splash.close()
  splash = null
}
// registro de errores (B7): todo error de petición, de la ventana o del backend queda con fecha en userData/logs
let errorLog: ErrorLog | null = null

/** Ayuda ▸ Registro de errores y «Ver registro» de los avisos: el archivo en el Explorador (o su carpeta, si aún no hay errores). */
function openErrorLog(): void {
  if (!errorLog) return
  if (existsSync(errorLog.file)) shell.showItemInFolder(errorLog.file)
  else void shell.openPath(dirname(errorLog.file))
}
// la bitácora de escrituras va al registro, no a la ventana
const backend = new BackendClient((event) => (event.type === 'op:journal' ? errorLog?.writeOp(event.entry) : sendEvent(event)), (code) =>
  errorLog?.write({ source: 'backend', message: `El backend terminó (código ${code}); se reinicia.` })
)

// preferencias (H06): se leen al arrancar, se guardan en cada cambio y se aplican al instante
let prefsFile = ''
let prefs: Preferences

function setPreferences(next: Preferences): Preferences {
  const langBefore = prefs?.language
  prefs = savePreferences(prefsFile, next)
  mainWindow?.webContents.setZoomFactor(prefs.zoom)
  if (prefs.language !== langBefore) buildMenu()
  return prefs
}

// mismo orden que navigator.languages de la ventana: primero el idioma de la app, luego los del sistema
// (getPreferredSystemLanguages solo puede poner primero en-US aunque Windows esté en español)
const uiLanguage = () => resolveLanguage(prefs.language, [app.getLocale(), ...app.getPreferredSystemLanguages()])

/** Menú de la aplicación; se rehace si cambia el idioma. */
function buildMenu(): void {
  const lang = uiLanguage()
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      menuTemplate(lang, app.getVersion(), {
        send: (action) => sendEvent({ type: 'menu', action }),
        relaunch: () => {
          app.relaunch()
          app.exit(0)
        },
        toggleFullScreen: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()),
        zoom: (dir) => sendEvent({ type: 'prefs:changed', prefs: setPreferences({ ...prefs, zoom: nextZoom(prefs.zoom, dir) }) }),
        openErrorLog,
        quit: () => app.quit()
      })
    )
  )
}

/**
 * Abre la carpeta del repo afuera (menú Archivo): Explorador, Windows Terminal (o cmd si no está) o VS Code.
 * Solo carpetas que existen; el plan sale de `openInPlan`, que nunca pasa la ruta por un intérprete de comandos.
 */
function openIn(target: OpenIn, path: string): boolean {
  if (!existsSync(path) || !statSync(path).isDirectory()) return false
  const detached = (cmd: string, args: string[], onError?: () => void) => {
    const child = spawn(cmd, args, { cwd: path, detached: true, stdio: 'ignore' })
    if (onError) child.once('error', onError)
    child.unref()
  }
  const plan = openInPlan(target, path)
  if (plan.kind === 'path') void shell.openPath(plan.path)
  else if (plan.kind === 'url') void shell.openExternal(plan.url)
  // sin Windows Terminal: cmd sin argumentos, abierto en la carpeta (cwd)
  else detached(plan.cmd, plan.args, () => detached('cmd.exe', []))
  return true
}

// recientes (H08): se leen al arrancar y se guardan al abrir o quitar un repo
let recentsFile = ''
let recents: Recent[] = []

// CSP (8.8): producción estricta; dev permite script inline de Vite y websocket de recarga
const CSP = isDev
  ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: http://localhost:*"
  : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'"

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 900,
    minHeight: 560,
    title: 'Fluxo',
    backgroundColor: prefs.theme === 'light' ? '#fcfcfc' : '#1c1e23',
    show: false,
    // menú de la aplicación siempre visible
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  // la pantalla de carga sigue encima hasta que el renderer avisa que pintó el grafo (app:ready)
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // nada navega fuera de la app; enlaces https se abren en navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
  mainWindow.webContents.on('console-message', (e) => {
    if (e.level === 'error') errorLog?.write({ source: 'renderer', message: e.message, where: `${e.sourceId}:${e.lineNumber}` })
  })
  mainWindow.webContents.on('render-process-gone', (_e, d) =>
    errorLog?.write({ source: 'ventana', message: `La ventana se cayó: ${d.reason} (código ${d.exitCode}).` })
  )

  // zoom guardado; Ctrl++ / Ctrl+- / Ctrl+0 se atienden aquí para que persistan
  mainWindow.webContents.on('did-finish-load', () => mainWindow?.webContents.setZoomFactor(prefs.zoom))
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return
    const dir = ({ '+': 1, '=': 1, '-': -1, '0': 0 } as const)[input.key]
    if (dir === undefined) return
    e.preventDefault()
    sendEvent({ type: 'prefs:changed', prefs: setPreferences({ ...prefs, zoom: nextZoom(prefs.zoom, dir) }) })
  })

  if (isDev) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Solo acepta IPC desde la ventana principal y su origen esperado. */
function trustedSender(e: IpcMainInvokeEvent): boolean {
  if (!mainWindow || e.sender !== mainWindow.webContents) return false
  const url = e.senderFrame?.url ?? ''
  return isDev ? url.startsWith(process.env.ELECTRON_RENDERER_URL!) : url.startsWith('file://')
}

async function handleInMain(channel: string, req: unknown): Promise<unknown> {
  if (channel === 'app:pickRepo' || channel === 'app:pickFolder') {
    const lang = uiLanguage()
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: translate(lang, channel === 'app:pickRepo' ? 'toolbar.open' : 'clone.pickFolder'),
      properties: ['openDirectory', 'createDirectory']
    })
    return { path: r.canceled ? null : (r.filePaths[0] ?? null) }
  }
  if (channel === 'themes:list') {
    const { themes, errors } = loadThemes(themesDir)
    // B13: un tema mal escrito no frena a los demás; queda en el registro de errores con su motivo
    for (const e of errors) errorLog?.write({ source: 'rpc', channel: 'themes:list', message: `Tema ${e.file}: ${e.message}` })
    return { dir: themesDir, themes, errors }
  }
  if (channel === 'themes:openFolder') {
    ensureThemesDir(themesDir)
    void shell.openPath(themesDir)
    return { ok: true }
  }
  if (channel === 'app:versions') {
    return { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }
  }
  if (channel === 'app:ready') {
    closeSplash()
    return { ok: true }
  }
  if (channel === 'app:copy') {
    clipboard.writeText(contracts['app:copy'].req.parse(req).text)
    return { ok: true }
  }
  if (channel === 'app:openErrorLog') {
    openErrorLog()
    return { ok: true }
  }
  if (channel === 'app:openUrl') {
    // H23: solo páginas https de GitHub o Azure DevOps, aunque el renderer pida otra cosa
    const { url } = contracts['app:openUrl'].req.parse(req)
    if (!isProviderUrl(url)) return { ok: false }
    await shell.openExternal(url)
    return { ok: true }
  }
  if (channel === 'app:openIn') {
    const { target, path } = contracts['app:openIn'].req.parse(req)
    return { ok: openIn(target, path) }
  }
  if (channel === 'app:openFile') {
    const { path, mode } = contracts['app:openFile'].req.parse(req)
    if (!isAbsolute(path) || !existsSync(path)) return { ok: false }
    if (mode === 'folder') shell.showItemInFolder(path)
    else void shell.openPath(path)
    return { ok: true }
  }
  if (channel === 'prefs:get') return prefs
  if (channel === 'prefs:set') return setPreferences(PreferencesSchema.parse(req))
  if (channel === 'recents:get') return recents
  if (channel === 'recents:add') {
    const { path, name } = contracts['recents:add'].req.parse(req)
    recents = saveRecents(recentsFile, addRecent(recents, { path, name, openedAt: Date.now() }))
    return recents
  }
  if (channel === 'recents:remove') {
    const { path } = contracts['recents:remove'].req.parse(req)
    recents = saveRecents(recentsFile, removeRecent(recents, path))
    return recents
  }
  if (channel === 'recents:pin') {
    const { path, pinned } = contracts['recents:pin'].req.parse(req)
    recents = saveRecents(recentsFile, pinRecent(recents, path, pinned))
    return recents
  }
  throw new Error(`Canal ${channel} sin manejador en main`)
}

ipcMain.handle('rpc', async (e, msg: unknown): Promise<RpcResult> => {
  if (!trustedSender(e)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Origen no confiable.' } }
  try {
    const { channel, payload } = (msg ?? {}) as { channel?: unknown; payload?: unknown }
    if (!isChannel(channel)) {
      errorLog?.write({ source: 'rpc', channel: String(channel), code: 'INVALID_REQUEST', message: 'Canal desconocido.' })
      return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Canal desconocido.' } }
    }
    const req = contracts[channel].req.parse(payload) // primer extremo de validación
    const result = MAIN_CHANNELS.has(channel)
      ? ({ ok: true, data: await handleInMain(channel, req) } as RpcResult)
      : await backend.call(channel, req)
    if (result.ok) contracts[channel].res.parse(result.data) // respuesta también cumple contrato
    else if (result.error.message !== SUPERSEDED) errorLog?.write({ source: 'rpc', channel, ...result.error })
    return result
  } catch (err) {
    const error = toAppError(err)
    errorLog?.write({ source: 'rpc', channel: String((msg as { channel?: unknown } | null)?.channel), ...error })
    return { ok: false, error }
  }
})

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault())
})

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  prefsFile = join(app.getPath('userData'), 'preferences.json')
  prefs = loadPreferences(prefsFile)
  recentsFile = join(app.getPath('userData'), 'recents.json')
  recents = loadRecents(recentsFile)
  themesDir = join(app.getPath('userData'), 'themes')
  errorLog = new ErrorLog(join(app.getPath('userData'), 'logs', 'fluxo.log'))
  errorLog.write({ source: 'app', message: `Fluxo ${app.getVersion()} arranca (Electron ${process.versions.electron}, ${process.platform}).` })

  // A11: pantalla de carga mientras arranca la ventana; se cierra al mostrarla o, si algo falla, a los 20 s
  splash = openSplash(prefs.theme === 'light' ? 'light' : 'dark', translate(uiLanguage(), 'toolbar.loading'))
  setTimeout(closeSplash, 20_000)
  buildMenu()
  backend.start()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  backend.stop()
  app.quit()
})
