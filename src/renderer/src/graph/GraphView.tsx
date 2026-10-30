import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GraphRow } from '@shared/graph-types'
import type { Theme } from '@shared/themes'
import { commitDate } from '../format'
import { usePrefs, type Translate } from '../prefs'
import { columnsFor, drawRows, PALETTES } from './draw'
import { effectiveStyle } from './palettes'
import type { ColumnSizes } from './column-widths'
import { groupRefs, refsTooltip } from './refs-display'

const CHUNK = 500

/** «Cambios sin commit · 2 en stage · 3 modificados · 1 nuevo» (fila WIP, H14). */
export function wipSummary(w: NonNullable<GraphRow['wip']>, t: Translate): string {
  const parts = [t('wip.title')]
  if (w.staged) parts.push(t('wip.staged', { n: w.staged }))
  if (w.unstaged) parts.push(t('wip.unstaged', { n: w.unstaged }))
  if (w.untracked) parts.push(t('wip.untracked', { n: w.untracked }))
  return parts.join(' · ')
}

interface Props {
  repoId: string
  /** versión del grafo en backend; cambia cuando llega historial completo */
  version: number
  total: number
  maxLanes: number
  fetchRows: (offset: number, limit: number) => Promise<{ version: number; rows: GraphRow[] }>
  /** fila del primer padre o del hijo que sigue la rama (H12); null si no hay */
  findNeighbor: (index: number, dir: 'parent' | 'child') => Promise<number | null>
  onSelect: (row: GraphRow | null) => void
  onFirstPaint?: () => void
  /** clic derecho sobre la columna de etiquetas de una fila con refs (H15: ocultar, anclar) */
  onRefsMenu?: (row: GraphRow, x: number, y: number) => void
  /** doble clic sobre la columna de etiquetas de una fila con refs: cambiar a esa rama */
  onRefsDoubleClick?: (row: GraphRow) => void
  /** soltar las etiquetas de una fila sobre las de otra (X sobre Y) */
  onRefsDrop?: (from: GraphRow, to: GraphRow, x: number, y: number) => void
  /** clic derecho en el resto de la fila: menú del commit */
  onRowMenu?: (row: GraphRow, x: number, y: number) => void
  /** filas seleccionadas (con Shift/Ctrl + clic pueden ser varias), de arriba abajo */
  onMultiSelect?: (rows: { index: number; row: GraphRow }[]) => void
  /** saltar a una fila y seleccionarla (clic en una rama del panel, H16); `n` distingue saltos repetidos */
  jumpTo?: { index: number; n: number } | null
  /** H20: tras una recarga en vivo, marcar la fila del commit seleccionado sin mover la vista; -1 = ninguna */
  keepSelection?: { index: number; n: number } | null
  /** ancho medido de la vista: la cabecera usa el mismo para alinear sus columnas (B1, B6) */
  onWidth?: (w: number) => void
  /** B13: tema de archivo aplicado sobre el diseño elegido */
  theme?: Theme | null
  /** B11: filas de la rama bajo el ratón en el panel; las demás se atenúan. null = ninguna */
  branchRows?: ReadonlySet<number> | null
  /** anchos elegidos con los divisores de la cabecera; la misma que usa `GraphHeader` */
  columnSizes?: ColumnSizes
}

/**
 * Grafo virtualizado: canvas del tamaño de la vista; filas llegan por bloques de 500
 * desde backend y solo se pintan las visibles. Escala a 100k+ commits.
 */
