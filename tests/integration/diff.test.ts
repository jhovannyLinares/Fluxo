import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { changeStarts, type FileDiff } from '../../src/shared/diff'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** H19 contra un repo real: renombre sin cambios, binario, archivo de 6 000 líneas, una coma y espacios. */
describe('diff de archivo (H19)', () => {
  const tmp = tempDir('cg-diff-')
  const d = tmp.dir
  const w = (f: string, s: string | Buffer) => writeFileSync(join(d, f), s)
  const big = (k: number) => Array.from({ length: 6000 }, (_, i) => (i === k ? `línea ${i} cambiada` : `línea ${i}`)).join('\n') + '\n'
  let repoId = ''
  let head = ''
  const diff = async (path: string, opts: { oldPath?: string; full?: boolean; ignoreSpace?: boolean } = {}) => {
    const r = await dispatch('commit:diff', { repoId, hash: head, path, full: false, ignoreSpace: false, ...opts })
    if (!r.ok) throw new Error(r.error.message)
    return r.data as FileDiff
  }

  beforeAll(async () => {
    git(d, ['init', '-q', '-b', 'main'])
    w('viejo.md', 'contenido que se renombra\nsin cambiar\n')
    w('bin.dat', Buffer.from([0, 1, 2, 3, 255, 0, 7]))
    w('grande.txt', big(-1))
    w('coma.ts', 'const total = suma(a, b)\n')
    w('espacios.ts', 'if (x) {\n  y()\n}\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'raíz'])
    git(d, ['mv', 'viejo.md', 'nuevo.md'])
    w('bin.dat', Buffer.from([9, 9, 0, 9]))
    w('grande.txt', big(4500))
    w('coma.ts', 'const total = suma(a; b)\n')
    w('espacios.ts', 'if (x) {\n    y()   \n}\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'cambios'])
    head = git(d, ['rev-parse', 'HEAD']).trim()
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  it('renombre sin cambios: ruta vieja y ningún fragmento (C15)', async () => {
    const r = await diff('nuevo.md', { oldPath: 'viejo.md' })
    expect(r).toMatchObject({ path: 'nuevo.md', oldPath: 'viejo.md', binary: false, hunks: [] })
  })

  it('binario: marcado y sin intentar el diff (C15)', async () => {
    expect(await diff('bin.dat')).toMatchObject({ binary: true, hunks: [] })
  })

  it('archivo de 6 000 líneas: completo, primer cambio en la línea 4 501 (C16)', async () => {
    const r = await diff('grande.txt', { full: true })
    expect(r.hunks).toHaveLength(1)
    const lines = r.hunks[0]!.lines
    expect(lines).toHaveLength(6001)
    const first = lines[changeStarts(lines.map((l) => l.t !== ' '))[0]!]!
    expect(first).toEqual({ t: '-', text: 'línea 4500', old: 4501, new: null })
    // fragmentos: solo el cambio con 3 líneas de contexto a cada lado
    const short = await diff('grande.txt')
    expect(short.hunks[0]!.lines).toHaveLength(8)
  })

  it('una coma: una línea quitada y una añadida', async () => {
    const lines = (await diff('coma.ts')).hunks[0]!.lines
    expect(lines.map((l) => l.t + l.text)).toEqual(['-const total = suma(a, b)', '+const total = suma(a; b)'])
  })

  it('ignorar espacios: la reindentación y los espacios finales desaparecen (C17)', async () => {
    expect((await diff('espacios.ts')).hunks).toHaveLength(1)
    expect((await diff('espacios.ts', { ignoreSpace: true })).hunks).toHaveLength(0)
  })

  it('un textconv de la config del repo no se ejecuta (control positivo con git show)', async () => {
    const marker = join(d, 'textconv-corrio')
    git(d, ['config', 'diff.malo.textconv', `node -e "require('fs').writeFileSync(process.argv[1], 'x')" ${JSON.stringify(marker)}`])
    w('.git/info/attributes', 'coma.ts diff=malo\n')
    await diff('coma.ts', { full: true })
    expect(existsSync(marker)).toBe(false)
    git(d, ['show', '--textconv', 'HEAD', '--', 'coma.ts'])
    expect(existsSync(marker)).toBe(true)
  })
})
