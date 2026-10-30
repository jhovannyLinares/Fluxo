import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

type Remote = { name: string; pullUrl: string; pushUrl: string | null }

/** Agregar, editar, quitar y traer un remoto, contra repos git reales. */
describe('remotos', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-rm-')
  let n = 0
  let d = ''
  let bare = ''
  let repoId = ''
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const list = async () => {
    const r = await call('repo:remotes')
    return (r.ok ? (r.data as { remotes: Remote[] }).remotes : []) as Remote[]
  }

  beforeEach(async () => {
    const id = n++
    d = join(tmp.dir, `caso${id}`)
    bare = join(tmp.dir, `bare${id}.git`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    writeFileSync(join(d, 'a.txt'), 'a\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'inicio'])
    git(tmp.dir, ['init', '-q', '--bare', '-b', 'main', bare])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('agrega un remoto con su URL y lo lista', async () => {
    expect((await call('remote:add', { name: 'origin', pullUrl: bare })).ok).toBe(true)
    expect(await list()).toEqual([{ name: 'origin', pullUrl: bare, pushUrl: null }])
  })

  it('con una URL de push distinta se guarda aparte', async () => {
    await call('remote:add', { name: 'origin', pullUrl: bare, pushUrl: `${bare}-push` })
    expect((await list())[0]).toEqual({ name: 'origin', pullUrl: bare, pushUrl: `${bare}-push` })
  })

  it('rechaza un nombre repetido, uno inválido y URLs que ejecutarían comandos', async () => {
    await call('remote:add', { name: 'origin', pullUrl: bare })
    const dup = await call('remote:add', { name: 'origin', pullUrl: bare })
    expect(!dup.ok && dup.error.message).toMatch(/ya existe/)
    expect((await call('remote:add', { name: 'con espacio', pullUrl: bare })).ok).toBe(false)
    expect((await call('remote:add', { name: '-f', pullUrl: bare })).ok).toBe(false)
    for (const url of ['ext::sh -c touch pwned', '--upload-pack=x', 'fd::17', '']) {
      expect((await call('remote:add', { name: 'malo', pullUrl: url })).ok, url).toBe(false)
    }
    expect((await list()).map((r) => r.name)).toEqual(['origin'])
  })

  it('Edit cambia el nombre y las URL conservando el resto de la configuración', async () => {
    await call('remote:add', { name: 'origin', pullUrl: bare })
    const otro = join(tmp.dir, 'otro.git')
    git(tmp.dir, ['init', '-q', '--bare', otro])
    expect((await call('remote:edit', { name: 'origin', newName: 'upstream', pullUrl: otro, pushUrl: bare })).ok).toBe(true)
    expect(await list()).toEqual([{ name: 'upstream', pullUrl: otro, pushUrl: bare }])
  })

  it('Edit sin URL de push la quita', async () => {
    await call('remote:add', { name: 'origin', pullUrl: bare, pushUrl: `${bare}-x` })
    await call('remote:edit', { name: 'origin', newName: 'origin', pullUrl: bare, pushUrl: null })
    expect((await list())[0]!.pushUrl).toBeNull()
  })

  it('Edit de un remoto que ya no existe se dice', async () => {
    const r = await call('remote:edit', { name: 'fantasma', newName: 'x', pullUrl: bare, pushUrl: null })
    expect(!r.ok && r.error.message).toMatch(/ya no existe/)
  })

  it('Remove quita el remoto y sus ramas de seguimiento', async () => {
    await call('remote:add', { name: 'origin', pullUrl: bare })
    git(d, ['push', '-q', 'origin', 'main'])
    git(d, ['fetch', '-q', 'origin'])
    expect(git(d, ['branch', '-r']).trim()).toContain('origin/main')
    expect((await call('remote:remove', { name: 'origin' })).ok).toBe(true)
    expect(await list()).toEqual([])
    expect(git(d, ['branch', '-r']).trim()).toBe('')
  })

  it('Fetch de un remoto trae sus ramas', async () => {
    await call('remote:add', { name: 'origin', pullUrl: bare })
    git(d, ['push', '-q', 'origin', 'main'])
    git(d, ['update-ref', '-d', 'refs/remotes/origin/main'])
    expect((await call('remote:fetch', { name: 'origin' })).ok).toBe(true)
    expect(git(d, ['branch', '-r']).trim()).toContain('origin/main')
  })
})
