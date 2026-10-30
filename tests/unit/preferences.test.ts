import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { contracts } from '../../src/shared/ipc-contracts'
import { LANGUAGES, defaultPreferences, nextZoom, parsePreferences, resolveLanguage, type Preferences } from '../../src/shared/preferences'
import { messages, translate } from '../../src/shared/i18n'
import { loadPreferences, savePreferences } from '../../src/main/preferences-store'
import { commitDate, formatPattern } from '../../src/renderer/src/format'
import { filterShortcuts, SHORTCUTS } from '../../src/renderer/src/shortcuts'
import { tempDir } from '../fixtures/make-repo'

const tmp = tempDir('fluxo-prefs-')
afterAll(() => tmp.cleanup())
let n = 0
/** Archivo nuevo por prueba con el contenido dado. */
function file(content?: string): string {
  const f = join(tmp.dir, `prefs-${n++}.json`)
  if (content !== undefined) writeFileSync(f, content, 'utf8')
  return f
}
const light: Preferences = { ...defaultPreferences(), theme: 'light', zoom: 1.3 }

describe('carga de preferencias', () => {
  it('control positivo: archivo válido se lee tal cual (el cargador no devuelve siempre los valores por defecto)', () => {
    const p = loadPreferences(file(JSON.stringify(light)))
    expect(p.theme).toBe('light')
    expect(p.zoom).toBe(1.3)
  })

  it('archivo de antes de las opciones de Personalización: conserva lo suyo y toma los valores de fábrica de lo nuevo', () => {
    const { detailDate: _d, toolbarLabels: _t, ...old } = { ...light, date: { mode: 'absolute' as const, pattern: 'YYYY-MM-DD' } }
    const p = parsePreferences(old)
    expect(p.theme).toBe('light')
    expect(p.date).toEqual({ mode: 'absolute', pattern: 'YYYY-MM-DD' })
    expect(p.detailDate).toBe('D [de] MMMM [de] YYYY H:mm')
    expect(p.toolbarLabels).toBe(true)
  })

  it('archivo ausente → valores por defecto', () => {
    expect(loadPreferences(file())).toEqual(defaultPreferences())
  })

  it('JSON corrupto → valores por defecto, sin lanzar', () => {
    expect(loadPreferences(file('{"version":1,"theme":"li'))).toEqual(defaultPreferences())
    expect(loadPreferences(file('\u0000\u0001basura'))).toEqual(defaultPreferences())
    expect(loadPreferences(file('null'))).toEqual(defaultPreferences())
    expect(loadPreferences(file('[1,2]'))).toEqual(defaultPreferences())
  })

  it('otra versión → valores por defecto aunque el resto sea válido', () => {
    expect(loadPreferences(file(JSON.stringify({ ...light, version: 2 })))).toEqual(defaultPreferences())
    expect(loadPreferences(file(JSON.stringify({ ...light, version: undefined })))).toEqual(defaultPreferences())
  })

  it('un campo dañado vuelve a su valor por defecto sin perder los demás', () => {
    const p = loadPreferences(file(JSON.stringify({ ...light, zoom: 'grande', date: { mode: 'x' } })))
    expect(p.theme).toBe('light')
    expect(p.zoom).toBe(1)
    expect(p.date).toEqual(defaultPreferences().date)
  })
})

describe('guardado de preferencias', () => {
  it('guarda y vuelve a leer lo mismo, sin dejar temporal', () => {
    const f = file()
    savePreferences(f, light)
    expect(loadPreferences(f)).toEqual(light)
    expect(existsSync(`${f}.tmp`)).toBe(false)
    expect(readFileSync(f, 'utf8').startsWith('﻿')).toBe(false)
  })

  it('rechaza preferencias inválidas y no toca el archivo', () => {
    const f = file()
    savePreferences(f, light)
    expect(() => savePreferences(f, { ...light, zoom: 9 })).toThrow()
    expect(() => savePreferences(f, { ...light, date: { mode: 'absolute', pattern: '  ' } })).toThrow()
    expect(loadPreferences(f)).toEqual(light)
  })

  it('el contrato IPC acepta lo que se guarda y rechaza otra versión', () => {
    expect(contracts['prefs:set'].req.safeParse(light).success).toBe(true)
    expect(contracts['prefs:set'].req.safeParse({ ...light, version: 2 }).success).toBe(false)
  })
})

describe('zoom', () => {
  it('sube, baja, restablece y respeta los límites', () => {
    expect(nextZoom(1, 1)).toBe(1.1)
    expect(nextZoom(1.1, -1)).toBe(1)
    expect(nextZoom(1.7, 0)).toBe(1)
    expect(nextZoom(2, 1)).toBe(2)
    expect(nextZoom(0.5, -1)).toBe(0.5)
  })
})

