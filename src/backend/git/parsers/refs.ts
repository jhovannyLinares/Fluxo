import type { RefKind, RefLabel } from '@shared/graph-types'

/** `for-each-ref` con hash del objeto y hash "pelado" (tags anotados apuntan a commit). */
export const REFS_FORMAT = '%(objectname)%00%(*objectname)%00%(refname)'

export function parseRefs(output: string, headRef: string | null, headHash: string | null): Map<string, RefLabel[]> {
  const map = new Map<string, RefLabel[]>()
  const add = (hash: string, label: RefLabel) => {
    const list = map.get(hash)
    if (list) list.push(label)
    else map.set(hash, [label])
  }

  for (const line of output.split('\n')) {
    if (!line) continue
    const [obj, peeled, ref] = line.split('\0')
    if (!obj || !ref) continue
    const hash = peeled || obj
    let kind: RefKind
    let name: string
    if (ref.startsWith('refs/heads/')) {
      kind = 'local'
      name = ref.slice('refs/heads/'.length)
    } else if (ref.startsWith('refs/remotes/')) {
      name = ref.slice('refs/remotes/'.length)
      if (name.endsWith('/HEAD')) continue
      kind = 'remote'
    } else if (ref.startsWith('refs/tags/')) {
      kind = 'tag'
      name = ref.slice('refs/tags/'.length)
    } else if (ref === 'refs/stash') {
      kind = 'stash'
      name = 'stash'
    } else continue
    add(hash, { name, kind })
  }

  // HEAD primero en su commit; HEAD desacoplado se muestra con su hash corto
  if (headHash) {
    const list = map.get(headHash) ?? []
    const branch = headRef?.startsWith('refs/heads/') ? headRef.slice('refs/heads/'.length) : null
    list.sort((a, b) => Number(b.name === branch && b.kind === 'local') - Number(a.name === branch && a.kind === 'local'))
    list.unshift({ name: branch ? 'HEAD' : `HEAD (${headHash.slice(0, 7)})`, kind: 'head' })
    map.set(headHash, list)
  }
  return map
}
