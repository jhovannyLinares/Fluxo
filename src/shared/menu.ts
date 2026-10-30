import { z } from 'zod'

/**
 * Entradas del menú de la aplicación que resuelve la ventana (la que sabe qué repo está abierto).
 * Ninguna escribe en el repo: la v1.0 es de solo lectura.
 */
export const MENU_ACTIONS = [
  'open',
  'clone',
  'init',
  'addSubmodule',
  'prefs',
  'shortcuts',
  'env',
  'fileHistory',
  'findCommits',
  'palette',
  'about',
  'guide',
  'releaseNotes',
  'viewAll',
  'viewCurrent',
  'toggleLeft',
  'toggleDetail',
  'openTerminal',
  'openExplorer',
  'openEditor',
  'newTab',
  'closeTab',
  'reopenTab',
  'nextTab',
  'prevTab',
  'tab1',
  'tab2',
  'tab3',
  'tab4',
  'tab5',
  'tab6',
  'tab7',
  'tab8',
  'tab9'
] as const
export const MenuActionSchema = z.enum(MENU_ACTIONS)
export type MenuAction = z.infer<typeof MenuActionSchema>

/** Dónde abrir la carpeta del repo desde el menú Archivo. */
export const OpenInSchema = z.enum(['terminal', 'explorer', 'editor'])
export type OpenIn = z.infer<typeof OpenInSchema>
