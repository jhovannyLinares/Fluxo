import type { GraphRow } from '@shared/graph-types'
import type { Preferences } from '@shared/preferences'
import { groupRefs, type DisplayRef } from './refs-display'
import { contrast, readableOn } from './contrast'
import type { GraphStyle, Palette } from './palettes'
import { COLUMN_LIMITS, type ColumnSizes } from './column-widths'

/** alto de fila del diseño Clásico (--graph-row-height) */
export const ROW_H = 22
export const LANE_W = 16
export const MAX_DRAWN_LANES = 20

/** B9: diseños del grafo; datos sin canvas, en `palettes.ts`, para poder probarlos */
export { GRAPH_STYLES, type GraphStyle, type GraphStyleName } from './palettes'

/** B9: colores de las etiquetas de rama: del carril (de siempre), pastel o neutro con franja del carril. */
export type TagScheme = Preferences['tagColors']
const REFS_W = 170
const REFS_W_NARROW = 130

// origen IA/humano: mismos colores en los dos temas
const AI = '#f59e0b'
const HUMAN = '#60a5fa'
// letra de la interfaz (Open Sans, empaquetada en el renderer)
const FONT = '12px "Open Sans", Arial, sans-serif'
const MONO = '12px Consolas, Monaco, monospace'
const PILL_FONT = '600 11px "Open Sans", Arial, sans-serif'

// colores de los dos temas y contraste: en módulos sin canvas, para poder probarlos (B5)
export { PALETTES, type Palette } from './palettes'
export { contrast, readableOn } from './contrast'

/** Ancho mínimo que conserva la columna del mensaje del commit. */
const MIN_MESSAGE_W = 160

export interface Columns {
  /** columna de etiquetas a la izquierda del grafo (H13, C1) */
  refsW: number
  graphW: number
  authorW: number
  dateW: number
  shaW: number
}

/**
 * Ancho 0 = columna oculta (C11). La fecha absoluta necesita más ancho que la relativa.
 * `sizes`: anchos elegidos con los divisores de la cabecera; el del grafo es la columna entera (carriles + 8 px).
 */
export function columnsFor(
  width: number,
  maxLanes: number,
  visible: Preferences['columns'] = { author: true, date: true, sha: true },
  dateMode: Preferences['date']['mode'] = 'relative',
  laneW = LANE_W,
  sizes: ColumnSizes = {}
): Columns {
  const graphW = sizes.graph !== undefined ? sizes.graph - 8 : Math.min(Math.max(maxLanes, 1), MAX_DRAWN_LANES) * laneW + 16
  const cols: Columns = {
    refsW: sizes.refs ?? (width > 1100 ? REFS_W : REFS_W_NARROW),
    graphW,
    authorW: visible.author ? (sizes.author ?? (width > 1100 ? 180 : 130)) : 0,
    dateW: visible.date ? (sizes.date ?? (dateMode === 'absolute' ? 140 : 110)) : 0,
    shaW: visible.sha ? 80 : 0
  }
  // con el grafo angosto el mensaje no se pierde: se ocultan SHA, fecha y autor (en ese orden) y al final se encoge la columna de ramas
  const msgW = () => width - (cols.refsW + cols.graphW + cols.authorW + cols.dateW + cols.shaW)
  if (msgW() < MIN_MESSAGE_W) cols.shaW = 0
  if (msgW() < MIN_MESSAGE_W) cols.dateW = 0
  if (msgW() < MIN_MESSAGE_W) cols.authorW = 0
  if (msgW() < MIN_MESSAGE_W) cols.refsW = Math.max(COLUMN_LIMITS.refs[0], cols.refsW - (MIN_MESSAGE_W - msgW()))
  return cols
}

/** Lo que cambia con las preferencias al dibujar. */
export interface DrawView {
  palette: Palette
  dateText: (epochSec: number) => string
  badges: { ai: string; human: string }
  /** texto de la fila de cambios sin commit (H14) */
  wipText: (wip: NonNullable<GraphRow['wip']>) => string
  /** B9: diseño del grafo y colores de las etiquetas */
  style: GraphStyle
  tags: TagScheme
}

/** Iniciales del autor para el nodo grande: «Ana María» → «AM», «agente» → «AG». */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}


