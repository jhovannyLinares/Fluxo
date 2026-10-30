import { parseUnified } from '@shared/diff'
import type { FileDiff } from '@shared/diff'
import { AppException } from '@shared/errors'
import { runGit } from './runner'

/** Contexto del modo «archivo completo»: más líneas que cualquier archivo que se pueda mostrar. */
const FULL_CONTEXT = 1_000_000

export interface DiffRequest {
  hash: string
  path: string
  /** ruta anterior si es un renombre o copia: entra en el pathspec para que -M lo detecte */
  oldPath?: string
  /** true = archivo completo (unificado y lado a lado); false = fragmentos con 3 líneas de contexto */
  full: boolean
  /** C17: ignora cambios en la cantidad de espacios, incluidos los del final de línea (`-b`) */
  ignoreSpace: boolean
  /** compara contra este commit o árbol en lugar del primer padre (fila con commits agrupados) */
  base?: string
}

/**
 * Diff de un archivo de un commit contra su primer padre (como el detalle, C18). Solo lectura.
 * `--no-ext-diff` y `--no-textconv`: un `diff.external` o un textconv en la config del repo no ejecutan comandos.
 */
export async function fileDiff(root: string, req: DiffRequest): Promise<FileDiff> {
  const parents = await runGit(['rev-list', '--parents', '-n', '1', req.hash, '--'], { cwd: root })
  if (parents.code !== 0) {
    throw new AppException({ code: 'GIT_FAILED', message: 'No se encontró ese commit.', gitOutput: parents.stderr.trim() })
  }
  const [hash, first] = parents.stdout.trim().split(' ')
  const from = req.base ?? first
  const range = from ? [from, hash!] : ['--root', hash!]
  const args = [
    'diff-tree',
    '-p',
    '-M',
    '--no-commit-id',
    '--no-ext-diff',
    '--no-textconv',
    `-U${req.full ? FULL_CONTEXT : 3}`,
    ...(req.ignoreSpace ? ['-b'] : []),
    ...range,
    '--',
    ...(req.oldPath ? [req.oldPath] : []),
    req.path
  ]
  const r = await runGit(args, { cwd: root, maxBytes: 64 * 1024 * 1024 })
  if (r.code !== 0) throw new AppException({ code: 'GIT_FAILED', message: 'No se pudo leer el diff.', gitOutput: r.stderr.trim() })
  return { path: req.path, oldPath: req.oldPath ?? null, ...parseUnified(r.stdout) }
}
