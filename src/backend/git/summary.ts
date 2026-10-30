import { existsSync } from 'node:fs'
import type { RepoSummary } from '@shared/summary'
import { runGit } from './runner'

/**
 * Resumen de un repo para la gestión de repositorios: rama, ↑↓ con su upstream y
 * cambios sin commit (✎ modificados, + nuevos). Un solo `git status`, solo lectura (GIT_OPTIONAL_LOCKS=0).
 * null si la carpeta ya no existe o no es un repo.
 */
export async function repoSummary(path: string): Promise<RepoSummary | null> {
  if (!existsSync(path)) return null
  const r = await runGit(['status', '--porcelain=v1', '--branch', '-z', '--untracked-files=normal'], { cwd: path, timeoutMs: 20_000 })
  if (r.code !== 0) return null
  const [head = '', ...entries] = r.stdout.split('\0').filter(Boolean)
  // «## main...origin/main [ahead 1, behind 2]» · «## HEAD (no branch)» · «## No commits yet on main»
  const m = /^## (?:No commits yet on )?(.+?)(?:\.\.\.\S+)?(?: \[(.*)\])?$/.exec(head)
  const name = m?.[1] ?? null
  const track = m?.[2] ?? ''
  let modified = 0
  let added = 0
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!
    if (e.startsWith('??') || e[0] === 'A') added++
    else modified++
    // en un renombre o copia la ruta de origen llega como el token siguiente
    if (e[0] === 'R' || e[0] === 'C') i++
  }
  return {
    branch: name === 'HEAD (no branch)' ? null : name,
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
    modified,
    added
  }
}