describe('i18n', () => {
  it('cada idioma de las preferencias tiene traducciones completas', () => {
    expect([...LANGUAGES].sort()).toEqual(Object.keys(messages).sort())
    for (const lang of LANGUAGES) {
      for (const key of Object.keys(messages.es) as (keyof typeof messages.es)[]) {
        expect(messages[lang][key], `${lang}.${key}`).toBeTruthy()
      }
    }
  })

  it('interpola variables y deja intactas las que faltan', () => {
    expect(translate('es', 'status.commits', { total: '1,234' })).toBe('1,234 commits')
    expect(translate('en', 'env.gitOld', { version: '2.30' })).toBe('Git 2.30 is older than the minimum version {min}.')
  })
})

describe('formato de fecha', () => {
  // 2026-03-05 07:08:09 hora local
  const t = new Date(2026, 2, 5, 7, 8, 9).getTime() / 1000

  it('aplica tokens del patrón', () => {
    expect(formatPattern(t, 'DD/MM/YYYY HH:mm:ss')).toBe('05/03/2026 07:08:09')
    expect(formatPattern(t, 'D/M/YY H:mm')).toBe('5/3/26 7:08')
    expect(formatPattern(t, 'YYYY-MM-DD @ HH:mm')).toBe('2026-03-05 @ 07:08')
  })

  it('mes corto según idioma', () => {
    expect(formatPattern(t, 'DD MMM', 'es')).toBe('05 mar')
    expect(formatPattern(t, 'DD MMM', 'en')).toBe('05 Mar')
  })

  it('mes completo y texto entre corchetes tal cual', () => {
    expect(formatPattern(t, 'D [de] MMMM [de] YYYY H:mm', 'es')).toBe('5 de marzo de 2026 7:08')
    expect(formatPattern(t, 'MMMM D, YYYY', 'en')).toBe('March 5, 2026')
    // sin corchetes, la D de «de» sería el día: el corchete la protege
    expect(formatPattern(t, '[DD] DD')).toBe('DD 05')
  })

  it('modo relativo o absoluto según preferencia', () => {
    const now = (t + 5 * 60) * 1000
    expect(commitDate(t, now, { mode: 'relative', pattern: 'DD' }, 'es')).toBe('hace 5 minutos')
    expect(commitDate(t, now, { mode: 'relative', pattern: 'DD' }, 'en')).toBe('5 minutes ago')
    expect(commitDate(t, now, { mode: 'absolute', pattern: 'DD' }, 'es')).toBe('05')
  })
})

describe('lista de atajos', () => {
  it('sin filtro devuelve todos', () => {
    expect(filterShortcuts(SHORTCUTS, '  ', 'es')).toHaveLength(SHORTCUTS.length)
  })

  it('filtra por descripción sin acentos ni mayúsculas, por teclas y por idioma', () => {
    expect(filterShortcuts(SHORTCUTS, 'ULTIMO', 'es').map((s) => s.label)).toEqual(['shortcuts.last'])
    expect(filterShortcuts(SHORTCUTS, 'pagedown', 'es').map((s) => s.label)).toEqual(['shortcuts.pageDown'])
    expect(filterShortcuts(SHORTCUTS, 'zoom in', 'en').map((s) => s.label)).toEqual(['shortcuts.zoomIn'])
    expect(filterShortcuts(SHORTCUTS, 'nada-parecido', 'es')).toEqual([])
  })

  it('incluye los atajos actuales del grafo', () => {
    const keys = SHORTCUTS.map((s) => s.keys.join('+'))
    expect(keys).toEqual(expect.arrayContaining(['↑', '↓', 'PageUp', 'PageDown', 'Home', 'End', 'Ctrl+/']))
  })
})

describe('idioma del sistema', () => {
  it('por defecto sigue a Windows', () => {
    expect(defaultPreferences().language).toBe('system')
  })

  it('system: inglés si Windows está en inglés, español en cualquier otro', () => {
    expect(resolveLanguage('system', ['en-US', 'es-MX'])).toBe('en')
    expect(resolveLanguage('system', ['en'])).toBe('en')
    expect(resolveLanguage('system', ['es-MX', 'en-US'])).toBe('es')
    expect(resolveLanguage('system', ['fr-FR'])).toBe('es')
    expect(resolveLanguage('system', [])).toBe('es')
    // un código que solo empieza con "en" no es inglés: no confundir prefijos
    expect(resolveLanguage('system', ['enx'])).toBe('es')
  })

  it('fijado a mano gana al sistema', () => {
    expect(resolveLanguage('es', ['en-US'])).toBe('es')
    expect(resolveLanguage('en', ['es-MX'])).toBe('en')
  })

  it('archivo guardado con idioma fijo lo conserva; valor desconocido vuelve a system', () => {
    const p = defaultPreferences()
    expect(parsePreferences({ ...p, language: 'es' }).language).toBe('es')
    expect(parsePreferences({ ...p, language: 'klingon' }).language).toBe('system')
  })

  it('diseño del grafo guardado que ya no existe abre con Clásico; los demás se conservan', () => {
    const p = defaultPreferences()
    expect(p.graphStyle).toBe('classic')
    expect(parsePreferences({ ...p, graphStyle: 'retirado' }).graphStyle).toBe('classic')
    expect(parsePreferences({ ...p, graphStyle: 'large' }).graphStyle).toBe('large')
  })
})
