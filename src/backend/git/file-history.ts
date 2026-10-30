import { AppException } from '@shared/errors'
import type { BlameLine, FileHistoryEntry } from '@shared/file-history'
import { runGit } from './runner'

/** Cuántos archivos devuelve la búsqueda como máximo: la caja muestra los primeros. */
export const SEARCH_LIMIT = 200
/** Cuántos commits del historial se leen como máximo. */
export const HISTORY_LIMIT = 5000

const fail = (message: string, gitOutput: string) => new AppException({ code: 'GIT_FAILED', message, gitOutput: gitOutput.trim() })

/**
 * Archivos del repo (los de HEAD y los del índice) cuyo nombre o ruta contiene el texto, sin importar mayúsculas.
 * Primero los que tienen el texto en el nombre, después los que lo tienen en la carpeta.
 */
export async function searchFiles(root: string, query: string): Promise<string[]> {
  const r = await runGit(['ls-files', '-z'], { cwd: root, maxBytes: 64 * 1024 * 1024 })
  if (r.code !== 0) throw fail('No se pudo leer la lista de archivos.', r.stderr)
  const q = query.trim().toLowerCase()
  const all = r.stdout.split('\0').filter(Boolean)
  if (!q) return all.slice(0, SEARCH_LIMIT)
  const inName: string[] = []
  const inPath: string[] = []
  for (const p of all) {
    const lower = p.toLowerCase()
    if (lower.slice(lower.lastIndexOf('/') + 1).includes(q)) inName.push(p)
    else if (lower.includes(q)) inPath.push(p)
  }
  return [...inName, ...inPath].slice(0, SEARCH_LIMIT)
}

/** Lee la salida de `git log --follow --name-status -z` con el formato de `fileHistory`. */
export function parseFileLog(out: string): FileHistoryEntry[] {
  const entries: FileHistoryEntry[] = []
  for (const chunk of out.split('\x1e').slice(1)) {
    const [meta, ...rest] = chunk.split('\0')
    const [hash, author, email, date, subject] = meta!.split('\x1f')
    // tras el encabezado, git pone un NUL de más y un salto de línea; luego estado y rutas separados por NUL
    const t = rest.map((s) => s.replace(/^\n/, '')).filter(Boolean)
    const status = t[0]?.[0] as FileHistoryEntry['status'] | undefined
    if (!hash || !status) continue
    const renamed = status === 'R' || status === 'C'
    entries.push({
      hash,
      author: author!,
      email: email!,
      time: Date.parse(date!) / 1000,
      subject: subject!,
      status,
      path: renamed ? t[2]! : t[1]!,
      ...(renamed ? { oldPath: t[1]! } : {})
    })
  }
  return entries
}

/** Commits que tocaron el archivo, del más nuevo al más viejo, siguiendo renombres (`--follow`). Solo lectura. */
export async function fileHistory(root: string, path: string): Promise<FileHistoryEntry[]> {
  const r = await runGit(
    ['log', '--follow', '-M', `-n${HISTORY_LIMIT}`, '--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x00', '--name-status', '-z', 'HEAD', '--', path],
    { cwd: root, maxBytes: 64 * 1024 * 1024, timeoutMs: 120_000 }
  )
  if (r.code !== 0) throw fail('No se pudo leer el historial del archivo.', r.stderr)
  return parseFileLog(r.stdout)
}

/** Lee `git blame --porcelain`: el commit, el autor y la fecha de cada línea del archivo en HEAD. */
export function parseBlame(out: string): BlameLine[] {
  const info = new Map<string, { author: string; time: number; subject: string }>()
  const lines: BlameLine[] = []
  let hash = ''
  for (const row of out.split('\n')) {
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(row)
    if (head) {
      hash = head[1]!
      if (!info.has(hash)) info.set(hash, { author: '', time: 0, subject: '' })
    } else if (row.startsWith('\t')) {
      const i = info.get(hash)!
      lines.push({ hash, author: i.author, time: i.time, subject: i.subject, text: row.slice(1) })
    } else if (row.startsWith('author ')) info.get(hash)!.author = row.slice(7)
    else if (row.startsWith('author-time ')) info.get(hash)!.time = Number(row.slice(12))
    else if (row.startsWith('summary ')) info.get(hash)!.subject = row.slice(8)
  }
  return lines
}

/** Quién escribió cada línea del archivo en HEAD. `--no-textconv` para que la config del repo no ejecute comandos. */
export async function fileBlame(root: string, path: string): Promise<BlameLine[]> {
  const r = await runGit(['blame', '--porcelain', '--no-textconv', 'HEAD', '--', path], {
    cwd: root,
    maxBytes: 64 * 1024 * 1024,
    timeoutMs: 120_000
  })
  if (r.code !== 0) throw fail('No se pudo leer el blame del archivo.', r.stderr)
  return parseBlame(r.stdout)
}
