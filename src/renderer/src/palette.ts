import { MENU_ACTIONS, type MenuAction } from '@shared/menu'
import type { MessageKey } from '@shared/i18n'

/** B4: una entrada de la paleta de comandos (Ctrl+P). */
export interface PaletteItem {
  id: string
  kind: 'action' | 'branch' | 'repo' | 'command'
  label: string
  /** texto gris a la derecha: atajo, ruta del repo o «rama» */
  hint?: string
}

/** Clave del texto de cada acción del menú: `menu.<acción>`; `tab1`…`tab9` usan «Ir a la pestaña N». */
export function actionLabelKey(action: MenuAction): { key: MessageKey; vars?: Record<string, string | number> } {
  const tab = /^tab(\d)$/.exec(action)
  if (tab) return { key: 'menu.tabN', vars: { n: Number(tab[1]) } }
  return { key: `menu.${action}` as MessageKey }
}

/** Todas las acciones del menú, menos abrir la propia paleta. */
export function actionItems(t: (key: MessageKey, vars?: Record<string, string | number>) => string): PaletteItem[] {
  return MENU_ACTIONS.filter((a) => a !== 'palette').map((a) => {
    const { key, vars } = actionLabelKey(a)
    return { id: `action:${a}`, kind: 'action', label: t(key, vars) }
  })
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

/**
 * Filtra por todas las palabras escritas, sin distinguir mayúsculas ni acentos, en el texto y la pista. Primero las
 * que empiezan con lo escrito, después el resto, cada grupo en su orden original.
 */
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return items
  const hits = items.filter((i) => {
    const text = fold(`${i.label} ${i.hint ?? ''}`)
    return words.every((w) => text.includes(w))
  })
  const first = fold(words[0]!)
  return [...hits.filter((i) => fold(i.label).startsWith(first)), ...hits.filter((i) => !fold(i.label).startsWith(first))]
}
