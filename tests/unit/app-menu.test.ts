import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { menuTemplate, type MenuHandlers } from '../../src/main/app-menu'
import { MENU_ACTIONS } from '../../src/shared/menu'

const handlers = (): MenuHandlers => ({
  send: vi.fn(),
  relaunch: vi.fn(),
  toggleFullScreen: vi.fn(),
  zoom: vi.fn(),
  openErrorLog: vi.fn(),
  quit: vi.fn()
})

/** Entradas con acción, en todos los niveles (Ver ▸ Pestañas está anidado). */
const items = (m: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  m.flatMap((i) => (i.submenu ? items(i.submenu as MenuItemConstructorOptions[]) : i.type === 'separator' ? [] : [i]))

/** Menú de la aplicación, solo de lectura. */
describe('menú de la aplicación', () => {
  it('cuatro menús en su orden, con letra de acceso', () => {
    expect(menuTemplate('es', '0.1.0', handlers()).map((m) => m.label)).toEqual(['&Archivo', '&Editar', '&Ver', 'Ay&uda'])
    expect(menuTemplate('en', '0.1.0', handlers()).map((m) => m.label)).toEqual(['&File', '&Edit', '&View', '&Help'])
  })

  it('atajos de Windows', () => {
    const acc = Object.fromEntries(items(menuTemplate('en', '0.1.0', handlers())).map((i) => [i.label, i.accelerator]))
    expect(acc).toMatchObject({
      'Clone Repo…': 'Ctrl+N',
      'Open Repo…': 'Ctrl+O',
      'Open Repo in VS Code': 'Ctrl+Shift+E',
      'Open Terminal': 'Alt+T',
      'Open in File Explorer': 'Alt+O',
      'Preferences…': 'Ctrl+,',
      Exit: 'Alt+F4',
      'Relaunch Fluxo': 'Ctrl+Shift+R',
      'Increase Zoom': 'Ctrl+=',
      'Show or Hide Left Panel': 'Ctrl+J',
      'Show or Hide Commit Details': 'Ctrl+K',
      'Keyboard Shortcuts': 'Ctrl+/'
    })
  })

  it('nada que escriba en el repo', () => {
    const labels = items(menuTemplate('en', '0.1.0', handlers())).map((i) => String(i.label))
    // «Init Repo…» y «Add Submodule…» son funciones de la fase 5, no escrituras ocultas: abren un diálogo que pide los datos
    for (const write of ['Undo', 'Redo', 'Push', 'Pull', 'Stash', 'Sign']) {
      expect(labels.some((l) => l.includes(write))).toBe(false)
    }
  })

  it('cada acción de la ventana tiene su entrada y la manda', () => {
    const h = handlers()
    for (const i of items(menuTemplate('es', '0.1.0', h))) (i.click as (() => void) | undefined)?.()
    const sent = (h.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect([...new Set(sent)].sort()).toEqual([...MENU_ACTIONS].sort())
    expect(h.zoom).toHaveBeenCalledTimes(3)
    expect(h.relaunch).toHaveBeenCalledTimes(1)
  })
})
