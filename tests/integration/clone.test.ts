import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CloneProgress } from '../../src/shared/clone'
import { cloneInto, targetFolder } from '../../src/backend/git/clone'
import { dispatch } from '../../src/backend/handlers'
import { git, makeLargeRepo, tempDir } from '../fixtures/make-repo'

/** H09 contra un remoto local por file:// (mismo transporte con progreso que HTTPS, sin red). */
describe('clonar (H09)', () => {
  const tmp = tempDir('cg-clone-')
  const source = join(tmp.dir, 'origen')
  const parent = join(tmp.dir, 'destino con espacios')
  beforeAll(() => {
    mkdirSync(source)
    makeLargeRepo(source, 400, 5)
    mkdirSync(parent)
  })
  afterAll(() => tmp.cleanup())

  it('clona, informa progreso y deja un repo que abre', async () => {
    const dest = targetFolder('origen', parent)
    const seen: CloneProgress[] = []
    await cloneInto(pathToFileURL(source).href, dest, (p) => seen.push(p))
    expect(existsSync(join(dest, '.git'))).toBe(true)
    expect(git(dest, ['rev-list', '--count', 'HEAD']).trim()).toBe(git(source, ['rev-list', '--count', 'HEAD']).trim())
    expect(seen.some((p) => p.phase === 'Receiving objects' && p.percent === 100)).toBe(true)
    const r = await dispatch('repo:open', { path: dest })
    expect(r.ok).toBe(true)
  })

  it('destino ocupado o padre inexistente: error antes de lanzar git', () => {
    const busy = join(parent, 'ocupado')
    mkdirSync(busy)
    writeFileSync(join(busy, 'algo.txt'), 'x')
    expect(() => targetFolder('ocupado', parent)).toThrow(/no está vacía/)
    expect(() => targetFolder('x', join(tmp.dir, 'no-existe'))).toThrow(/no existe/)
    // carpeta vacía sí sirve
    mkdirSync(join(parent, 'vacia'))
    expect(targetFolder('vacia', parent)).toBe(join(parent, 'vacia'))
  })

  it('el canal rechaza URL que no es HTTPS o con token, sin lanzar git', async () => {
    for (const url of [pathToFileURL(source).href, 'https://ana:tok@github.com/o/r.git']) {
      const r = await dispatch('repo:clone', { url, parent })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('INVALID_REQUEST')
    }
  })

  it('clon que falla no deja carpeta a medias', async () => {
    const dest = join(parent, 'roto')
    await expect(cloneInto(pathToFileURL(join(tmp.dir, 'no-existe')).href, dest)).rejects.toThrow(/clon falló/)
    expect(existsSync(dest)).toBe(false)
  })
})
