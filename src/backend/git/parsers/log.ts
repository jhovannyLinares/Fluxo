/** Separadores de control: no aparecen en nombres, emails ni asuntos normales. */
export const FS = '\x1f'
export const RS = '\x1e'

/**
 * Formato de `git log`. Campo 7: trailers Co-authored-by (para detectar agentes, 1.10).
 * Campos separados por 0x1f, registros terminados en 0x1e.
 */
export const LOG_FORMAT = [
  '%H',
  '%P',
  '%an',
  '%ae',
  '%at',
  '%s',
  '%(trailers:key=Co-authored-by,valueonly,separator=%x2C)'
].join('%x1f') + '%x1e'

export interface RawCommit {
  hash: string
  parents: string[]
  author: string
  email: string
  time: number
  subject: string
  coAuthors: string
}

export function parseLog(output: string): RawCommit[] {
  const commits: RawCommit[] = []
  let start = 0
  const len = output.length
  while (start < len) {
    let end = output.indexOf(RS, start)
    if (end === -1) end = len
    // git agrega salto de línea entre registros; se recorta al inicio
    let rec = output.slice(start, end)
    if (rec.charCodeAt(0) === 10) rec = rec.slice(1)
    start = end + 1
    if (rec.length === 0) continue
    const f = rec.split(FS)
    const hash = f[0]
    if (!hash || hash.length < 7) continue
    commits.push({
      hash,
      parents: f[1] ? f[1].split(' ').filter(Boolean) : [],
      author: f[2] ?? '',
      email: f[3] ?? '',
      time: Number(f[4] ?? 0),
      subject: f[5] ?? '',
      coAuthors: (f[6] ?? '').trim()
    })
  }
  return commits
}

/** Patrones de agentes conocidos; ampliable desde preferencias (1.10). */
const AI_PATTERN = /\b(claude|anthropic|copilot|cursor|codex|gemini|devin|aider|openhands)\b|\[bot\]/i

export function isAiCommit(c: Pick<RawCommit, 'author' | 'email' | 'coAuthors'>): boolean {
  return AI_PATTERN.test(c.coAuthors) || AI_PATTERN.test(c.author) || AI_PATTERN.test(c.email)
}
