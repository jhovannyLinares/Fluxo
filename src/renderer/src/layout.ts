/** B1: anchos del panel izquierdo y del detalle, que se arrastran con los divisores y se recuerdan. */
export interface PanelWidths {
  left: number
  right: number
}

/** De fábrica: 250 y 400 px. */
export const DEFAULT_WIDTHS: PanelWidths = { left: 314, right: 400 }
export const LIMITS = { left: [160, 480], right: [280, 720] } as const
/** El grafo nunca queda más angosto que esto, aunque los paneles lo pidan. */
export const MIN_CENTER = 300

const KEY = 'fluxo.layout.widths'

/** Acota un ancho a sus límites y al espacio que deja el otro panel sin dejar el grafo por debajo de `MIN_CENTER`. */
export function clampWidth(side: keyof PanelWidths, want: number, other: number, total: number): number {
  const [min, max] = LIMITS[side]
  const room = total - other - MIN_CENTER
  return Math.round(Math.max(min, Math.min(max, room, want)))
}

/**
 * Anchos que de verdad se usan con la ventana de ahora: los recordados, encogidos para que el grafo nunca baje de
 * `MIN_CENTER` (primero el detalle, luego el panel de ramas). Los recordados no se tocan: al agrandar la ventana vuelven.
 */
export function fitWidths(w: PanelWidths, total: number, visible: { left: boolean; right: boolean }): PanelWidths {
  let left = visible.left ? w.left : 0
  let right = visible.right ? w.right : 0
  let over = left + right + MIN_CENTER - total
  if (over > 0 && visible.right) {
    const cut = Math.min(over, right - LIMITS.right[0])
    right -= cut
    over -= cut
  }
  if (over > 0 && visible.left) left -= Math.min(over, left - LIMITS.left[0])
  return { left: visible.left ? left : w.left, right: visible.right ? right : w.right }
}

export function loadWidths(): PanelWidths {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PanelWidths> | null
    const ok = (side: keyof PanelWidths) => {
      const v = raw?.[side]
      return typeof v === 'number' && v >= LIMITS[side][0] && v <= LIMITS[side][1] ? v : DEFAULT_WIDTHS[side]
    }
    return { left: ok('left'), right: ok('right') }
  } catch {
    return DEFAULT_WIDTHS
  }
}

export function saveWidths(w: PanelWidths): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w))
  } catch {
    // solo se pierden los anchos recordados
  }
}
