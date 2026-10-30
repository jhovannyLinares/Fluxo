import { z } from 'zod'
import { GRAPH_STYLE_NAMES } from './preferences'

/** B13: lo que un tema cambia del grafo; lo que no trae queda como en el diseño base. */
export const ThemeStyleSchema = z.object({
  rowH: z.number().min(14).max(48).optional(),
  laneW: z.number().min(8).max(40).optional(),
  nodeR: z.number().min(2).max(16).optional(),
  lineW: z.number().min(0.5).max(6).optional(),
  curve: z.enum(['bezier', 'elbow']).optional(),
  initials: z.boolean().optional(),
  nodeColor: z.enum(['origin', 'lane']).optional(),
  lanes: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).min(2).max(20).optional()
})
export type ThemeStyle = z.infer<typeof ThemeStyleSchema>

/** Un tema leído de la carpeta: su archivo, nombre y qué cambia. */
export const ThemeSchema = z.object({
  file: z.string(),
  name: z.string(),
  /** diseño sobre el que se aplica; sin él, el elegido en Personalización */
  base: z.enum(GRAPH_STYLE_NAMES).optional(),
  style: ThemeStyleSchema
})
export type Theme = z.infer<typeof ThemeSchema>

/** Formato propio de Fluxo: `{ "name": "...", "base": "gitgraph", "lanes": ["#..."], "rowH": 24, ... }`. */
const FluxoThemeSchema = ThemeStyleSchema.extend({
  name: z.string().trim().min(1).max(60),
  base: z.enum(GRAPH_STYLE_NAMES).optional()
}).strict()

/**
 * JSON con comentarios (`//` y `/* *\/`) y comas finales. Los comentarios se quitan solo
 * fuera de las cadenas: una URL `"https://…"` queda intacta.
 */
export function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inString) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

/** Lee un archivo de tema `.json` de Fluxo. */
export function parseTheme(file: string, text: string): Theme {
  const t = FluxoThemeSchema.parse(parseJsonc(text))
  const { name, base, ...style } = t
  return { file, name, ...(base ? { base } : {}), style }
}
