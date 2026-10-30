import type { Preferences } from '@shared/preferences'
import type { Theme } from '@shared/themes'

/** B13: el diseño que se dibuja: el base (el del tema o el elegido) con lo que el tema de archivo cambia encima. */
export function effectiveStyle(name: Preferences['graphStyle'], theme?: Theme | null): GraphStyle {
  const base = GRAPH_STYLES[theme?.base ?? name]
  return theme ? { ...base, ...theme.style } : base
}

/** B9: diseños del grafo que se pueden elegir; `classic` es el de siempre. */
export type GraphStyleName = Preferences['graphStyle']
export interface GraphStyle {
  rowH: number
  laneW: number
  nodeR: number
  lineW: number
  /** curva o codo recto, como rieles */
  curve: 'bezier' | 'elbow'
  /** iniciales del autor dentro del nodo */
  initials: boolean
  /** color del nodo: por origen IA/humano (Fluxo) o del carril de su rama (Git Graph, SourceTree) */
  nodeColor?: 'origin' | 'lane'
  /** colores de carril propios del diseño; sin ellos, los del tema */
  lanes?: string[]
}
/** fila de 22 px y carril de 16 px (--graph-row-height), iguales a ROW_H y LANE_W de draw.ts */
export const GRAPH_STYLES: Record<GraphStyleName, GraphStyle> = {
  classic: { rowH: 22, laneW: 16, nodeR: 5, lineW: 2, curve: 'bezier', initials: false },
  compact: { rowH: 18, laneW: 11, nodeR: 3.5, lineW: 1.5, curve: 'bezier', initials: false },
  large: { rowH: 30, laneW: 24, nodeR: 10, lineW: 2.5, curve: 'bezier', initials: true },
  rails: { rowH: 22, laneW: 16, nodeR: 5, lineW: 2, curve: 'elbow', initials: false },
  // Git Graph 1.30.0 de VS Code (mhutchie): grid x 16 · y 24, nodo r 4, línea 2, curva redondeada y sus 12 colores
  gitgraph: {
    rowH: 24,
    laneW: 16,
    nodeR: 4,
    lineW: 2,
    curve: 'bezier',
    initials: false,
    nodeColor: 'lane',
    lanes: ['#0085d9', '#d9008f', '#00d90a', '#d98500', '#a300d9', '#ff0000', '#00d9cc', '#e138e8', '#85d900', '#dc5b23', '#6f24d6', '#ffcc00']
  }
}

export interface Palette {
  /** Colores de carril, sin naranja ni azul (reservados a origen IA/humano). */
  lanes: string[]
  bg: string
  text: string
  muted: string
  placeholder: string
  tag: string
  /** texto sobre píldora de rama local (fondo = color del carril) y sobre distintivo IA/H */
  onColor: string
  badgeText: string
  aiRow: string
  selectedRow: string
}

/**
 * Colores de carril de Fluxo, sin azul ni naranja,
 * que se confundirían con los distintivos de humano e IA.
 */
const LANES = ['#15a0bf', '#8e00c2', '#c517b6', '#d90171', '#cd0101', '#f2ca33', '#7bd938', '#2ece9d']

export const PALETTES: Record<Preferences['theme'], Palette> = {
  dark: {
    lanes: LANES,
    bg: '#1c1e23',
    text: 'rgba(255,255,255,0.75)',
    muted: 'rgba(255,255,255,0.6)',
    placeholder: 'rgb(50,54,63)',
    tag: 'rgb(61,66,77)',
    onColor: '#ffffff',
    badgeText: '#10141a',
    aiRow: 'rgba(245,158,11,0.08)',
    selectedRow: 'rgba(77,136,255,0.2)'
  },
  light: {
    lanes: LANES,
    bg: '#fcfcfc',
    text: 'rgba(0,0,0,0.75)',
    muted: 'rgba(0,0,0,0.6)',
    placeholder: '#ebebeb',
    tag: '#d8dce2',
    onColor: '#ffffff',
    badgeText: '#10141a',
    aiRow: 'rgba(245,158,11,0.12)',
    selectedRow: '#5f8eed33'
  }
}
