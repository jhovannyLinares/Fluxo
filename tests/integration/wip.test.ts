import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FileDiff } from '../../src/shared/diff'
import type { WipFiles } from '../../src/shared/wip'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** Sección de cambios sin commit contra un repo real. */
describe('cambios sin commit', () => {
  const tmp = tempDir('cg-wip-')
  const d = tmp.dir
  const w = (f: string, s: string) => writeFileSync(join(d, f), s)
  let repoId = ''
  const ok = async <T>(channel: string, payload: unknown) => {
    const r = await dispatch(channel, payload)
    if (!r.ok) throw new Error(r.error.message)
    return r.data as T
  }

  beforeAll(async () => {
    git(d, ['init', '-q', '-b', 'main'])
    w('a.txt', 'uno\ndos\n')
    w('.gitignore', 'build/\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'inicio'])
    w('a.txt', 'uno\nDOS\n') // sin stage
    w('en-stage.txt', 'nuevo\n')
    git(d, ['add', 'en-stage.txt']) // en stage
    w('suelto.txt', 'sin seguimiento\n') // nuevo sin seguimiento
    mkdirSync(join(d, 'build'))
    w('build/salida.js', 'x')
    repoId = (await ok<{ repoId: string }>('repo:open', { path: d })).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('archivos en stage y sin stage, con los nuevos y sin los ignorados', async () => {
    const indexAntes = statSync(join(d, '.git', 'index')).mtimeMs
    const f = await ok<WipFiles>('wip:files', { repoId })
    expect(f.staged).toEqual([{ status: 'A', path: 'en-stage.txt', additions: 1, deletions: 0, binary: false }])
    expect(f.unstaged).toEqual([
      { status: 'M', path: 'a.txt', additions: 1, deletions: 1, binary: false },
      { status: 'A', path: 'suelto.txt', additions: 0, deletions: 0, binary: false, untracked: true }
    ])
    // solo lectura: leer los cambios no reescribe el index
    expect(statSync(join(d, '.git', 'index')).mtimeMs).toBe(indexAntes)
  })

  it('diff de cada área: contra el index, contra HEAD y contra nada', async () => {
    const diff = (path: string, area: string) => ok<FileDiff>('wip:diff', { repoId, path, area, full: false, ignoreSpace: false })
    const lines = (f: FileDiff) => f.hunks.flatMap((h) => h.lines.filter((l) => l.t !== ' ').map((l) => l.t + l.text))
    expect(lines(await diff('a.txt', 'unstaged'))).toEqual(['-dos', '+DOS'])
    expect(lines(await diff('en-stage.txt', 'staged'))).toEqual(['+nuevo'])
    expect(lines(await diff('suelto.txt', 'untracked'))).toEqual(['+sin seguimiento'])
  })
})
