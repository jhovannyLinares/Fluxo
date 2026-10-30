import { describe, expect, it } from 'vitest'
import { translate, type MessageKey } from '../../src/shared/i18n'
import { MENU_ACTIONS } from '../../src/shared/menu'
import { actionItems, actionLabelKey, filterPalette, type PaletteItem } from '../../src/renderer/src/palette'

/** B4: paleta de comandos; cada acción del menú se puede lanzar desde ella. */
describe('paleta de comandos', () => {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate('es', key, vars)

  it('trae todas las acciones del menú (menos abrirse a sí misma), cada una con su texto propio', () => {
    const items = actionItems(t)
    expect(items.map((i) => i.id.replace('action:', '')).sort()).toEqual(MENU_ACTIONS.filter((a) => a !== 'palette').sort())
    for (const a of MENU_ACTIONS) {
      const { key } = actionLabelKey(a)
      // una clave que no existe devolvería undefined: el control es que cada acción tenga texto en los dos idiomas
      expect(translate('es', key, { n: 1 }), a).toBeTruthy()
      expect(translate('en', key, { n: 1 }), a).toBeTruthy()
    }
  })

  it('filtra por palabras sin acentos ni mayúsculas; primero lo que empieza con lo escrito', () => {
    const items: PaletteItem[] = [
      { id: '1', kind: 'action', label: 'Abrir repo en VS Code' },
      { id: '2', kind: 'branch', label: 'agente/menú', hint: 'rama' },
      { id: '3', kind: 'action', label: 'Mostrar el menú' }
    ]
    expect(filterPalette(items, 'MENU').map((i) => i.id)).toEqual(['2', '3'])
    expect(filterPalette(items, 'abrir code').map((i) => i.id)).toEqual(['1'])
    expect(filterPalette(items, 'rama agente').map((i) => i.id)).toEqual(['2'])
    expect(filterPalette(items, '').map((i) => i.id)).toEqual(['1', '2', '3'])
  })
})