function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return ''
  if (ctx.measureText(text).width <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

/** Portátil (rama local) de 10×8 con esquina superior izquierda en (x, y). */
function iconLocal(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillRect(x + 1, y, 8, 5)
  ctx.fillRect(x, y + 6, 10, 1.5)
}

/** Nube (rama en remoto) de 11×8. */
function iconRemote(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath()
  ctx.arc(x + 3, y + 5, 2.5, 0, Math.PI * 2)
  ctx.arc(x + 6, y + 3.5, 3.2, 0, Math.PI * 2)
  ctx.arc(x + 8.5, y + 5.2, 2.3, 0, Math.PI * 2)
  ctx.rect(x + 3, y + 5, 5.5, 2.5)
  ctx.fill()
}

/**
 * Píldora de la columna de etiquetas (C1–C4): rama local rellena con el color del carril,
 * solo remota con contorno, tag gris, stash punteada; ✓ en la rama de HEAD; iconos local/nube.
 * Devuelve el ancho usado (0 si no cabe).
 */
function refPill(
  ctx: CanvasRenderingContext2D,
  d: DisplayRef,
  x: number,
  yMid: number,
  laneColor: string,
  maxW: number,
  pal: Palette,
  tags: TagScheme = 'lane',
  /** alto de la píldora: 18 px, o 2 menos que la fila si es más baja (diseño compacto) */
  h = 18
): number {
  ctx.font = PILL_FONT
  const icons = (d.local ? 13 : 0) + (d.remotes.length ? 14 : 0)
  const text = (d.current ? '✓ ' : '') + d.name
  const label = ellipsize(ctx, text, maxW - 12 - icons)
  if (!label) return 0
  const w = ctx.measureText(label).width + 12 + icons
  const y = yMid - h / 2
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 3)
  ctx.setLineDash(d.kind === 'stash' ? [3, 2] : [])
  let fg: string
  if (d.kind === 'branch' && d.local && tags === 'pastel') {
    // B9 pastel: el color del carril suave de fondo y el nombre en ese color si se lee (si no, el texto normal)
    // relativo a la opacidad de la fila: atenuada por B11 queda más suave
    const alpha = ctx.globalAlpha
    ctx.globalAlpha = 0.22 * alpha
    ctx.fillStyle = laneColor
    ctx.fill()
    ctx.globalAlpha = alpha
    fg = contrast(laneColor, pal.bg) >= 4.5 ? laneColor : pal.text
  } else if (d.kind === 'branch' && d.local && tags === 'mono') {
    // B9 neutro: píldora gris con una franja del color del carril a la izquierda
    ctx.fillStyle = pal.tag
    ctx.fill()
    ctx.fillStyle = laneColor
    ctx.fillRect(x, y, 3, h)
    fg = pal.text
  } else if (d.kind === 'branch' && d.local) {
    ctx.fillStyle = laneColor
    ctx.fill()
    // B5: blanco u oscuro, el que se lea mejor sobre el color del carril (el blanco no se lee sobre amarillo)
    fg = readableOn(laneColor, [pal.onColor, pal.badgeText])
  } else if (d.kind === 'tag') {
    ctx.fillStyle = pal.tag
    ctx.fill()
    fg = pal.text
  } else {
    ctx.strokeStyle = d.kind === 'head' ? pal.text : laneColor
    ctx.lineWidth = 1
    ctx.stroke()
    // el color del carril solo si se lee sobre el fondo; si no, el texto normal (el contorno sigue con su color)
    fg = d.kind === 'head' || contrast(laneColor, pal.bg) < 4.5 ? pal.text : laneColor
  }
  ctx.setLineDash([])
  ctx.fillStyle = fg
  let ix = x + 6
  if (d.local) {
    iconLocal(ctx, ix, yMid - 4)
    ix += 13
  }
  if (d.remotes.length) {
    iconRemote(ctx, ix, yMid - 4)
    ix += 14
  }
  ctx.fillText(label, ix, yMid + 4)
  return w
}

/**
 * Dibuja filas visibles. `getRow(i)` devuelve null si el bloque aún no llega;
 * esas filas se pintan como marcador gris y se redibujan al llegar.
 */
