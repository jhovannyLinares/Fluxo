import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webLink } from '../../src/backend/git/web-links'
import { commit, git, tempDir } from '../fixtures/make-repo'

/** H23 contra un repo real con remotos configurados (no se contacta ningún servidor). */
describe('abrir en la web (H23)', () => {
  const tmp = tempDir('cg-web-')
  const d = tmp.dir
  let head = ''

  beforeAll(() => {
    git(d, ['init', '-q', '-b', 'main'])
    commit(d, 'inicio')
    head = git(d, ['rev-parse', 'HEAD']).trim()
    git(d, ['remote', 'add', 'origin', 'https://x-access-token:secreto@github.com/hokeis/fluxo.git'])
    git(d, ['remote', 'add', 'azure', 'git@ssh.dev.azure.com:v3/empresa/Proyecto/app'])
    // rama local que sigue a una del remoto azure con otro nombre
    git(d, ['update-ref', 'refs/remotes/azure/feature/remota', head])
    git(d, ['branch', '-q', 'local-x', head])
    git(d, ['config', 'branch.local-x.remote', 'azure'])
    git(d, ['config', 'branch.local-x.merge', 'refs/heads/feature/remota'])
  })
  afterAll(() => tmp.cleanup())

  it('commit: remoto origin, sin el token en la URL', async () => {
    const url = await webLink(d, { kind: 'commit', hash: head })
    expect(url).toBe(`https://github.com/hokeis/fluxo/commit/${head}`)
  })

  it('rama local con upstream: su remoto y su nombre allá', async () => {
    expect(await webLink(d, { kind: 'branch', ref: 'refs/heads/local-x' })).toBe(
      'https://dev.azure.com/empresa/Proyecto/_git/app?version=GBfeature%2Fremota'
    )
    expect(await webLink(d, { kind: 'prs', ref: 'refs/heads/local-x' })).toBeNull() // PR de Azure: con la API (H22)
  })

  it('rama local sin upstream: origin con el mismo nombre; rama remota: su remoto', async () => {
    expect(await webLink(d, { kind: 'branch', ref: 'refs/heads/main' })).toBe('https://github.com/hokeis/fluxo/tree/main')
    expect(await webLink(d, { kind: 'prs', ref: 'refs/heads/main' })).toBe('https://github.com/hokeis/fluxo/pulls?q=is%3Apr%20head%3Amain')
    expect(await webLink(d, { kind: 'branch', ref: 'refs/remotes/azure/feature/remota' })).toBe(
      'https://dev.azure.com/empresa/Proyecto/_git/app?version=GBfeature%2Fremota'
    )
  })

  it('remoto de otro proveedor o sin remotos: null', async () => {
    const t2 = tempDir('cg-web2-')
    try {
      git(t2.dir, ['init', '-q', '-b', 'main'])
      commit(t2.dir, 'x')
      const h = git(t2.dir, ['rev-parse', 'HEAD']).trim()
      expect(await webLink(t2.dir, { kind: 'commit', hash: h })).toBeNull()
      git(t2.dir, ['remote', 'add', 'origin', 'https://gitlab.com/a/b.git'])
      expect(await webLink(t2.dir, { kind: 'commit', hash: h })).toBeNull()
    } finally {
      t2.cleanup()
    }
  })
})
