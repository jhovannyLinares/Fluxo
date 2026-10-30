import { z } from 'zod'

/**
 * Segmento de línea dentro de una fila del grafo.
 * kind 0: pasa de arriba a abajo en columna x1 (x1 === x2)
 * kind 1: entra desde arriba (x1) hasta centro del nodo (x2)
 * kind 2: sale del centro del nodo (x1) hacia abajo (x2)
 */
export const SegmentSchema = z.tuple([
  z.union([z.literal(0), z.literal(1), z.literal(2)]),
  z.number().int(),
  z.number().int(),
  z.number().int() // índice de color
])
export type Segment = z.infer<typeof SegmentSchema>

export const RefKindSchema = z.enum(['head', 'local', 'remote', 'tag', 'stash'])
export type RefKind = z.infer<typeof RefKindSchema>

export const RefLabelSchema = z.object({ name: z.string(), kind: RefKindSchema })
export type RefLabel = z.infer<typeof RefLabelSchema>

export const GraphRowSchema = z.object({
  hash: z.string(),
  parents: z.array(z.string()),
  author: z.string(),
  email: z.string(),
  time: z.number(), // epoch segundos
  subject: z.string(),
  /** commit con rastro de agente IA (trailer, email o nombre) */
  ai: z.boolean(),
  lane: z.number().int(),
  color: z.number().int(),
  segments: z.array(SegmentSchema),
  refs: z.array(RefLabelSchema),
  /** wip: cambios sin commit (fila sintética arriba de HEAD, H14) · stash: commit de un stash; ausente = commit normal */
  kind: z.enum(['wip', 'stash']).optional(),
  /** conteos de la fila WIP */
  wip: z.object({ staged: z.number().int(), unstaged: z.number().int(), untracked: z.number().int() }).optional(),
  /**
   * Con commits agrupados: la fila es la del más nuevo de una cadena del mismo autor y esconde `count` commits más.
   * `parents` son los padres del más viejo del grupo, por donde sigue la línea en el grafo; `parents` de la fila
   * siguen siendo los del commit que se muestra.
   */
  group: z.object({ count: z.number().int(), parents: z.array(z.string()) }).optional()
})
export type GraphRow = z.infer<typeof GraphRowSchema>

/** hash de la fila sintética de cambios sin commit (no es un sha real) */
export const WIP_HASH = 'WIP'

/** Qué ramas mostrar (H15). Las refs van con nombre completo (`refs/heads/x`, `refs/remotes/origin/x`). */
const FullRef = z.string().regex(/^(refs\/(heads|remotes|tags)\/|refs\/stash$)/).max(512)
export const GraphFilterSchema = z.object({
  /** all: todas menos las ocultas · current: HEAD, su upstream y la rama por defecto (C9) */
  mode: z.enum(['all', 'current']),
  hidden: z.array(FullRef).max(1000),
  /** A5: rama anclada al carril izquierdo */
  pinned: FullRef.nullable(),
  /** commits seguidos del mismo autor en una sola fila; ausente = sin agrupar */
  collapse: z.boolean().optional()
})
export type GraphFilter = z.infer<typeof GraphFilterSchema>
export const DEFAULT_FILTER: GraphFilter = { mode: 'all', hidden: [], pinned: null }
