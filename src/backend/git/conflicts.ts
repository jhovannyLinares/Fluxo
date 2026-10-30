import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { AppException } from '@shared/errors'
import { gitDirOf } from './operation'
import { runGit } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

export type ConflictSegment = { type: 'text'; lines: string[] } | { type: 'conflict'; ours: string[]; theirs: string[] }
export interface ConflictSide {
  /** nombre que git puso en la marca (`HEAD`, la rama que entra) */
  label: string
  commit: string | null
}
export interface ConflictFile {
  path: string
  eol: '\n' | '\r\n'
  finalNewline: boolean
  ours: ConflictSide
  theirs: ConflictSide
  segments: ConflictSegment[]
}

function inside(root: string, path: string): string {
  const abs = resolve(root, path)
  const rel = relative(resolve(root), abs)
  const parts = rel.split(sep)
  if (!rel || isAbsolute(rel) || parts.includes('..') || parts.some((p) => p.toLowerCase() === '.git')) {
    throw fail('Esa ruta no está dentro del repo.', 'Usa una ruta relativa a la raíz, sin «..» ni la carpeta .git.')
  }
  return parts.join('/')
}

/** Archivos con conflicto sin resolver (índice con etapas 1-3). */
export async function conflictPaths(root: string): Promise<string[]> {
  const r = await runGit(['diff', '--name-only', '--diff-filter=U', '-z', '--no-ext-diff'], { cwd: root })
  return r.stdout.split('\0').filter(Boolean)
}

async function shortOf(root: string, ref: string): Promise<string | null> {
  const r = await runGit(['rev-parse', '--short', '-q', '--verify', ref], { cwd: root })
  return r.code === 0 ? r.stdout.trim() || null : null
}

/** El commit que entra: MERGE_HEAD, REBASE_HEAD, CHERRY_PICK_HEAD o REVERT_HEAD según la operación. */
async function incomingCommit(root: string): Promise<string | null> {
  const gitDir = await gitDirOf(root)
  for (const f of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (existsSync(resolve(gitDir, f))) return shortOf(root, f)
  }
  return null
}

/**
 * Lee un archivo en conflicto como bloques: texto común y, en cada conflicto, el lado actual (A) y el que entra (B).
 * Entiende las marcas de git, también con la base (`|||||||`, diff3). Un archivo sin marcas (borrado en un lado,
 * binario) no se puede editar por bloques: se dice y quedan «Tomar actual / Tomar entrante».
 */
export async function readConflict(root: string, path: string): Promise<ConflictFile> {
  const rel = inside(root, path)
  if (!(await conflictPaths(root)).includes(rel)) throw fail(`${rel} no tiene conflicto.`, 'El panel se actualiza solo; vuelve a mirar la lista.')
  const text = await readFile(resolve(root, rel), 'utf8').catch(() => null)
  if (text === null || text.includes('\0')) {
    throw fail('Este archivo no se puede editar por bloques.', 'Usa «Tomar actual» o «Tomar entrante» para resolverlo entero.')
  }
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n'
  const finalNewline = /\n$/.test(text)
  const lines = text.split(/\r?\n/)
  if (finalNewline) lines.pop()

  const segments: ConflictSegment[] = []
  let plain: string[] = []
  let ours: string[] = []
  let theirs: string[] = []
  let mode: 'text' | 'ours' | 'base' | 'theirs' = 'text'
  let oursLabel = 'HEAD'
  let theirsLabel = ''
  for (const line of lines) {
    if (mode === 'text' && line.startsWith('<<<<<<< ')) {
      if (plain.length) segments.push({ type: 'text', lines: plain })
      plain = []
      ours = []
      theirs = []
      oursLabel = line.slice(8).trim() || 'HEAD'
      mode = 'ours'
    } else if ((mode === 'ours' || mode === 'base') && line.startsWith('||||||| ')) mode = 'base'
    else if ((mode === 'ours' || mode === 'base') && line === '=======') mode = 'theirs'
    else if (mode === 'theirs' && line.startsWith('>>>>>>> ')) {
      theirsLabel = line.slice(8).trim()
      segments.push({ type: 'conflict', ours, theirs })
      mode = 'text'
    } else if (mode === 'ours') ours.push(line)
    else if (mode === 'theirs') theirs.push(line)
    else if (mode === 'text') plain.push(line)
  }
  if (mode !== 'text') throw fail('Las marcas de conflicto están incompletas.', 'Edita el archivo a mano o usa «Tomar actual» / «Tomar entrante».')
  if (plain.length) segments.push({ type: 'text', lines: plain })
  if (!segments.some((s) => s.type === 'conflict')) {
    throw fail('Este archivo no tiene marcas de conflicto.', 'Usa «Tomar actual» o «Tomar entrante», o márcalo como resuelto.')
  }
  return {
    path: rel,
    eol,
    finalNewline,
    ours: { label: oursLabel, commit: await shortOf(root, 'HEAD') },
    theirs: { label: theirsLabel, commit: await incomingCommit(root) },
    segments
  }
}

/** Guarda el resultado elegido y lo deja en el stage: el archivo pasa a «resuelto». */
export async function saveConflict(root: string, path: string, content: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  const rel = inside(root, path)
  await writeFile(resolve(root, rel), content)
  const r = await runGit(['--literal-pathspecs', 'add', '--', rel], { cwd: root })
  if (r.code !== 0) throw fail('No se pudo marcar el archivo como resuelto.', 'Revisa la salida de git.', r.stderr.trim())
  return { ms: Math.round(performance.now() - t0) }
}

/** «Take current / Take incoming»: resuelve el archivo entero con un lado (A = `ours`, B = `theirs`). */
export async function takeSide(root: string, path: string, side: 'ours' | 'theirs'): Promise<{ ms: number }> {
  const t0 = performance.now()
  const rel = inside(root, path)
  const co = await runGit(['--literal-pathspecs', 'checkout', `--${side}`, '--', rel], { cwd: root })
  if (co.code !== 0) throw fail('Ese lado no tiene el archivo (se borró en esa rama).', 'Márcalo como resuelto o bórralo.', co.stderr.trim())
  const add = await runGit(['--literal-pathspecs', 'add', '--', rel], { cwd: root })
  if (add.code !== 0) throw fail('No se pudo marcar el archivo como resuelto.', 'Revisa la salida de git.', add.stderr.trim())
  return { ms: Math.round(performance.now() - t0) }
}

/** «Mark All Resolved»: lo que quede en conflicto pasa al stage tal como está en disco. */
export async function resolveAll(root: string): Promise<{ count: number }> {
  const paths = await conflictPaths(root)
  if (paths.length === 0) return { count: 0 }
  const r = await runGit(['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], { cwd: root, input: paths.join('\0') })
  if (r.code !== 0) throw fail('No se pudieron marcar como resueltos.', 'Revisa la salida de git.', r.stderr.trim())
  return { count: paths.length }
}
