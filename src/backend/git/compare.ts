import { parseUnified, type FileDiff } from '@shared/diff'
import type { FileChange } from '@shared/commit'
import { AppException } from '@shared/errors'
import { parseDiffTree } from './commit-detail'
import type { DiffRequest } from './diff'
import { runGit } from './runner'

/** Contexto del modo «archivo completo»: más líneas que cualquier archivo que se pueda mostrar. */
const FULL_CONTEXT = 1_000_000

/**
 * B2: archivos que cambiaron entre un commit y el directorio de trabajo (en stage y sin stage juntos), como
 * `git diff <commit>`; los archivos sin seguimiento no entran, igual que en git. B3: con `to`, entre dos commits
 * (`git diff <hash> <to>`). Solo lectura.
 */
export async function compareWorktree(root: string, hash: string, to?: string): Promise<FileChange[]> {
  const r = await runGit(['diff', '--raw', '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv', '--end-of-options', hash, ...(to ? [to] : [])], {
    cwd: root,
    maxBytes: 64 * 1024 * 1024
  })
  if (r.code !== 0) throw new AppException({ code: 'GIT_FAILED', message: 'No se pudo comparar el commit.', gitOutput: r.stderr.trim() })
  return parseDiffTree(r.stdout)
}

/** Diff de un archivo entre el commit y el directorio de trabajo (o `to`); mismos resguardos que el diff de un commit. */
export async function compareDiff(root: string, req: DiffRequest & { to?: string }): Promise<FileDiff> {
  const args = [
    'diff',
    '-M',
    '--no-ext-diff',
    '--no-textconv',
    `-U${req.full ? FULL_CONTEXT : 3}`,
    ...(req.ignoreSpace ? ['-b'] : []),
    '--end-of-options',
    req.hash,
    ...(req.to ? [req.to] : []),
    '--',
    ...(req.oldPath ? [req.oldPath] : []),
    req.path
  ]
  const r = await runGit(args, { cwd: root, maxBytes: 64 * 1024 * 1024 })
  if (r.code !== 0) throw new AppException({ code: 'GIT_FAILED', message: 'No se pudo leer el diff.', gitOutput: r.stderr.trim() })
  return { path: req.path, oldPath: req.oldPath ?? null, ...parseUnified(r.stdout) }
}
