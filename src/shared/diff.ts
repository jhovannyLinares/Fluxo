import { z } from 'zod'

/** Línea de un diff: ' ' contexto, '-' quitada, '+' añadida; números de línea en el archivo viejo y el nuevo. */
export const DiffLineSchema = z.object({
  t: z.enum([' ', '-', '+']),
  text: z.string(),
  old: z.number().int().nullable(),
  new: z.number().int().nullable()
})
export type DiffLine = z.infer<typeof DiffLineSchema>

export const HunkSchema = z.object({ header: z.string(), lines: z.array(DiffLineSchema) })
export type Hunk = z.infer<typeof HunkSchema>

/** Diff de un archivo (H19). `binary` y renombre sin cambios llevan mensaje propio en la UI (C15). */
export const FileDiffSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  binary: z.boolean(),
  hunks: z.array(HunkSchema)
})
export type FileDiff = z.infer<typeof FileDiffSchema>

/**
 * Salida de `git diff-tree -p` de un solo archivo: se saltan las cabeceras (`diff --git`, `index`, `---`, `+++`,
 * `similarity`, `rename`) hasta el primer `@@`; «Binary files … differ» marca binario.
 */
export function parseUnified(out: string): { binary: boolean; hunks: Hunk[] } {
  const hunks: Hunk[] = []
  let binary = false
  let cur: Hunk | null = null
  let o = 0
  let n = 0
  const rows = out.split('\n')
  if (rows.at(-1) === '') rows.pop()
  for (const row of rows) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(row)
    if (h) {
      cur = { header: row, lines: [] }
      hunks.push(cur)
      o = Number(h[1])
      n = Number(h[2])
      continue
    }
    if (!cur) {
      if (/^Binary files .* differ$/.test(row) || row === 'GIT binary patch') binary = true
      continue
    }
    const t = row[0]
    const text = row.slice(1)
    if (t === ' ') cur.lines.push({ t, text, old: o++, new: n++ })
    else if (t === '-') cur.lines.push({ t, text, old: o++, new: null })
    else if (t === '+') cur.lines.push({ t, text, old: null, new: n++ })
    // «\ No newline at end of file» y cualquier otra marca no son líneas del archivo
  }
  return { binary, hunks }
}

/** Fila del modo lado a lado: izquierda = archivo viejo, derecha = nuevo; null deja el hueco. */
export interface SideRow {
  left: DiffLine | null
  right: DiffLine | null
}

/** Empareja cada bloque de quitadas con las añadidas que lo siguen, línea a línea; el contexto va a ambos lados. */
export function sideBySide(lines: readonly DiffLine[]): SideRow[] {
  const rows: SideRow[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]!
    if (l.t === ' ') {
      rows.push({ left: l, right: l })
      i++
      continue
    }
    const del: DiffLine[] = []
    const add: DiffLine[] = []
    while (i < lines.length && lines[i]!.t === '-') del.push(lines[i++]!)
    while (i < lines.length && lines[i]!.t === '+') add.push(lines[i++]!)
    for (let k = 0; k < Math.max(del.length, add.length); k++) rows.push({ left: del[k] ?? null, right: add[k] ?? null })
  }
  return rows
}

/** Pares (quitada, añadida) que se comparan por palabra: la k-ésima quitada de un bloque con la k-ésima añadida. */
export function changePairs(lines: readonly DiffLine[]): Map<DiffLine, DiffLine> {
  const pairs = new Map<DiffLine, DiffLine>()
  for (const r of sideBySide(lines)) {
    if (r.left && r.right && r.left !== r.right) {
      pairs.set(r.left, r.right)
      pairs.set(r.right, r.left)
    }
  }
  return pairs
}

/** Tramo de una línea; `changed` = palabra que no está en la otra versión (C14). */
export interface Segment {
  text: string
  changed: boolean
}

const tokenize = (s: string) => s.match(/\w+|\s+|[^\w\s]/gu) ?? []

/** Por encima de esto no se resalta por palabra: la línea entera ya se ve cambiada. */
const MAX_TOKENS = 400

/**
 * Resaltado por palabra: subsecuencia común más larga entre los tokens de las dos versiones de una línea;
 * lo que no está en ella queda marcado. Devuelve los tramos de `a` (la línea que se pinta).
 */
export function wordSegments(a: string, b: string): Segment[] {
  const x = tokenize(a)
  const y = tokenize(b)
  if (x.length > MAX_TOKENS || y.length > MAX_TOKENS) return [{ text: a, changed: true }]
  // tabla de LCS por sufijos
  const w = y.length + 1
  const dp = new Uint16Array((x.length + 1) * w)
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!)
    }
  }
  const segs: Segment[] = []
  const push = (text: string, changed: boolean) => {
    const last = segs.at(-1)
    if (last && last.changed === changed) last.text += text
    else segs.push({ text, changed })
  }
  let i = 0
  let j = 0
  while (i < x.length) {
    if (j < y.length && x[i] === y[j]) {
      push(x[i]!, false)
      i++
      j++
    } else if (j < y.length && dp[i * w + j + 1]! >= dp[(i + 1) * w + j]!) j++
    else push(x[i++]!, true)
  }
  return segs
}

/** Índices donde empieza cada bloque de filas cambiadas: destinos de ↑ ↓ (C16). */
export function changeStarts(changed: readonly boolean[]): number[] {
  const out: number[] = []
  changed.forEach((c, i) => {
    if (c && (i === 0 || !changed[i - 1])) out.push(i)
  })
  return out
}
