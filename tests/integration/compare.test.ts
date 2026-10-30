import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** B2: comparar un commit con el directorio de trabajo, igual que `git diff <commit>`. */
describe('comparar un commit con el directorio de trabajo', () => {
  const tmp = tempDir('cg-cmp-')
  const d = join(tmp.dir, 'repo')
  let repoId = ''
  let first = ''
  const write = (f: string, s: string) => writeFileSync(join(d, f), s)

  // primer commit; después commits, cambios en stage, sin stage, un borrado y un renombre sin commit
  beforeAll(async () => {
    git(tmp.dir, ['init', '-q', '-b', 'main', d])
    git(d, ['config', 'core.autocrlf', 'false'])
    mkdirSync(join(d, 'src'))
    write('a.txt', 'uno\n')
    write('b.txt', 'borrar\n')
    write('src/c.txt', 'mover\n')
    git(d, ['add', '-A'])
    git(d, ['commit', '-q', '-m', 'primero'])
    first = git(d, ['rev-parse', 'HEAD']).trim()
    write('a.txt', 'uno\ndos\n')
    git(d, ['commit', '-q', '-am', 'segundo'])
    write('a.txt', 'uno\ndos\ntres\n') // sin stage, encima de un commit
    write('nuevo.txt', 'en stage\n')
    git(d, ['add', 'nuevo.txt'])
    rmSync(join(d, 'b.txt'))
    git(d, ['mv', 'src/c.txt', 'src/d.txt'])
    const open = await dispatch('repo:open', { path: d })
    if (!open.ok) throw new Error(open.error.message)
    repoId = (open.data as { repoId: string }).repoId
  }, 60_000)
  afterAll(() => tmp.cleanup())

  type File = { status: string; path: string; oldPath?: string; additions: number; deletions: number }

  it('lista los mismos archivos y estados que git diff --name-status <commit>', async () => {
    const r = await dispatch('commit:compare', { repoId, hash: first })
    if (!r.ok) throw new Error(r.error.message)
    const files = (r.data as { files: File[] }).files
    const expected = git(d, ['diff', '--name-status', '-M', first])
      .trim()
      .split('\n')
      .map((l) => l.split('\t'))
      .map(([st, p1, p2]) => `${st![0]} ${p2 ?? p1}`)
      .sort()
    expect(files.map((f) => `${f.status} ${f.path}`).sort()).toEqual(expected)
    expect(files).toHaveLength(4) // control: a.txt, b.txt, nuevo.txt y el renombre
    expect(files.find((f) => f.path === 'a.txt')).toMatchObject({ status: 'M', additions: 2, deletions: 0 })
    expect(files.find((f) => f.path === 'src/d.txt')).toMatchObject({ status: 'R', oldPath: 'src/c.txt' })
  })

  it('el diff de un archivo es el de git diff <commit> -- <archivo>', async () => {
    const r = await dispatch('commit:compareDiff', { repoId, hash: first, path: 'a.txt', full: false, ignoreSpace: false })
    if (!r.ok) throw new Error(r.error.message)
    const ours = (r.data as { hunks: { lines: { t: string; text: string }[] }[] }).hunks.flatMap((h) =>
      h.lines.filter((l) => l.t !== ' ').map((l) => l.t + l.text)
    )
    const theirs = git(d, ['diff', first, '--', 'a.txt'])
      .split('\n')
      .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))
    expect(ours).toEqual(theirs)
    expect(ours).toEqual(['+dos', '+tres'])
  })

  it('B3: entre dos commits, igual que git diff <desde> <hasta>; desde el árbol vacío incluye el primer commit', async () => {
    const second = git(d, ['rev-parse', 'HEAD']).trim()
    const EMPTY = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
    for (const from of [first, EMPTY]) {
      const r = await dispatch('commit:compare', { repoId, hash: from, to: second })
      if (!r.ok) throw new Error(r.error.message)
      const ours = (r.data as { files: File[] }).files.map((f) => `${f.status} ${f.path} +${f.additions}`).sort()
      const theirs = git(d, ['diff', '--numstat', from, second])
        .trim()
        .split('\n')
        .map((l) => l.split('\t'))
        .map(([a, , p]) => p!)
        .sort()
      expect(ours.map((s) => s.split(' ')[1])).toEqual(theirs)
      expect(ours.length).toBeGreaterThan(0) // control
    }
    const diff = await dispatch('commit:compareDiff', { repoId, hash: first, to: second, path: 'a.txt', full: false, ignoreSpace: false })
    if (!diff.ok) throw new Error(diff.error.message)
    const lines = (diff.data as { hunks: { lines: { t: string; text: string }[] }[] }).hunks.flatMap((h) => h.lines.filter((l) => l.t !== ' ').map((l) => l.t + l.text))
    expect(lines).toEqual(['+dos']) // sin el «tres» del directorio de trabajo
  })
})
