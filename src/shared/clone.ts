/**
 * Clonar por HTTPS (H09). Lógica pura compartida: la UI la usa para validar mientras se escribe
 * y el backend la vuelve a aplicar antes de lanzar git (doble extremo).
 */

export type CloneUrlProblem = 'empty' | 'notHttps' | 'credentials' | 'noName'

/** Solo https://, sin usuario ni token en la URL (git los guardaría en .git/config): las credenciales las pone GCM. */
export function checkCloneUrl(raw: string): CloneUrlProblem | null {
  const url = raw.trim()
  if (!url) return 'empty'
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'notHttps'
  }
  if (u.protocol !== 'https:' || !u.hostname) return 'notHttps'
  if (u.username || u.password) return 'credentials'
  if (!repoNameFromUrl(url)) return 'noName'
  return null
}

/**
 * Nombre de carpeta a partir de la URL: último segmento sin `.git`.
 * Sirve para GitHub (`/org/repo.git`) y Azure DevOps (`/org/proyecto/_git/repo`).
 * Caracteres que Windows no acepta en carpetas se cambian por `-`.
 */
export function repoNameFromUrl(raw: string): string | null {
  let path: string
  try {
    path = new URL(raw.trim()).pathname
  } catch {
    return null
  }
  const last = decodeURIComponent(path.replace(/\/+$/, '').split('/').pop() ?? '')
  const name = last
    .replace(/\.git$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/, '')
  if (!name || name === '_git' || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) return null
  return name
}

export interface CloneProgress {
  phase: string
  percent: number
}

/** Lee una línea de `git clone --progress` (p. ej. "Receiving objects:  45% (450/1000)"). */
export function parseCloneProgress(line: string): CloneProgress | null {
  const m = /(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files):\s+(\d+)%/.exec(line)
  return m ? { phase: m[1]!, percent: Number(m[2]) } : null
}
