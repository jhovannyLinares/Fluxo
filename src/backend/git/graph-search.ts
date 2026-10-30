import type { GraphRow } from '@shared/graph-types'
import { AppException } from '@shared/errors'
import { indexOf } from './navigate'
import { runGit } from './runner'

/** Prefijos para buscar por archivo en lugar de por mensaje, autor o SHA. */
const FILE_PREFIX = /^(archivo|file):\s*/i

/** Escapa los comodines de un pathspec glob: el texto se busca tal cual. */
const globLiteral = (s: string) => s.replace(/[*?[\]\\]/g, (c) => `\\${c}`)

/**
 * A2: filas del grafo cargado que coinciden con la búsqueda, en el orden del grafo.
 * - Texto suelto: asunto, autor, correo o SHA (en memoria) y el cuerpo del mensaje (`git log --grep`, una sola
 *   llamada), sin distinguir mayúsculas.
 * - `archivo:<texto>` o `file:<texto>`: commits que tocaron una ruta que contiene el texto (`git log -- <pathspec>`).
 */
export async function searchGraph(root: string, rows: GraphRow[], query: string): Promise<number[]> {
  const q = query.trim()
  if (!q) return []
  const file = FILE_PREFIX.exec(q)
  const hits = new Set<number>()
  if (file) {
    const text = q.slice(file[0].length)
    if (!text) return []
    const r = await runGit(['log', '--all', '--format=%H', '--', `:(icase,glob)**/*${globLiteral(text)}*`], {
      cwd: root,
      maxBytes: 64 * 1024 * 1024,
      timeoutMs: 120_000
    })
    if (r.code !== 0) throw new AppException({ code: 'GIT_FAILED', message: 'No se pudo buscar por archivo.', gitOutput: r.stderr.trim() })
    for (const h of r.stdout.split('\n')) {
      const i = h ? indexOf(rows, h) : null
      if (i !== null) hits.add(i)
    }
  } else {
    const lower = q.toLowerCase()
    rows.forEach((row, i) => {
      if (row.kind === 'wip') return
      if (
        row.subject.toLowerCase().includes(lower) ||
        row.author.toLowerCase().includes(lower) ||
        row.email.toLowerCase().includes(lower) ||
        row.hash.startsWith(lower)
      ) {
        hits.add(i)
      }
    })
    // el cuerpo del mensaje no está en las filas: lo busca git
    const r = await runGit(['log', '--all', '--format=%H', '-i', '-F', `--grep=${q}`], { cwd: root, maxBytes: 64 * 1024 * 1024, timeoutMs: 120_000 })
    if (r.code === 0) {
      for (const h of r.stdout.split('\n')) {
        const i = h ? indexOf(rows, h) : null
        if (i !== null) hits.add(i)
      }
    }
  }
  return [...hits].sort((a, b) => a - b)
}
