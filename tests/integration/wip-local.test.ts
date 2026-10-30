import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { parseUnified } from '../../src/shared/diff'
import { filePatch, hunkPatch } from '../../src/shared/patch'
import { git, tempDir } from '../fixtures/make-repo'

/** Descartar, stage por bloque, ignorar, crear y borrar archivos contra un repo real. */
describe('cambios locales', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-wl-')
  let n = 0
  let d = ''
  let repoId = ''
  const write = (f: string, s: string) => writeFileSync(join(d, f), s)
  const read = (f: string) => readFileSync(join(d, f), 'utf8')
  const call = (channel: string, payload: object = {}) => dispatch(channel, { repoId, ...payload })
  const status = () => git(d, ['status', '--porcelain']).trim()
  const lines = (a: number, b: number, edit: Record<number, string> = {}) =>
    Array.from({ length: b - a + 1 }, (_, i) => edit[a + i] ?? `l${a + i}`).join('\n') + '\n'
  /** archivo largo con dos bloques separados */
  const dosBloques = () => lines(1, 40, { 2: 'DOS', 38: 'TREINTA Y OCHO' })
  const hunks = () => {
    const [head, ...rest] = git(d, ['diff', '-U1', 'largo.txt']).split(/^(?=@@ )/m)
    return { head: head!, rest }
  }

  beforeEach(async () => {
    d = join(tmp.dir, `caso${n++}`)
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    write('a.txt', 'a\n')
    write('largo.txt', lines(1, 40))
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'inicio'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  describe('descartar', () => {
    it('archivo modificado vuelve a HEAD; archivo nuevo se borra', async () => {
      write('a.txt', 'cambiado\n')
      write('nuevo.txt', 'n\n')
      expect((await call('wip:discard', { paths: ['a.txt', 'nuevo.txt'] })).ok).toBe(true)
      expect(read('a.txt')).toBe('a\n')
      expect(existsSync(join(d, 'nuevo.txt'))).toBe(false)
      expect(status()).toBe('')
    })

    it('también descarta lo que ya estaba en stage', async () => {
      write('a.txt', 'cambiado\n')
      git(d, ['add', 'a.txt'])
      await call('wip:discard', { paths: ['a.txt'] })
      expect(read('a.txt')).toBe('a\n')
      expect(status()).toBe('')
    })

    it('sin paths descarta todo', async () => {
      write('a.txt', 'x\n')
      write('nuevo.txt', 'n\n')
      await call('wip:discard', {})
      expect(status()).toBe('')
    })

    it('un solo bloque de un archivo con dos', async () => {
      write('largo.txt', dosBloques())
      const { head, rest } = hunks()
      expect(rest).toHaveLength(2)
      await call('wip:discard', { patch: head + rest[0]! })
      expect(read('largo.txt')).toBe(lines(1, 40, { 38: 'TREINTA Y OCHO' }))
    })

    it('un path hostil es solo un nombre', async () => {
      write('-f', 'x\n')
      await call('wip:discard', { paths: ['-f'] })
      expect(existsSync(join(d, '-f'))).toBe(false)
    })
  })

  describe('stage por bloque', () => {
    it('hace stage de un bloque y git diff --cached es exactamente ese bloque', async () => {
      write('largo.txt', dosBloques())
      const { head, rest } = hunks()
      const patch = head + rest[1]!
      expect((await call('wip:stagePatch', { patch, reverse: false })).ok).toBe(true)
      // la línea «index» cambia (el blob del stage es otro): se compara el bloque
      expect(git(d, ['diff', '--cached', '-U1', 'largo.txt']).split(/^(?=@@ )/m).slice(1)).toEqual([rest[1]!])
      expect(read('largo.txt')).toBe(dosBloques())
    })

    it('stage de una sola línea elegida del diff: el resto sigue sin stage', async () => {
      write('largo.txt', lines(1, 40, { 2: 'DOS', 3: 'TRES' }))
      const hunk = parseUnified(git(d, ['diff', '-U1', 'largo.txt'])).hunks[0]!
      const first = hunk.lines.filter((l) => l.t !== ' ' && (l.text === 'l2' || l.text === 'DOS'))
      const patch = filePatch('largo.txt', [hunkPatch(hunk, { selected: new Set(first), reverse: false })!])
      expect((await call('wip:stagePatch', { patch, reverse: false })).ok).toBe(true)
      expect(git(d, ['show', ':largo.txt']).split('\n').slice(0, 4)).toEqual(['l1', 'l3', 'DOS', 'l4'])
      expect(read('largo.txt').split('\n').slice(0, 4)).toEqual(['l1', 'DOS', 'TRES', 'l4'])
    })

    it('unstage de un bloque lo devuelve a los cambios sin stage', async () => {
      write('largo.txt', lines(1, 40, { 2: 'DOS' }))
      git(d, ['add', 'largo.txt'])
      const patch = git(d, ['diff', '--cached', '-U1', 'largo.txt'])
      await call('wip:stagePatch', { patch, reverse: true })
      expect(git(d, ['diff', '--cached']).trim()).toBe('')
      expect(status()).toBe('M largo.txt')
    })

    it('un patch que no aplica se rechaza y no toca el index', async () => {
      const r = await call('wip:stagePatch', { patch: 'esto no es un patch\n', reverse: false })
      expect(!r.ok && r.error.message).toMatch(/patch|bloque/i)
      expect(status()).toBe('')
    })
  })

  describe('ignorar', () => {
    it('ignora un archivo nuevo, sin duplicar la línea', async () => {
      write('log.txt', 'x\n')
      expect((await call('wip:ignore', { pattern: '/log.txt' })).ok).toBe(true)
      expect(status()).toBe('?? .gitignore')
      const again = await call('wip:ignore', { pattern: '/log.txt' })
      expect(again.ok && (again.data as { added: boolean }).added).toBe(false)
      expect(read('.gitignore').match(/log\.txt/g)).toHaveLength(1)
    })

    it('ignora por extensión', async () => {
      write('x.tmp', 'x\n')
      await call('wip:ignore', { pattern: '*.tmp' })
      expect(status()).toBe('?? .gitignore')
    })

    it('conserva un .gitignore que no termina en salto de línea', async () => {
      write('.gitignore', 'previo')
      await call('wip:ignore', { pattern: '*.tmp' })
      expect(read('.gitignore')).toBe('previo\n*.tmp\n')
    })

    it('deja de versionar uno que ya estaba versionado, sin borrarlo del disco', async () => {
      await call('wip:ignore', { pattern: '/a.txt', stopTracking: true })
      expect(git(d, ['ls-files', 'a.txt']).trim()).toBe('')
      expect(existsSync(join(d, 'a.txt'))).toBe(true)
    })
  })

  describe('crear y borrar archivo', () => {
    it('crear a/b/c.txt crea las carpetas y aparece entre los nuevos', async () => {
      const r = await call('wip:createFile', { path: 'a/b/c.txt' })
      expect(r.ok).toBe(true)
      const files = await call('wip:files')
      expect(files.ok && JSON.stringify(files.data)).toContain('a/b/c.txt')
    })

    it('no pisa un archivo existente ni sale del repo', async () => {
      expect((await call('wip:createFile', { path: 'a.txt' })).ok).toBe(false)
      expect(read('a.txt')).toBe('a\n')
      expect((await call('wip:createFile', { path: '../fuera.txt' })).ok).toBe(false)
      expect((await call('wip:createFile', { path: '.git/hook' })).ok).toBe(false)
    })

    it('borra un archivo y rechaza rutas fuera del repo', async () => {
      expect((await call('wip:deleteFile', { path: 'a.txt' })).ok).toBe(true)
      expect(existsSync(join(d, 'a.txt'))).toBe(false)
      expect((await call('wip:deleteFile', { path: '../x' })).ok).toBe(false)
    })
  })
})