export function GraphView({
  repoId,
  version,
  total,
  maxLanes,
  fetchRows,
  findNeighbor,
  onSelect,
  onFirstPaint,
  onRefsMenu,
  onRefsDoubleClick,
  onRefsDrop,
  onRowMenu,
  onMultiSelect,
  jumpTo,
  keepSelection,
  onWidth,
  theme,
  branchRows = null,
  columnSizes
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chunks = useRef(new Map<number, GraphRow[]>())
  const loading = useRef(new Set<number>())
  const frame = useRef(0)
  /** draw vigente: un bloque que llega tarde no debe repintar con el tamaño de cuando se pidió */
  const drawRef = useRef<() => void>(() => {})
  const painted = useRef(false)
  const [selected, setSelected] = useState(-1)
  // arrastre de una rama sobre otra: fila de la etiqueta pulsada y si el siguiente clic hay que ignorarlo
  const dragFrom = useRef<number | null>(null)
  const swallowClick = useRef(false)
  // Shift/Ctrl + clic: otras filas seleccionadas además de `selected` (cherry pick de varios commits)
  const [also, setAlso] = useState<ReadonlySet<number>>(new Set())
  const [size, setSize] = useState({ w: 800, h: 600 })
  const { prefs, lang, t } = usePrefs()
  // B9/B13: diseño elegido con el tema de archivo encima; su alto de fila manda en el scroll, los clics y el pintado
  const style = useMemo(() => effectiveStyle(prefs.graphStyle, theme), [prefs.graphStyle, theme])
  const RH = style.rowH

  const getRow = useCallback((i: number): GraphRow | null => {
    const chunk = chunks.current.get(Math.floor(i / CHUNK))
    return chunk?.[i % CHUNK] ?? null
  }, [])

  const draw = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      const scroller = scrollRef.current
      if (!canvas || !scroller) return
      const dpr = window.devicePixelRatio || 1
      const { w, h } = size
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const top = scroller.scrollTop
      const now = Date.now()
      drawRows(ctx, w, h, top, total, columnsFor(w, maxLanes, prefs.columns, prefs.date.mode, style.laneW, columnSizes), getRow, selected, {
        palette: PALETTES[prefs.theme],
        dateText: (time) => commitDate(time, now, prefs.date, lang),
        badges: { ai: t('graph.badge.ai'), human: t('graph.badge.human') },
        wipText: (w) => wipSummary(w, t),
        style,
        tags: prefs.tagColors
      }, also, branchRows)

      // pedir bloques faltantes de la zona visible (+1 de margen)
      const firstChunk = Math.floor(top / RH / CHUNK)
      const lastChunk = Math.floor((top + h) / RH / CHUNK) + 1
      for (let c = firstChunk; c <= lastChunk && c * CHUNK < total; c++) {
        if (chunks.current.has(c) || loading.current.has(c)) continue
        loading.current.add(c)
        const asked = version
        void fetchRows(c * CHUNK, CHUNK).then((r) => {
          loading.current.delete(c)
          if (r.version !== asked) return // bloque de versión vieja: se pide de nuevo
          chunks.current.set(c, r.rows)
          drawRef.current()
        })
      }
      if (!painted.current && getRow(Math.floor(top / RH))) {
        painted.current = true
        onFirstPaint?.()
        // repo recién abierto sin selección: el último commit de la rama actual (HEAD), si está en el primer bloque;
        // si no, la primera fila que no es WIP ni stash
        if (selected < 0) {
          const first = chunks.current.get(0) ?? []
          const head = first.findIndex((r) => r.refs.some((ref) => ref.kind === 'head'))
          const plain = first.findIndex((r) => !r.kind)
          selectRef.current(head >= 0 ? head : Math.max(plain, 0))
        }
      }
    })
  }, [size, version, total, maxLanes, getRow, selected, also, branchRows, fetchRows, onFirstPaint, prefs, lang, t, style, columnSizes])
  drawRef.current = draw

  // repo nuevo: volver arriba y limpiar selección
  useEffect(() => {
    painted.current = false
    setSelected(-1)
    setAlso(new Set())
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [repoId])

  // versión nueva (historial completo): limpiar caché sin mover scroll; la selección múltiple apuntaba a filas viejas
  useEffect(() => {
    chunks.current.clear()
    loading.current.clear()
    setAlso(new Set())
  }, [repoId, version])

  // avisa la selección completa (sin la fila WIP) cada vez que cambia
  useEffect(() => {
    if (!onMultiSelect) return
    const all = [selected, ...also].filter((i) => i >= 0).sort((a, b) => a - b)
    onMultiSelect(all.flatMap((index) => {
      const row = getRow(index)
      return row && row.kind !== 'wip' ? [{ index, row }] : []
    }))
  }, [selected, also, getRow, onMultiSelect])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // tamaño real antes del primer pintado; el observer sigue los cambios
    setSize({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => onWidth?.(size.w), [size.w, onWidth])

  useEffect(draw, [draw])

  // el canvas no se repinta solo al cargar Open Sans: se pinta de nuevo cuando la letra está lista
  useEffect(() => {
    void document.fonts.ready.then(() => drawRef.current())
  }, [])

  const select = (i: number) => {
    const idx = Math.max(0, Math.min(total - 1, i))
    setSelected(idx)
    const row = getRow(idx)
    onSelect(row)
    // fila de un bloque aún no cargado (salto por la rama, Ctrl+End): el detalle llega con el bloque
    if (!row) {
      const c = Math.floor(idx / CHUNK)
      const asked = version
      void fetchRows(c * CHUNK, CHUNK).then((r) => {
        if (r.version !== asked) return
        chunks.current.set(c, r.rows)
        onSelect(r.rows[idx % CHUNK] ?? null)
        drawRef.current()
      })
    }
    const el = scrollRef.current
    if (el) {
      const y = idx * RH
      if (y < el.scrollTop) el.scrollTop = y
      else if (y + RH > el.scrollTop + el.clientHeight) el.scrollTop = y + RH - el.clientHeight
    }
  }

  // salto desde el panel de ramas: selecciona y deja la fila a la vista, centrada
  const selectRef = useRef(select)
  selectRef.current = select
  useEffect(() => {
    if (!jumpTo) return
    const el = scrollRef.current
    if (el) el.scrollTop = Math.max(0, jumpTo.index * RH - el.clientHeight / 2)
    selectRef.current(jumpTo.index)
    el?.focus()
  }, [jumpTo])

  useEffect(() => {
    if (keepSelection) setSelected(keepSelection.index)
  }, [keepSelection])

  return (
    <div
      ref={scrollRef}
      className="graph-scroll"
      tabIndex={0}
      role="grid"
      aria-label={t('graph.aria', { total })}
      aria-rowcount={total}
      onScroll={draw}
      onMouseMove={(e) => {
        // C3: sobre la columna de etiquetas, la lista completa de refs de esa fila
        const el = scrollRef.current!
        const rect = el.getBoundingClientRect()
        const cols = columnsFor(size.w, maxLanes, prefs.columns, prefs.date.mode, style.laneW, columnSizes)
        const row = e.clientX - rect.left < cols.refsW ? getRow(Math.floor((e.clientY - rect.top + el.scrollTop) / RH)) : null
        const tip = row?.refs.length ? refsTooltip(groupRefs(row.refs)) : ''
        if (el.title !== tip) el.title = tip
      }}
      onContextMenu={(e) => {
        const el = scrollRef.current!
        const rect = el.getBoundingClientRect()
        const cols = columnsFor(size.w, maxLanes, prefs.columns, prefs.date.mode, style.laneW, columnSizes)
        const index = Math.floor((e.clientY - rect.top + el.scrollTop) / RH)
        const row = getRow(index)
        if (!row) return
        // sobre las etiquetas: menú de la rama (H15); en el resto de la fila: menú del commit
        if (e.clientX - rect.left < cols.refsW && row.refs.length && onRefsMenu) {
          e.preventDefault()
          onRefsMenu(row, e.clientX, e.clientY)
        } else if (row.kind !== 'wip' && onRowMenu) {
          e.preventDefault()
          // dentro de la selección se conserva (menú de varios commits); fuera, se elige solo esa fila
          if (index !== selected && !also.has(index)) {
            setAlso(new Set())
            select(index)
          }
          onRowMenu(row, e.clientX, e.clientY)
        }
      }}
      onMouseDown={(e) => {
        if (e.button !== 0 || !onRefsDrop) return
        const el = scrollRef.current!
        const rect = el.getBoundingClientRect()
        const cols = columnsFor(size.w, maxLanes, prefs.columns, prefs.date.mode, style.laneW, columnSizes)
        const index = Math.floor((e.clientY - rect.top + el.scrollTop) / RH)
        dragFrom.current = e.clientX - rect.left < cols.refsW && getRow(index)?.refs.length ? index : null
      }}
      onMouseUp={(e) => {
        const from = dragFrom.current
        dragFrom.current = null
        if (from === null || !onRefsDrop) return
        const el = scrollRef.current!
        const rect = el.getBoundingClientRect()
        const cols = columnsFor(size.w, maxLanes, prefs.columns, prefs.date.mode, style.laneW, columnSizes)
        const index = Math.floor((e.clientY - rect.top + el.scrollTop) / RH)
        const a = getRow(from)
        const b = getRow(index)
        if (index === from || !a || !b || !b.refs.length || e.clientX - rect.left >= cols.refsW) return
        swallowClick.current = true
        onRefsDrop(a, b, e.clientX, e.clientY)
      }}
      onMouseLeave={() => {
        dragFrom.current = null
      }}
      onDoubleClick={(e) => {
        // sobre las etiquetas: cambiar a esa rama, como en GitKraken
        const el = scrollRef.current!
        const rect = el.getBoundingClientRect()
        const cols = columnsFor(size.w, maxLanes, prefs.columns, prefs.date.mode, style.laneW, columnSizes)
        const row = getRow(Math.floor((e.clientY - rect.top + el.scrollTop) / RH))
        if (row?.refs.length && e.clientX - rect.left < cols.refsW) onRefsDoubleClick?.(row)
      }}
      onClick={(e) => {
        if (swallowClick.current) {
          swallowClick.current = false
          return
        }
        const el = scrollRef.current!
        const rect = el.getBoundingClientRect()
        const i = Math.max(0, Math.min(total - 1, Math.floor((e.clientY - rect.top + el.scrollTop) / RH)))
        // Shift selecciona el rango desde la fila elegida, Ctrl suma o quita una fila
        if (e.shiftKey && selected >= 0) {
          const range = new Set<number>()
          for (let k = Math.min(selected, i); k <= Math.max(selected, i); k++) if (k !== selected) range.add(k)
          setAlso(range)
        } else if (e.ctrlKey && selected >= 0 && i !== selected) {
          setAlso((s) => {
            const n = new Set(s)
            if (n.has(i)) n.delete(i)
            else n.add(i)
            return n
          })
        } else {
          setAlso(new Set())
          select(i)
        }
      }}
      onKeyDown={(e) => {
        if (e.altKey || e.metaKey) return
        // J/K como ↓/↑ (C22); con Shift, por la rama
        const key = { j: 'ArrowDown', J: 'ArrowDown', k: 'ArrowUp', K: 'ArrowUp' }[e.key] ?? e.key
        if (e.shiftKey && (key === 'ArrowDown' || key === 'ArrowUp')) {
          e.preventDefault()
          if (selected < 0) return select(0)
          void findNeighbor(selected, key === 'ArrowDown' ? 'parent' : 'child').then((n) => {
            if (n !== null) select(n)
          })
          return
        }
        if (e.ctrlKey && key !== 'Home' && key !== 'End') return
        const page = Math.floor(size.h / RH)
        const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page }
        if (key in moves) {
          e.preventDefault()
          select((selected < 0 ? -1 : selected) + moves[key]!)
        } else if (key === 'Home') {
          e.preventDefault()
          select(0)
        } else if (key === 'End') {
          e.preventDefault()
          select(total - 1)
        }
      }}
    >
      <div style={{ height: Math.max(total * RH, size.h), position: 'relative' }}>
        <canvas ref={canvasRef} className="graph-canvas" style={{ width: size.w, height: size.h }} />
      </div>
    </div>
  )
}
