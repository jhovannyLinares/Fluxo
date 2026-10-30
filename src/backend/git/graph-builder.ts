import { WIP_HASH, type GraphRow, type RefLabel, type Segment } from '@shared/graph-types'
import { isAiCommit, type RawCommit } from './parsers/log'

export const PALETTE_SIZE = 8

/**
 * Color de una línea a partir del commit donde empieza (punta de rama o padre extra de un merge):
 * el mismo commit da el mismo color aunque se oculten ramas o lleguen commits nuevos (H15, N1).
 */
export function lineColor(hash: string): number {
  let h = 0
  for (let i = 0; i < hash.length; i++) h = (h * 31 + hash.charCodeAt(i)) | 0
  return Math.abs(h) % PALETTE_SIZE
}

/**
 * Agrupa cadenas de commits seguidos del mismo autor (mismo correo, sin distinguir mayúsculas) en el más nuevo.
 * Un commit entra al grupo del de arriba solo si es su único padre, tiene un solo hijo, no es un merge y no
 * lleva etiquetas: así ninguna rama, tag ni merge queda escondido y el grafo conserva su forma.
 * Devuelve los commits que se ven, con los padres del más viejo de su grupo para dibujar la línea, y por cada
 * grupo cuántos commits esconde y los padres reales del commit que se muestra.
 */
export function collapseRuns(
  commits: readonly RawCommit[],
  refs: ReadonlyMap<string, RefLabel[]>
): { commits: RawCommit[]; groups: Map<string, { count: number; parents: string[] }> } {
  const byHash = new Map(commits.map((c) => [c.hash, c]))
  const children = new Map<string, number>()
  for (const c of commits) for (const p of c.parents) children.set(p, (children.get(p) ?? 0) + 1)
  const hidden = new Set<string>()
  const groups = new Map<string, { count: number; parents: string[] }>()
  const out: RawCommit[] = []
  for (const c of commits) {
    if (hidden.has(c.hash)) continue
    let tail = c
    let count = 0
    while (c.hash !== WIP_HASH && tail.parents.length === 1) {
      const next = byHash.get(tail.parents[0]!)
      if (
        !next ||
        next.parents.length > 1 ||
        children.get(next.hash) !== 1 ||
        (refs.get(next.hash)?.length ?? 0) > 0 ||
        next.email.toLowerCase() !== c.email.toLowerCase()
      )
        break
      hidden.add(next.hash)
      tail = next
      count++
    }
    if (count === 0) out.push(c)
    else {
      groups.set(c.hash, { count, parents: c.parents })
      out.push({ ...c, parents: tail.parents })
    }
  }
  return { commits: out, groups }
}

export interface GraphResult {
  rows: GraphRow[]
  maxLanes: number
}

/**
 * Asigna carriles a commits en orden topológico (hijos antes que padres).
 *
 * `lanes[i]` = hash que el carril i espera encontrar más abajo.
 * Por fila se emiten segmentos: líneas que pasan, que entran al nodo y que salen del nodo.
 * Colores estables: cada carril conserva su color mientras sigue la misma línea.
 */
export function buildGraph(
  commits: readonly RawCommit[],
  refs: Map<string, RefLabel[]> = new Map(),
  /** A5: commits de la rama anclada (cadena de primeros padres); ocupan siempre el carril 0 */
  pinned: ReadonlySet<string> = new Set()
): GraphResult {
  const pin = pinned.size > 0
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let maxLanes = 0
  // color propio de la línea, sin mirar a sus vecinas: si dependiera de ellas, ocultar una rama
  // cambiaría el color de otras (H15). Costo: a veces dos líneas contiguas comparten color.
  const colorFor = (hash: string, _lane: number): number => lineColor(hash)
  const rows: GraphRow[] = new Array(commits.length)

  // con rama anclada, el carril 0 queda reservado: las demás líneas empiezan en el 1
  const freeSlot = (avoid: number): number => {
    if (pin && lanes.length === 0) lanes.push(null)
    for (let i = pin ? 1 : 0; i < lanes.length; i++) if (lanes[i] === null && i !== avoid) return i
    lanes.push(null)
    return lanes.length - 1
  }

  for (let r = 0; r < commits.length; r++) {
    const c = commits[r]!
    const segments: Segment[] = []

    // carril del nodo: primero que lo espera; si ninguno (punta de rama), carril libre
    let node = lanes.indexOf(c.hash)
    const isTip = node === -1
    // el nodo empieza en su carril sin línea que baje desde arriba hasta él
    let startsHere = isTip
    if (pinned.has(c.hash) && node !== 0) {
      // punta de la rama anclada (o primer commit anclado, si tiene hijos de otras ramas encima):
      // va al carril 0, que nadie más usa; las líneas de sus hijos convergen hacia él
      if (lanes.length === 0) lanes.push(null)
      node = 0
      lanes[0] = c.hash
      colors[0] = colorFor(c.hash, 0)
      startsHere = true
    } else if (isTip) {
      node = freeSlot(-1)
      lanes[node] = c.hash
      colors[node] = colorFor(c.hash, node)
    }
    const nodeColor = colors[node]!

    // líneas desde arriba: pasan de largo o convergen en este nodo
    for (let i = 0; i < lanes.length; i++) {
      const h = lanes[i]
      if (h === null || h === undefined) continue
      if (h === c.hash) {
        if (!(startsHere && i === node)) segments.push([1, i, node, colors[i]!])
        if (i !== node) lanes[i] = null // rama que se fusiona termina aquí
      } else {
        segments.push([0, i, i, colors[i]!])
      }
    }

    // primer padre continúa en carril del nodo (línea principal recta);
    // si otro carril también lo espera, ambos convergen al llegar al padre
    const [first, ...rest] = c.parents
    if (first !== undefined) {
      lanes[node] = first
      segments.push([2, node, node, nodeColor])
    } else {
      lanes[node] = null // commit raíz
    }

    // padres extra (merge): carril existente o nuevo
    for (const p of rest) {
      let j = lanes.indexOf(p)
      if (j === -1) {
        j = freeSlot(node)
        lanes[j] = p
        colors[j] = colorFor(p, j)
      }
      segments.push([2, node, j, colors[j]!])
    }

    // recortar carriles vacíos al final
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    const width = Math.max(lanes.length, node + 1, ...segments.map((s) => Math.max(s[1], s[2]) + 1))
    if (width > maxLanes) maxLanes = width

    rows[r] = {
      hash: c.hash,
      parents: c.parents,
      author: c.author,
      email: c.email,
      time: c.time,
      subject: c.subject,
      ai: isAiCommit(c),
      lane: node,
      color: nodeColor,
      segments,
      refs: refs.get(c.hash) ?? []
    }
  }

  return { rows, maxLanes }
}
