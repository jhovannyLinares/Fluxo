import type { RefsList } from '@shared/refs'
import { runGitOk } from './runner'
import { listSubmodules } from './submodules'

const SEP = '%00'
/** ref · commit (pelado si es tag anotado) · upstream · «ahead N, behind M» o «gone» · `*` si es HEAD */
const FORMAT = ['%(refname)', '%(objectname)', '%(*objectname)', '%(upstream)', '%(upstream:track,nobracket)', '%(HEAD)'].join(SEP)

/** «ahead 2, behind 1» → { ahead: 2, behind: 1 }; «gone» = el upstream ya no existe en el remoto. */
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  return {
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
    gone: track.trim() === 'gone'
  }
}

/**
 * Ramas, remotas, tags y stash para el panel de ramas (H16) con ahead/behind (H17, C7),
 * en un solo `for-each-ref`: git calcula el seguimiento sin procesos extra.
 */
export async function listRefs(root: string): Promise<RefsList> {
  const [out, stash, worktrees] = await Promise.all([
    runGitOk(['for-each-ref', `--format=${FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags'], { cwd: root }),
    runGitOk(['for-each-ref', '--format=%(refname)', 'refs/stash'], { cwd: root }),
    runGitOk(['worktree', 'list', '--porcelain'], { cwd: root })
  ])
  const list: RefsList = { local: [], remote: [], tags: [], stashes: [], worktrees: parseWorktrees(worktrees, root), submodules: await listSubmodules(root) }
  for (const line of out.split('\n')) {
    if (!line) continue
    const [ref = '', obj = '', peeled = '', upstream = '', track = '', head = ''] = line.split('\0')
    const hash = peeled || obj
    if (ref.startsWith('refs/heads/')) {
      list.local.push({
        name: ref.slice('refs/heads/'.length),
        ref,
        hash,
        current: head.trim() === '*',
        upstream: upstream ? upstream.replace(/^refs\/remotes\//, '') : null,
        ...parseTrack(track)
      })
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length)
      if (!name.endsWith('/HEAD')) list.remote.push({ name, ref, hash })
    } else if (ref.startsWith('refs/tags/')) {
      list.tags.push({ name: ref.slice('refs/tags/'.length), ref, hash })
    }
  }
  if (stash.trim()) {
    // entradas del stash: el reflog de refs/stash (stash@{N}, commit y mensaje)
    const log = await runGitOk(['log', '-g', '--format=%gd%x00%H%x00%gs', 'refs/stash', '--'], { cwd: root })
    list.stashes = log
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name = '', hash = '', message = ''] = l.split('\0')
        return { name, hash, message }
      })
  }
  return list
}

const samePath = (a: string, b: string) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** `git worktree list --porcelain`: bloques «worktree <ruta>», «HEAD <sha>», «branch <ref>» o «detached»; los bare no cuentan. */
export function parseWorktrees(out: string, root: string): RefsList['worktrees'] {
  return out
    .split(/\n\n+/)
    .map((block) => Object.fromEntries(block.split('\n').filter(Boolean).map((l) => [l.split(' ')[0]!, l.slice(l.indexOf(' ') + 1)])) as Record<string, string>)
    .filter((b) => b.worktree && !('bare' in b))
    .map((b) => ({
      path: b.worktree!,
      branch: b.branch ? b.branch.replace(/^refs\/heads\//, '') : null,
      hash: b.HEAD ?? '',
      current: samePath(b.worktree!, root),
      locked: 'locked' in b
    }))
}
