import { parseUnified } from '@shared/diff'
import type { FileDiff } from '@shared/diff'
import type { FileChange } from '@shared/commit'
import type { WipArea, WipFiles } from '@shared/wip'
import { AppException } from '@shared/errors'
import { parseDiffTree } from './commit-detail'
import { conflictPaths } from './conflicts'
import { runGit, runGitOk } from './runner'

const FULL_CONTEXT = 1_000_000

/**
 * Cambios sin commit (fila WIP): en stage (`diff --cached`), sin stage (`diff`) y nuevos sin
 * seguimiento (`ls-files --others`, respeta .gitignore). Solo lectura: GIT_OPTIONAL_LOCKS=0 en runner, ni el
 * refresco del index se escribe.
 */
export async function wipFiles(root: string): Promise<WipFiles> {
  const diff = (extra: string[]) =>
    runGitOk(['diff', ...extra, '-z', '-M', '--raw', '--numstat', '--no-ext-diff', '--no-textconv'], { cwd: root }).then(parseDiffTree)
  const [staged, unstaged, others, conflicts] = await Promise.all([
    diff(['--cached']),
    diff([]),
    runGitOk(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }),
    conflictPaths(root)
  ])
  const inConflict = new Set(conflicts)
  const conflicted: FileChange[] = conflicts.map((path) => ({ status: 'U', path, additions: 0, deletions: 0, binary: false }))
  const untracked: FileChange[] = others
    .split('\0')
    .filter(Boolean)
    .map((path) => ({ status: 'A', path, additions: 0, deletions: 0, binary: false, untracked: true }))
  return {
    staged: staged.filter((f) => !inConflict.has(f.path)),
    unstaged: [...unstaged.filter((f) => !inConflict.has(f.path)), ...untracked],
    conflicted
  }
}

export interface WipDiffRequest {
  path: string
  oldPath?: string
  area: WipArea
  full: boolean
  ignoreSpace: boolean
}

/** Diff de un archivo sin commit: contra HEAD en stage, contra el index sin stage, contra nada si es nuevo. */
export async function wipDiff(root: string, req: WipDiffRequest): Promise<FileDiff> {
  const common = ['--no-ext-diff', '--no-textconv', `-U${req.full ? FULL_CONTEXT : 3}`, ...(req.ignoreSpace ? ['-b'] : [])]
  const args =
    req.area === 'untracked'
      ? ['diff', '--no-index', ...common, '--', '/dev/null', req.path]
      : ['diff', ...(req.area === 'staged' ? ['--cached'] : []), '-M', ...common, '--', ...(req.oldPath ? [req.oldPath] : []), req.path]
  const r = await runGit(args, { cwd: root, maxBytes: 64 * 1024 * 1024 })
  // --no-index sale con 1 cuando hay diferencias
  if (r.code !== 0 && !(req.area === 'untracked' && r.code === 1)) {
    throw new AppException({ code: 'GIT_FAILED', message: 'No se pudo leer el diff.', gitOutput: r.stderr.trim() })
  }
  return { path: req.path, oldPath: req.oldPath ?? null, ...parseUnified(r.stdout) }
}
