import { z } from 'zod'

/** Panel de ramas (H16) con ahead/behind (H17). */
export const LocalBranchSchema = z.object({
  name: z.string(),
  ref: z.string(),
  hash: z.string(),
  /** rama de HEAD */
  current: z.boolean(),
  /** `origin/main`; null si no sigue a ninguna */
  upstream: z.string().nullable(),
  /** commits por subir / por bajar respecto al upstream (C7) */
  ahead: z.number().int(),
  behind: z.number().int(),
  /** el upstream se borró en el remoto */
  gone: z.boolean()
})
export const SimpleRefSchema = z.object({ name: z.string(), ref: z.string(), hash: z.string() })

/** Entrada del stash: `stash@{0}`, su commit y el mensaje. */
export const StashEntrySchema = z.object({ name: z.string(), hash: z.string(), message: z.string() })
/** Worktree del repo (sección WORKTREES); `current` = el que está abierto. */
export const WorktreeSchema = z.object({ path: z.string(), branch: z.string().nullable(), hash: z.string(), current: z.boolean(), locked: z.boolean().optional() })

export const SubmoduleSchema = z.object({
  name: z.string(),
  path: z.string(),
  url: z.string(),
  hash: z.string(),
  /** fecha ISO del commit que tiene sacado; null si no está inicializado */
  date: z.string().nullable().optional(),
  state: z.enum(['ok', 'uninitialized', 'outOfSync', 'conflict', 'uncommitted'])
})

export const RefsListSchema = z.object({
  local: z.array(LocalBranchSchema),
  remote: z.array(SimpleRefSchema),
  tags: z.array(SimpleRefSchema),
  stashes: z.array(StashEntrySchema),
  worktrees: z.array(WorktreeSchema),
  submodules: z.array(SubmoduleSchema)
})
export type RefsList = z.infer<typeof RefsListSchema>
export type StashEntry = z.infer<typeof StashEntrySchema>
export type Worktree = z.infer<typeof WorktreeSchema>
export type Submodule = z.infer<typeof SubmoduleSchema>
export type LocalBranch = z.infer<typeof LocalBranchSchema>
export type SimpleRef = z.infer<typeof SimpleRefSchema>

/** Nodo del árbol por prefijo (C6): `feature/login` cuelga de la carpeta `feature`. */
export interface RefTreeNode<T> {
  /** segmento de esta carpeta u hoja */
  label: string
  /** ruta completa de la carpeta (`claude/tareas`) */
  path: string
  item?: T
  children: RefTreeNode<T>[]
}

/**
 * Agrupa por los `/` del nombre (C6): los agentes crean muchas ramas `claude/…` y el árbol las junta.
 * Orden: carpetas primero, luego hojas, ambas alfabéticas sin distinguir mayúsculas.
 */
export function buildRefTree<T>(items: readonly T[], nameOf: (t: T) => string): RefTreeNode<T>[] {
  const root: RefTreeNode<T> = { label: '', path: '', children: [] }
  for (const item of items) {
    const parts = nameOf(item).split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/')
      let folder = node.children.find((c) => !c.item && c.path === path)
      if (!folder) {
        folder = { label: parts[i]!, path, children: [] }
        node.children.push(folder)
      }
      node = folder
    }
    node.children.push({ label: parts.at(-1)!, path: parts.join('/'), item, children: [] })
  }
  const sort = (nodes: RefTreeNode<T>[]) => {
    nodes.sort((a, b) => Number(!!a.item) - Number(!!b.item) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    nodes.forEach((n) => sort(n.children))
  }
  sort(root.children)
  return root.children
}

/** Filtro único del panel (C8): sin mayúsculas ni acentos, sobre el nombre completo. */
export function matchesRefFilter(name: string, query: string): boolean {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const q = fold(query.trim())
  return !q || fold(name).includes(q)
}