export function drawRows(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scrollTop: number,
  total: number,
  cols: Columns,
  getRow: (i: number) => GraphRow | null,
  selected: number,
  view: DrawView,
  /** otras filas seleccionadas con Shift o Ctrl + clic */
  also: ReadonlySet<number> = new Set(),
  /** B11: filas de la rama bajo el ratón; el texto de las demás se atenúa. null = ninguna */
  branchRows: ReadonlySet<number> | null = null
): void {
  const pal = view.palette
  const S = view.style
  const RH = S.rowH
  ctx.fillStyle = pal.bg
  ctx.fillRect(0, 0, width, height)
  const first = Math.max(0, Math.floor(scrollTop / RH))
  const last = Math.min(total - 1, Math.ceil((scrollTop + height) / RH))
  // columnas: etiquetas | grafo | asunto | autor | fecha | sha
  const graphX = cols.refsW
  const laneX = (lane: number) => graphX + 8 + lane * S.laneW + S.laneW / 2
  const textX = graphX + cols.graphW + 8
  const shaX = width - cols.shaW
  const dateX = shaX - cols.dateW
  const authorX = dateX - cols.authorW
  const subjectMax = authorX - textX - 12
  // B9: un diseño con paleta propia (Git Graph) la usa en lugar de la del tema; con más carriles que colores, se repite
  const lanes = S.lanes ?? pal.lanes
  const laneColor = (c: number) => lanes[c % lanes.length] ?? pal.muted

  for (let i = first; i <= last; i++) {
    ctx.globalAlpha = 1 // la fila anterior pudo quedar atenuada (B11)
    const y = i * RH - scrollTop
    const mid = y + RH / 2
    const row = getRow(i)
    if (!row) {
      ctx.fillStyle = pal.placeholder
      ctx.fillRect(textX, mid - 4, 220, 8)
      continue
    }
    const isSelected = i === selected || also.has(i)
    if (isSelected) {
      ctx.fillStyle = pal.selectedRow
      ctx.fillRect(0, y, width, RH)
    } else if (row.ai) {
      ctx.fillStyle = pal.aiRow
      ctx.fillRect(0, y, width, RH)
    }

    // líneas del grafo (recortadas a su columna); B9: curva o codo recto (rieles)
    ctx.save()
    ctx.beginPath()
    ctx.rect(graphX, y, cols.graphW, RH)
    ctx.clip()
    ctx.lineWidth = S.lineW
    const bend = (x0: number, y0: number, x1: number, y1: number) => {
      const ym = (y0 + y1) / 2
      if (S.curve === 'elbow') {
        ctx.lineTo(x0, ym)
        ctx.lineTo(x1, ym)
        ctx.lineTo(x1, y1)
      } else ctx.bezierCurveTo(x0, ym, x1, ym, x1, y1)
    }
    for (const [kind, a, b, color] of row.segments) {
      ctx.strokeStyle = laneColor(color)
      ctx.beginPath()
      const xa = laneX(a)
      const xb = laneX(b)
      if (kind === 0) {
        ctx.moveTo(xa, y)
        ctx.lineTo(xa, y + RH)
      } else if (kind === 1) {
        ctx.moveTo(xa, y)
        if (xa === xb) ctx.lineTo(xb, mid)
        else bend(xa, y, xb, mid)
      } else {
        ctx.moveTo(xa, mid)
        if (xa === xb) ctx.lineTo(xb, y + RH)
        else bend(xa, mid, xb, y + RH)
      }
      ctx.stroke()
    }
    // nodo: color por origen (IA naranja, humano azul); merge con anillo
    const nx = laneX(row.lane)
    ctx.beginPath()
    ctx.arc(nx, mid, S.nodeR, 0, Math.PI * 2)
    if (row.kind) {
      // WIP y stash (C5): nodo hueco punteado, no es un commit del historial
      ctx.fillStyle = pal.bg
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.setLineDash([2, 2])
      ctx.strokeStyle = laneColor(row.color)
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.fillStyle = S.nodeColor === 'lane' ? laneColor(row.color) : row.ai ? AI : HUMAN
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = row.parents.length > 1 ? laneColor(row.color) : pal.bg
      ctx.stroke()
      // B9 nodos grandes: iniciales del autor dentro del nodo
      if (S.initials) {
        ctx.font = '700 9px "Open Sans", Arial, sans-serif'
        ctx.fillStyle = pal.badgeText
        const ini = initialsOf(row.author)
        ctx.fillText(ini, nx - ctx.measureText(ini).width / 2, mid + 3)
      }
    }
    ctx.restore()

    // B11: solo el texto se atenúa (--text-dimmed 0.2 y --text-dimmed-selected 0.5
    // sobre un texto de 0.75); las líneas y los nodos del grafo quedan igual
    if (branchRows && !branchRows.has(i)) ctx.globalAlpha = isSelected ? 0.5 / 0.75 : 0.2 / 0.75

    // columna de etiquetas (C1): primera píldora, «+N» si hay más (C3) y línea fina hasta el nodo
    const refs = row.refs.length ? groupRefs(row.refs) : []
    if (refs.length) {
      const color = laneColor(row.color)
      ctx.font = PILL_FONT
      const more = refs.length > 1 ? `+${refs.length - 1}` : ''
      const moreW = more ? ctx.measureText(more).width + 10 : 0
      const pillH = Math.min(18, RH - 2)
      const used = refPill(ctx, refs[0]!, 6, mid, color, cols.refsW - 12 - (more ? moreW + 4 : 0), pal, view.tags, pillH)
      let end = 6 + used
      if (more) {
        ctx.beginPath()
        ctx.roundRect(end + 4, mid - pillH / 2, moreW, pillH, 3)
        ctx.fillStyle = pal.tag
        ctx.fill()
        ctx.fillStyle = pal.text
        ctx.fillText(more, end + 9, mid + 4)
        end += 4 + moreW
      }
      ctx.strokeStyle = color
      const alpha = ctx.globalAlpha
      ctx.globalAlpha = 0.6 * alpha
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(end + 2, mid)
      ctx.lineTo(laneX(row.lane) - S.nodeR - 1, mid)
      ctx.stroke()
      ctx.globalAlpha = alpha
    }

    // commits agrupados: «+N» (los que esconde la fila) delante del asunto
    let subjectX = textX
    if (row.group) {
      ctx.font = PILL_FONT
      const g = `+${row.group.count}`
      const gw = ctx.measureText(g).width + 10
      ctx.beginPath()
      ctx.roundRect(subjectX, mid - 8, gw, 16, 3)
      ctx.fillStyle = pal.tag
      ctx.fill()
      ctx.fillStyle = pal.text
      ctx.fillText(g, subjectX + 5, mid + 4)
      subjectX += gw + 6
    }

    // asunto
    ctx.font = row.kind === 'wip' ? `italic ${FONT}` : FONT
    ctx.fillStyle = row.kind === 'wip' ? pal.muted : pal.text
    const subject = row.kind === 'wip' && row.wip ? view.wipText(row.wip) : row.subject
    ctx.fillText(ellipsize(ctx, subject, subjectMax - (subjectX - textX)), subjectX, mid + 4)
    if (row.kind === 'wip') continue // sin autor, fecha ni sha

    // autor con distintivo IA/H (columnas ocultas tienen ancho 0)
    if (cols.authorW) {
      ctx.font = PILL_FONT
      ctx.fillStyle = row.ai ? AI : HUMAN
      ctx.beginPath()
      ctx.roundRect(authorX, mid - 8, 20, 16, 3)
      ctx.fill()
      ctx.fillStyle = pal.badgeText
      const badge = row.ai ? view.badges.ai : view.badges.human
      ctx.fillText(badge, authorX + (20 - ctx.measureText(badge).width) / 2, mid + 4)
      ctx.font = FONT
      ctx.fillStyle = pal.text
      ctx.fillText(ellipsize(ctx, row.author, cols.authorW - 34), authorX + 26, mid + 4)
    }

    ctx.font = FONT
    ctx.fillStyle = pal.muted
    if (cols.dateW) ctx.fillText(ellipsize(ctx, view.dateText(row.time), cols.dateW - 8), dateX, mid + 4)
    ctx.font = MONO
    if (cols.shaW) ctx.fillText(row.hash.slice(0, 7), shaX, mid + 4)
  }
  ctx.globalAlpha = 1
}
