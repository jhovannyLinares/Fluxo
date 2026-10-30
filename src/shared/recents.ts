import { z } from 'zod'

/**
 * Repos recientes (H08). Viven en main (userData/recents.json); el primero es el último abierto
 * y se reabre al arrancar.
 */
export const RECENTS_VERSION = 1
export const MAX_RECENTS = 10
/** fijados: van aparte y no cuentan para el tope de recientes */
export const MAX_PINNED = 20

export const RecentSchema = z.object({
  path: z.string().min(1).max(1024),
  name: z.string().min(1).max(256),
  /** milisegundos desde 1970 */
  openedAt: z.number().int().nonnegative(),
  /** fijado arriba en la pestaña nueva: abrir otros repos no lo saca de la lista */
  pinned: z.boolean().optional()
})
export type Recent = z.infer<typeof RecentSchema>

export const RecentsFileSchema = z.object({
  version: z.literal(RECENTS_VERSION),
  repos: z.array(RecentSchema).max(MAX_RECENTS + MAX_PINNED)
})

/** Tope por separado: `MAX_RECENTS` sin fijar (los más recientes) y `MAX_PINNED` fijados. */
function cap(list: readonly Recent[]): Recent[] {
  let free = 0
  let pins = 0
  return list.filter((r) => (r.pinned ? pins++ < MAX_PINNED : free++ < MAX_RECENTS))
}

/** Windows no distingue mayúsculas ni el tipo de barra: `C:\Repo` y `c:/repo/` son el mismo repo. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/** Pone el repo primero, sin duplicados, conservando si estaba fijado y con el tope de `cap`. */
export function addRecent(list: readonly Recent[], entry: Recent): Recent[] {
  const prev = list.find((r) => samePath(r.path, entry.path))
  return cap([prev?.pinned ? { ...entry, pinned: true } : entry, ...list.filter((r) => !samePath(r.path, entry.path))])
}

export function removeRecent(list: readonly Recent[], path: string): Recent[] {
  return list.filter((r) => !samePath(r.path, path))
}

/** Fija o desfija sin cambiar el orden; con `MAX_PINNED` ya fijados, no fija otro más. */
export function pinRecent(list: readonly Recent[], path: string, pinned: boolean): Recent[] {
  if (pinned && list.filter((r) => r.pinned).length >= MAX_PINNED) return [...list]
  return cap(
    list.map((r) => {
      if (!samePath(r.path, path)) return r
      const { pinned: _, ...rest } = r
      return pinned ? { ...rest, pinned: true } : rest
    })
  )
}

/** Contenido de disco → lista. JSON inválido u otra versión → lista vacía; una entrada dañada se descarta sola. */
export function parseRecents(raw: unknown): Recent[] {
  const file = z.object({ version: z.literal(RECENTS_VERSION), repos: z.array(z.unknown()) }).safeParse(raw)
  if (!file.success) return []
  const repos: Recent[] = []
  for (const r of file.data.repos) {
    const ok = RecentSchema.safeParse(r)
    if (ok.success && !repos.some((x) => samePath(x.path, ok.data.path))) repos.push(ok.data)
  }
  return cap(repos)
}
