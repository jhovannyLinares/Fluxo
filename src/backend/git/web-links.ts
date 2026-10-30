import { parseRemote, webUrl, type WebTarget } from '@shared/web-links'
import { runGit } from './runner'

const out = async (root: string, args: string[]) => {
  const r = await runGit(args, { cwd: root })
  return r.code === 0 ? r.stdout.trim() : ''
}

/**
 * Remoto y nombre de rama en él para una ref: `refs/remotes/origin/x` → (origin, x); una rama local → su upstream,
 * o `origin` con el mismo nombre si no tiene; un commit → el upstream de HEAD, o `origin`, o el primer remoto.
 */
async function remoteFor(root: string, ref: string | null): Promise<{ remote: string; name: string }> {
  const remotes = (await out(root, ['remote'])).split('\n').filter(Boolean)
  const fallback = remotes.includes('origin') ? 'origin' : (remotes[0] ?? '')
  if (ref?.startsWith('refs/remotes/')) {
    const rest = ref.slice('refs/remotes/'.length)
    const remote = remotes.filter((r) => rest.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0] ?? fallback
    return { remote, name: rest.slice(remote.length + 1) }
  }
  const head = ref ?? (await out(root, ['symbolic-ref', '-q', 'HEAD']))
  const local = head.startsWith('refs/heads/') ? head.slice('refs/heads/'.length) : null
  if (!local) return { remote: fallback, name: '' } // HEAD desacoplado
  const up = await out(root, ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:short)', '--end-of-options', `refs/heads/${local}`])
  const [upRemote, upShort] = up.split('\0')
  if (upRemote && upShort) return { remote: upRemote, name: upShort.slice(upRemote.length + 1) }
  return { remote: fallback, name: local }
}

/** H23: página web del commit, la rama o sus PR; null si no hay remoto o no es GitHub ni Azure DevOps. */
export async function webLink(root: string, target: WebTarget): Promise<string | null> {
  const { remote, name } = await remoteFor(root, target.kind === 'commit' ? null : target.ref)
  if (!remote) return null
  const parsed = parseRemote(await out(root, ['remote', 'get-url', '--end-of-options', remote]))
  if (!parsed) return null
  return webUrl(parsed, target.kind, target.kind === 'commit' ? target.hash : name)
}
