import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

type Sm = { name: string; path: string; url: string; hash: string; state: string }

/** Submódulos (fase 5): lista con estado, agregar, inicializar y actualizar, contra repos git reales. */
describe('submódulos', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-sm-')
  let n = 0
  let d = ''
  let src = ''
  let repoId = ''
  const saved: Record<string, string | undefined> = {}
  // git bloquea por defecto submódulos por ruta local; las pruebas los usan para no depender de la red
  beforeAll(() => {
    for (const k of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) saved[k] = process.env[k]
    process.env.GIT_CONFIG_COUNT = '1'
    process.env.GIT_CONFIG_KEY_0 = 'protocol.file.allow'
    process.env.GIT_CONFIG_VALUE_0 = 'always'
  })
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    tmp.cleanup()
  })
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const subs = async () => {
    const r = await call('refs:list')
    return (r.ok ? (r.data as { submodules: Sm[] }).submodules : []) as Sm[]
  }
  const err = async (channel: string, payload: object) => {
    const r = await call(channel, payload)
    return r.ok ? '' : r.error.message
  }

  beforeEach(async () => {
    const id = n++
    src = join(tmp.dir, `src${id}`)
    d = join(tmp.dir, `padre${id}`)
    for (const dir of [src, d]) {
      mkdirSync(dir)
      git(dir, ['init', '-q', '-b', 'main'])
      git(dir, ['config', 'core.autocrlf', 'false'])
      writeFileSync(join(dir, 'a.txt'), 'a\n')
      git(dir, ['add', '-A'])
      git(dir, ['commit', '-q', '-m', 'inicio'])
    }
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)

  it('un repo sin .gitmodules no tiene submódulos', async () => {
    expect(await subs()).toEqual([])
  })

  it('agregar deja el submódulo en el índice y lo lista como agregado sin commit', async () => {
    const r = await call('submodule:add', { url: src, path: 'lib' })
    expect(r.ok).toBe(true)
    expect(existsSync(join(d, 'lib', 'a.txt'))).toBe(true)
    expect(git(d, ['status', '--short']).split('\n').sort().join('|')).toContain('A  .gitmodules')
    const list = await subs()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'lib', path: 'lib', state: 'uncommitted' })
    expect(list[0]!.url.replace(/\\/g, '/')).toBe(src.replace(/\\/g, '/'))
    expect(list[0]!.hash).toMatch(/^[0-9a-f]{7}$/)
  })

  it('con el commit hecho queda «ok»', async () => {
    await call('submodule:add', { url: src, path: 'lib' })
    git(d, ['commit', '-q', '-m', 'agrega lib'])
    expect((await subs())[0]!.state).toBe('ok')
  })

  it('sin inicializar → Initialize lo deja «ok»', async () => {
    await call('submodule:add', { url: src, path: 'lib' })
    git(d, ['commit', '-q', '-m', 'agrega lib'])
    git(d, ['submodule', 'deinit', '-q', '-f', 'lib'])
    expect((await subs())[0]!.state).toBe('uninitialized')
    expect((await call('submodule:update', { path: 'lib', init: true })).ok).toBe(true)
    expect((await subs())[0]!.state).toBe('ok')
    expect(existsSync(join(d, 'lib', 'a.txt'))).toBe(true)
  })

  it('un commit nuevo dentro del submódulo lo deja «desfasado» y Update lo devuelve al del padre', async () => {
    await call('submodule:add', { url: src, path: 'lib' })
    git(d, ['commit', '-q', '-m', 'agrega lib'])
    const lib = join(d, 'lib')
    writeFileSync(join(lib, 'b.txt'), 'b\n')
    git(lib, ['add', '-A'])
    git(lib, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'dentro'])
    expect((await subs())[0]!.state).toBe('outOfSync')
    expect((await call('submodule:update', { path: 'lib', init: false })).ok).toBe(true)
    expect((await subs())[0]!.state).toBe('ok')
    expect(existsSync(join(lib, 'b.txt'))).toBe(false)
  })

  it('guardar el puntero: tras un commit dentro del submódulo, stage lo deja «ok» y el padre registra el cambio', async () => {
    await call('submodule:add', { url: src, path: 'lib' })
    git(d, ['commit', '-q', '-m', 'agrega lib'])
    const lib = join(d, 'lib')
    writeFileSync(join(lib, 'b.txt'), 'b\n')
    git(lib, ['add', '-A'])
    git(lib, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'dentro'])
    expect((await subs())[0]!.state).toBe('outOfSync')
    expect((await call('wip:stage', { paths: ['lib'] })).ok).toBe(true)
    expect(git(d, ['diff', '--cached', '--submodule=short', '--', 'lib'])).toContain('Subproject commit')
    expect((await subs())[0]!.state).toBe('ok')
  })

  it('rechaza URLs que ejecutan comandos, rutas fuera del repo y carpetas que ya existen', async () => {
    expect(await err('submodule:add', { url: 'ext::sh -c touch x', path: 'lib' })).toMatch(/URL/i)
    expect(await err('submodule:add', { url: '', path: 'lib' })).toMatch(/URL/i)
    for (const path of ['', '../fuera', '/abs', 'C:\\abs', '-x', 'a/../../b', '.git/hooks']) {
      expect(await err('submodule:add', { url: src, path }), path).toMatch(/carpeta|ruta/i)
    }
    expect(await err('submodule:add', { url: src, path: 'a.txt' })).toMatch(/ya existe/i)
    expect(await subs()).toEqual([])
  })

  it('editar cambia la URL en .gitmodules y en la configuración, y mueve la carpeta si cambia la ruta', async () => {
    await call('submodule:add', { url: src, path: 'lib' })
    git(d, ['commit', '-q', '-m', 'agrega lib'])
    const otra = join(tmp.dir, `otra${n}`)
    mkdirSync(otra)
    git(otra, ['init', '-q', '-b', 'main'])
    const rr = await call('submodule:edit', { path: 'lib', url: otra, newPath: 'libs/nuevo' })
    expect(rr.ok ? '' : rr.error.message + ' ' + (rr.error.gitOutput ?? '')).toBe('')
    const list = await subs()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ path: 'libs/nuevo' })
    expect(list[0]!.url.replace(/\\/g, '/')).toBe(otra.replace(/\\/g, '/'))
    expect(existsSync(join(d, 'libs', 'nuevo', 'a.txt'))).toBe(true)
    expect(existsSync(join(d, 'lib'))).toBe(false)
    expect(git(d, ['config', '--get', 'submodule.lib.url']).replace(/\\/g, '/').trim()).toBe(otra.replace(/\\/g, '/'))
  })

  it('editar solo la URL deja la carpeta donde estaba', async () => {
    await call('submodule:add', { url: src, path: 'lib' })
    git(d, ['commit', '-q', '-m', 'agrega lib'])
    const otra = join(tmp.dir, `otra${n}`)
    mkdirSync(otra)
    expect((await call('submodule:edit', { path: 'lib', url: otra, newPath: 'lib' })).ok).toBe(true)
    expect(existsSync(join(d, 'lib', 'a.txt'))).toBe(true)
    expect((await subs())[0]!.url.replace(/\\/g, '/')).toBe(otra.replace(/\\/g, '/'))
  })

  it('editar rechaza URLs que ejecutan comandos y rutas inválidas o ya ocupadas', async () => {
    await call('submodule:add', { url: src, path: 'lib' })
    git(d, ['commit', '-q', '-m', 'agrega lib'])
    expect(await err('submodule:edit', { path: 'lib', url: 'ext::sh -c x', newPath: 'lib' })).toMatch(/URL/i)
    expect(await err('submodule:edit', { path: 'lib', url: src, newPath: '../fuera' })).toMatch(/ruta/i)
    expect(await err('submodule:edit', { path: 'lib', url: src, newPath: 'a.txt' })).toMatch(/ya existe/i)
    expect(await err('submodule:edit', { path: 'nada', url: src, newPath: 'nada' })).toMatch(/no es un submódulo/i)
  })

  it('borrar quita la carpeta, la entrada de .gitmodules y la lista', async () => {
    await call('submodule:add', { url: src, path: 'lib' })
    git(d, ['commit', '-q', '-m', 'agrega lib'])
    expect((await call('submodule:delete', { path: 'lib' })).ok).toBe(true)
    expect(existsSync(join(d, 'lib'))).toBe(false)
    expect(await subs()).toEqual([])
    expect(git(d, ['status', '--short'])).toContain('D  lib')
    expect(await err('submodule:delete', { path: 'lib' })).toMatch(/no es un submódulo/i)
  })

  it('actualizar una ruta que no es un submódulo se rechaza', async () => {
    expect(await err('submodule:update', { path: 'a.txt', init: false })).toMatch(/no es un submódulo/i)
  })
})
