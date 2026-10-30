import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AppException } from '@shared/errors'
import { runGit, runGitOk } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

/** Ruta relativa a la raíz y con «/», o error si sale del repo o entra a `.git`. */
function inside(root: string, path: string): { rel: string; abs: string } {
  const abs = resolve(root, path)
  const rel = relative(resolve(root), abs)
  const parts = rel.split(sep)
  if (!rel || isAbsolute(rel) || parts.includes('..') || parts.some((p) => p.toLowerCase() === '.git')) {
    throw fail('Esa ruta no está dentro del repo.', 'Usa una ruta relativa a la raíz, sin «..» ni la carpeta .git.')
  }
  return { rel: parts.join('/'), abs }
}

const nulPaths = (paths: string[]) => ({ args: ['--pathspec-from-file=-', '--pathspec-file-nul'], input: paths.join('\0') })

const hasHead = async (root: string) => (await runGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: root })).code === 0

/**
 * Descarta cambios (permanente; la confirmación es de la UI). Archivos versionados vuelven a HEAD, también lo que
 * estaba en stage; los nuevos se sacan del index y se borran. Sin `paths`, todo. Con `patch`, solo ese bloque del
 * árbol de trabajo (`git apply -R`).
 */
export async function discard(root: string, paths?: string[], patch?: string): Promise<void> {
  if (patch) {
    const r = await runGit(['apply', '-R', '--recount', '--whitespace=nowarn', '-'], { cwd: root, input: patch })
    if (r.code !== 0) throw fail('No se pudo descartar ese bloque.', 'El archivo cambió desde que se abrió el diff; ábrelo de nuevo.', r.stderr.trim())
    return
  }
  const head = await hasHead(root)
  if (!paths) {
    if (head) await runGitOk(['reset', '--hard', '-q'], { cwd: root })
    else await runGit(['rm', '-r', '-f', '-q', '--cached', '--ignore-unmatch', '.'], { cwd: root })
    await runGitOk(['clean', '-f', '-d', '-q'], { cwd: root })
    return
  }
  const rels = paths.map((p) => inside(root, p).rel)
  const known = new Set(head ? (await runGitOk(['ls-tree', '-r', '-z', '--name-only', 'HEAD'], { cwd: root })).split('\0') : [])
  const versioned = rels.filter((p) => known.has(p))
  const fresh = rels.filter((p) => !known.has(p))
  if (versioned.length) {
    const spec = nulPaths(versioned)
    const r = await runGit(['--literal-pathspecs', 'restore', '--source=HEAD', '--staged', '--worktree', ...spec.args], { cwd: root, input: spec.input })
    if (r.code !== 0) throw fail('No se pudieron descartar los cambios.', 'Revisa la salida de git.', r.stderr.trim())
  }
  if (fresh.length) {
    const spec = nulPaths(fresh)
    await runGit(['--literal-pathspecs', 'rm', '-f', '-q', '--cached', '--ignore-unmatch', ...spec.args], { cwd: root, input: spec.input })
    for (const p of fresh) await rm(inside(root, p).abs, { force: true, recursive: true })
  }
}

/** Stage (o unstage con `reverse`) de un bloque o de líneas sueltas, a partir de un patch en forma de diff. */
export async function stagePatch(root: string, patch: string, reverse: boolean): Promise<void> {
  const r = await runGit(['apply', '--cached', ...(reverse ? ['-R'] : []), '--recount', '--whitespace=nowarn', '-'], { cwd: root, input: patch })
  if (r.code !== 0) {
    throw fail('No se pudo aplicar ese bloque al stage.', 'El archivo cambió desde que se abrió el diff; ábrelo de nuevo.', r.stderr.trim())
  }
}

/** Agrega la regla al `.gitignore` de la raíz sin duplicarla; con `stopTracking` también saca el archivo del index. */
export async function ignore(root: string, pattern: string, stopTracking?: boolean): Promise<{ added: boolean }> {
  if (/[\r\n\0]/.test(pattern)) throw fail('La regla no puede tener saltos de línea.', 'Escribe una regla por vez.')
  const file = join(root, '.gitignore')
  const current = existsSync(file) ? await readFile(file, 'utf8') : ''
  const added = !current.split(/\r?\n/).some((l) => l.trim() === pattern)
  if (added) {
    const eol = current.includes('\r\n') ? '\r\n' : '\n'
    await writeFile(file, `${current}${current && !/\n$/.test(current) ? eol : ''}${pattern}${eol}`)
  }
  if (stopTracking) {
    const path = inside(root, pattern.replace(/^\//, '')).rel
    const r = await runGit(['--literal-pathspecs', 'rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', path], { cwd: root })
    if (r.code !== 0) throw fail('No se pudo dejar de versionar el archivo.', 'Revisa la salida de git.', r.stderr.trim())
  }
  return { added }
}

/** Crea un archivo vacío; las carpetas de la ruta se crean. No pisa uno existente. */
export async function createFile(root: string, path: string): Promise<{ path: string }> {
  const { rel, abs } = inside(root, path)
  try {
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, '', { flag: 'wx' })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw fail('Ya existe un archivo con ese nombre.', 'Elige otro nombre.')
    if (code === 'ENOTDIR') throw fail('Una parte de la ruta es un archivo, no una carpeta.', 'Cambia el nombre de la carpeta.')
    throw fail('No se pudo crear el archivo.', 'Revisa que el nombre sea válido.', String(e))
  }
  return { path: rel }
}

/** Borra un archivo del árbol de trabajo. */
export async function deleteFile(root: string, path: string): Promise<void> {
  const { abs } = inside(root, path)
  await rm(abs, { force: true })
}
