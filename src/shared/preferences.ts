import { z } from 'zod'
import type { Language } from './i18n'

/**
 * Preferencias de vista (H06). Viven en main (userData/preferences.json) y viajan por IPC.
 * `version` cambia solo si el formato deja de ser compatible: otra versión vuelve a valores por defecto.
 */
export const PREFERENCES_VERSION = 1

export const LANGUAGES = ['es', 'en'] as const
/** `system` sigue el idioma de Windows; los demás lo fijan a mano */
export const LANGUAGE_PREFS = ['system', ...LANGUAGES] as const
export const THEMES = ['dark', 'light'] as const
export const DIFF_FONTS = ['Cascadia Mono', 'Consolas', 'Courier New'] as const
/** B9: diseños del grafo y colores de etiquetas; la única lista, la usan el dibujo y Preferencias */
export const GRAPH_STYLE_NAMES = ['classic', 'compact', 'large', 'rails', 'gitgraph'] as const
export const TAG_SCHEMES = ['lane', 'pastel', 'mono'] as const
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
/** minutos entre autofetch (H10); 0 = apagado */
export const AUTO_FETCH_OPTIONS = [0, 1, 5, 10, 15, 30] as const

export const DEFAULT_PREFERENCES = {
  version: PREFERENCES_VERSION,
  theme: 'dark',
  language: 'system',
  columns: { author: true, date: true, sha: false },
  date: { mode: 'relative', pattern: 'DD/MM/YYYY HH:mm' },
  diffFont: { family: 'Cascadia Mono', size: 12 },
  zoom: 1,
  autoFetchMinutes: 5,
  // formato largo para la fecha del detalle del commit
  detailDate: 'D [de] MMMM [de] YYYY H:mm',
  toolbarLabels: true,
  graphStyle: 'classic',
  tagColors: 'lane',
  graphTheme: null,
  highlightRowsOnRefHover: true
} as const satisfies Preferences

const ColumnsSchema = z.object({ author: z.boolean(), date: z.boolean(), sha: z.boolean() })
const DateSchema = z.object({ mode: z.enum(['relative', 'absolute']), pattern: z.string().trim().min(1).max(40) })
const DiffFontSchema = z.object({ family: z.enum(DIFF_FONTS), size: z.number().int().min(9).max(24) })

/** Esquema estricto: lo que acepta el canal `prefs:set`. */
export const PreferencesSchema = z.object({
  version: z.literal(PREFERENCES_VERSION),
  theme: z.enum(THEMES),
  language: z.enum(LANGUAGE_PREFS),
  columns: ColumnsSchema,
  date: DateSchema,
  diffFont: DiffFontSchema,
  zoom: z.number().min(ZOOM_MIN).max(ZOOM_MAX),
  autoFetchMinutes: z.number().int().min(0).max(60),
  /** patrón de la fecha en el detalle del commit (Personalización) */
  detailDate: z.string().trim().min(1).max(60),
  /** etiquetas debajo de los íconos de la barra */
  toolbarLabels: z.boolean(),
  /** B9: diseño del grafo y colores de las etiquetas de rama */
  graphStyle: z.enum(GRAPH_STYLE_NAMES),
  tagColors: z.enum(TAG_SCHEMES),
  /** B13: archivo de la carpeta de temas aplicado sobre el diseño; null = ninguno */
  graphTheme: z.string().min(1).max(200).nullable(),
  /** B11: al pasar sobre una rama del panel, atenuar las filas que no son de ella */
  highlightRowsOnRefHover: z.boolean()
})
export type Preferences = z.infer<typeof PreferencesSchema>

/** Esquema tolerante para leer disco: un campo dañado vuelve a su valor por defecto sin perder los demás. */
const LenientSchema = z.object({
  version: z.literal(PREFERENCES_VERSION),
  theme: PreferencesSchema.shape.theme.catch(DEFAULT_PREFERENCES.theme),
  language: PreferencesSchema.shape.language.catch(DEFAULT_PREFERENCES.language),
  columns: ColumnsSchema.catch({ ...DEFAULT_PREFERENCES.columns }),
  date: DateSchema.catch({ ...DEFAULT_PREFERENCES.date }),
  diffFont: DiffFontSchema.catch({ ...DEFAULT_PREFERENCES.diffFont }),
  zoom: PreferencesSchema.shape.zoom.catch(DEFAULT_PREFERENCES.zoom),
  // archivos de antes de H10 no lo traen: toma el valor por defecto
  autoFetchMinutes: PreferencesSchema.shape.autoFetchMinutes.catch(DEFAULT_PREFERENCES.autoFetchMinutes),
  // archivos anteriores no los traen: toman el valor por defecto sin tocar los demás
  detailDate: PreferencesSchema.shape.detailDate.catch(DEFAULT_PREFERENCES.detailDate),
  toolbarLabels: PreferencesSchema.shape.toolbarLabels.catch(DEFAULT_PREFERENCES.toolbarLabels),
  graphStyle: PreferencesSchema.shape.graphStyle.catch(DEFAULT_PREFERENCES.graphStyle),
  tagColors: PreferencesSchema.shape.tagColors.catch(DEFAULT_PREFERENCES.tagColors),
  graphTheme: PreferencesSchema.shape.graphTheme.catch(DEFAULT_PREFERENCES.graphTheme),
  highlightRowsOnRefHover: PreferencesSchema.shape.highlightRowsOnRefHover.catch(DEFAULT_PREFERENCES.highlightRowsOnRefHover)
})

export function defaultPreferences(): Preferences {
  return structuredClone(DEFAULT_PREFERENCES) as Preferences
}

/** Contenido de disco → preferencias. JSON inválido, otra versión o algo que no es objeto → valores por defecto. */
export function parsePreferences(raw: unknown): Preferences {
  const r = LenientSchema.safeParse(raw)
  return r.success ? r.data : defaultPreferences()
}

/** Idioma efectivo: el fijado a mano, o con `system` inglés si el idioma de Windows es inglés y español en cualquier otro. */
export function resolveLanguage(pref: Preferences['language'], systemLocales: readonly string[]): Language {
  if (pref !== 'system') return pref
  return /^en\b/i.test(systemLocales[0] ?? '') ? 'en' : 'es'
}

/** Paso de zoom de Ctrl++ / Ctrl+- (dir 0 = Ctrl+0, restablecer). */
export function nextZoom(current: number, dir: -1 | 0 | 1): number {
  if (dir === 0) return 1
  const z = Math.round((current + dir * 0.1) * 10) / 10
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}
