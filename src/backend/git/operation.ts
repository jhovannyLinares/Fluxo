import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Operation } from '@shared/operation'
import { runGitOk } from './runner'

type Kind = NonNullable<Operation>['kind']

/**
 * Marcas que git deja en el gitDir mientras dura cada operación. El rebase va primero: un rebase interactivo
 * también deja CHERRY_PICK_HEAD en cada paso con conflicto.
 */
const MARKERS: [string, Kind][] = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['BISECT_LOG', 'bisect']
]

/** gitDir absoluto del worktree (en un worktree vinculado no es `<raíz>/.git`). */
export async function gitDirOf(root: string): Promise<string> {
  return (await runGitOk(['rev-parse', '--absolute-git-dir'], { cwd: root })).trim()
}

/** H21: operación en curso y archivos en conflicto; solo lectura. Sin operación no lanza ningún proceso. */
export async function readOperation(root: string, gitDir: string): Promise<Operation> {
  const kind = MARKERS.find(([file]) => existsSync(join(gitDir, file)))?.[1]
  if (!kind) return null
  const out = await runGitOk(['diff', '--no-ext-diff', '--name-only', '--diff-filter=U', '-z'], { cwd: root })
  return { kind, conflicts: out.split('\0').filter(Boolean).length }
}
