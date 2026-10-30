import type { MenuItemConstructorOptions } from 'electron'
import { translate, type Language, type MessageKey } from '@shared/i18n'
import type { MenuAction } from '@shared/menu'

export interface MenuHandlers {
  /** acción que resuelve la ventana */
  send: (action: MenuAction) => void
  relaunch: () => void
  toggleFullScreen: () => void
  zoom: (dir: -1 | 0 | 1) => void
  /** muestra el archivo del registro de errores en el Explorador */
  openErrorLog: () => void
  quit: () => void
}

/**
 * Menú de la aplicación (Archivo, Editar, Ver, Ayuda) con sus atajos de Windows,
 * solo con lo que no escribe en el repo. Sin Init, Deshacer, Rehacer, cuenta ni actualizaciones.
 */
export function menuTemplate(lang: Language, version: string, h: MenuHandlers): MenuItemConstructorOptions[] {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars)
  const act = (label: MessageKey, action: MenuAction, accelerator?: string): MenuItemConstructorOptions => ({
    label: t(label),
    accelerator,
    click: () => h.send(action)
  })
  return [
    {
      label: t('menu.file'),
      submenu: [
        act('menu.newTab', 'newTab', 'Ctrl+T'),
        act('menu.closeTab', 'closeTab', 'Ctrl+W'),
        act('menu.reopenTab', 'reopenTab', 'Ctrl+Shift+T'),
        { type: 'separator' },
        act('menu.clone', 'clone', 'Ctrl+N'),
        act('menu.init', 'init'),
        act('menu.addSubmodule', 'addSubmodule'),
        act('menu.open', 'open', 'Ctrl+O'),
        act('menu.openEditor', 'openEditor', 'Ctrl+Shift+E'),
        act('menu.fileHistory', 'fileHistory', 'Ctrl+Shift+H'),
        { type: 'separator' },
        act('menu.openTerminal', 'openTerminal', 'Alt+T'),
        act('menu.openExplorer', 'openExplorer', 'Alt+O'),
        { type: 'separator' },
        act('menu.prefs', 'prefs', 'Ctrl+,'),
        { type: 'separator' },
        { label: t('menu.quit'), accelerator: 'Alt+F4', click: h.quit }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { label: t('menu.cut'), role: 'cut', accelerator: 'Ctrl+X' },
        { label: t('menu.copy'), role: 'copy', accelerator: 'Ctrl+C' },
        { label: t('menu.paste'), role: 'paste', accelerator: 'Ctrl+V' },
        { label: t('menu.selectAll'), role: 'selectAll', accelerator: 'Ctrl+A' },
        { type: 'separator' },
        act('menu.findCommits', 'findCommits', 'Ctrl+F')
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        { label: t('menu.relaunch'), accelerator: 'Ctrl+Shift+R', click: h.relaunch },
        { label: t('menu.fullScreen'), accelerator: 'Ctrl+Shift+F', click: h.toggleFullScreen },
        { label: t('menu.fullScreen'), accelerator: 'F11', click: h.toggleFullScreen, visible: false },
        { type: 'separator' },
        // el atajo de zoom lo atiende main antes del menú (before-input-event); aquí solo se muestra
        { label: t('menu.zoomIn'), accelerator: 'Ctrl+=', registerAccelerator: false, click: () => h.zoom(1) },
        { label: t('menu.zoomOut'), accelerator: 'Ctrl+-', registerAccelerator: false, click: () => h.zoom(-1) },
        { label: t('menu.zoomReset'), accelerator: 'Ctrl+0', registerAccelerator: false, click: () => h.zoom(0) },
        {
          label: t('menu.tabs'),
          submenu: [
            act('menu.nextTab', 'nextTab', 'Ctrl+Tab'),
            act('menu.prevTab', 'prevTab', 'Ctrl+Shift+Tab'),
            { type: 'separator' },
            ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => ({
              label: t('menu.tabN', { n }),
              accelerator: `Ctrl+${n}`,
              click: () => h.send(`tab${n}`)
            }))
          ]
        },
        { type: 'separator' },
        act('menu.viewAll', 'viewAll'),
        act('menu.viewCurrent', 'viewCurrent'),
        { type: 'separator' },
        act('menu.toggleLeft', 'toggleLeft', 'Ctrl+J'),
        act('menu.toggleDetail', 'toggleDetail', 'Ctrl+K'),
        { type: 'separator' },
        act('menu.palette', 'palette', 'Ctrl+P')
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        act('menu.guide', 'guide', 'F1'),
        act('menu.releaseNotes', 'releaseNotes'),
        act('menu.shortcuts', 'shortcuts', 'Ctrl+/'),
        act('menu.env', 'env'),
        { label: t('menu.errorLog'), click: h.openErrorLog },
        { type: 'separator' },
        act('menu.about', 'about'),
        { label: t('menu.version', { version }), enabled: false }
      ]
    }
  ]
}
