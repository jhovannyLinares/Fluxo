import type { DiffLine, Hunk } from './diff'

/**
 * Patch para `git apply` de un bloque del diff, o solo de las líneas elegidas (`selected`).
 * Las líneas sin elegir no cambian el archivo: hacia adelante (stage) las añadidas se omiten y las quitadas quedan
 * como contexto; en reversa (unstage o descartar, con `git apply -R`) las añadidas quedan como contexto y las
 * quitadas se omiten. Sin ninguna línea de cambio devuelve null. Los conteos del encabezado los rehace
 * `git apply --recount`; aquí solo importa la posición donde empieza el bloque.
 */
export function hunkPatch(hunk: Hunk, opts: { selected?: ReadonlySet<DiffLine>; reverse: boolean }): string | null {
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(hunk.header)
  if (!m) return null
  const body: string[] = []
  let changes = 0
  for (const l of hunk.lines) {
    const picked = !opts.selected || opts.selected.has(l)
    if (l.t === ' ') body.push(` ${l.text}`)
    else if (picked) {
      body.push(`${l.t}${l.text}`)
      changes++
    } else if (l.t === '+') {
      if (opts.reverse) body.push(` ${l.text}`)
    } else if (!opts.reverse) body.push(` ${l.text}`)
  }
  if (changes === 0) return null
  return `@@ -${m[1]} +${m[2]} @@\n${body.join('\n')}\n`
}

/** Cabecera mínima del patch de un archivo modificado; los bloques van detrás. */
export function filePatch(path: string, hunkPatches: readonly string[]): string {
  return `--- a/${path}\n+++ b/${path}\n${hunkPatches.join('')}`
}
