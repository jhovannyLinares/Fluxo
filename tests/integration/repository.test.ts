import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { commit, git, makeSmallRepo, tempDir } from '../fixtures/make-repo'

describe('backend contra repo real', () => {
  const tmp = tempDir('cg-small-')
  let repoId = ''

  beforeAll(async () => {
    makeSmallRepo(tmp.dir)
    const r = await dispatch('repo:open', { path: tmp.dir })
    expect(r.ok).toBe(true)
    if (r.ok) repoId = (r.data as { repoId: string }).repoId
  })
  afterAll(() => tmp.cleanup())

  it('abre repo y devuelve raíz real', async () => {
    const r = await dispatch('repo:open', { path: tmp.dir })
    // Windows: git devuelve C:/..., Node C:\...; también expande nombres cortos 8.3
    expect(r.ok && resolve((r.data as { root: string }).root).toLowerCase()).toBe(resolve(realpathSync.native(tmp.dir)).toLowerCase())
  })

  it('carpeta que no es repo da error legible', async () => {
    const other = tempDir('cg-norepo-')
    const r = await dispatch('repo:open', { path: other.dir })
    other.cleanup()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_A_REPO')
  })

  it('carga grafo con refs, merge y commit de IA', async () => {
    const g = await dispatch('graph:load', { repoId })
    expect(g.ok).toBe(true)
    const rows = await dispatch('graph:rows', { repoId, offset: 0, limit: 100 })
    expect(rows.ok).toBe(true)
    if (!rows.ok) return
    const list = (rows.data as { rows: Array<{ subject: string; ai: boolean; parents: string[]; refs: { name: string; kind: string }[] }> }).rows
    expect(list).toHaveLength(5)
    const merge = list.find((r) => r.parents.length === 2)!
    expect(merge.refs.map((r) => r.kind)).toContain('head')
    expect(list.find((r) => r.subject === 'fix: timeout')!.ai).toBe(true)
    expect(list.filter((r) => r.ai)).toHaveLength(1)
    const allRefs = list.flatMap((r) => r.refs.map((x) => x.name))
    expect(allRefs).toContain('v1.0.0')
    expect(allRefs).toContain('claude/fix-timeout')
  })

  it('nombre de rama hostil se muestra como texto y no ejecuta comandos', async () => {
    const rows = await dispatch('graph:rows', { repoId, offset: 0, limit: 100 })
    if (!rows.ok) throw new Error('sin filas')
    const names = (rows.data as { rows: { refs: { name: string }[] }[] }).rows.flatMap((r) => r.refs.map((x) => x.name))
    expect(names).toContain('x$(touch${IFS}pwned);echo')
    expect(existsSync(join(tmp.dir, 'pwned'))).toBe(false)
    expect(existsSync('pwned')).toBe(false)
  })
})

describe('abrir repo en casos borde (H07)', () => {
  const tmp = tempDir('cg-h07-')
  const root = join(tmp.dir, 'Mi repo con ñ y acentos á')
  const open = async (path: string) => dispatch('repo:open', { path })
  const rootOf = (r: Awaited<ReturnType<typeof open>>) => (r.ok ? resolve((r.data as { root: string }).root).toLowerCase() : null)
  beforeAll(() => {
    mkdirSync(root, { recursive: true })
    makeSmallRepo(root)
  })
  afterAll(() => tmp.cleanup())

  it('ruta con espacios y acentos', async () => {
    const r = await open(root)
    expect(rootOf(r)).toBe(resolve(realpathSync.native(root)).toLowerCase())
    expect(r.ok && (r.data as { name: string }).name).toBe('Mi repo con ñ y acentos á')
  })

  it('elegir la carpeta .git abre su proyecto', async () => {
    expect(rootOf(await open(join(root, '.git')))).toBe(resolve(realpathSync.native(root)).toLowerCase())
  })

  it('worktree vinculado abre su propia raíz y su rama', async () => {
    const wt = join(tmp.dir, 'wt agente')
    git(root, ['worktree', 'add', '-q', '-b', 'claude/tarea', wt])
    const r = await open(wt)
    expect(rootOf(r)).toBe(resolve(realpathSync.native(wt)).toLowerCase())
    expect(r.ok && (r.data as { head: string }).head).toBe('refs/heads/claude/tarea')
  })

  it('carpeta inexistente: dice que no existe, no que no es repo', async () => {
    const r = await open(join(tmp.dir, 'borrada'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('PATH_NOT_FOUND')
      expect(r.error.suggestion).toMatch(/recientes/)
    }
  })

  it('repo bare: error propio con sugerencia', async () => {
    const bare = join(tmp.dir, 'central.git')
    git(tmp.dir, ['init', '-q', '--bare', bare])
    const r = await open(bare)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('BARE_REPO')
  })

  it('repo vacío abre y su grafo no tiene filas', async () => {
    const empty = join(tmp.dir, 'vacio')
    mkdirSync(empty)
    git(empty, ['init', '-q'])
    const r = await open(empty)
    if (!r.ok) throw new Error(r.error.message)
    const g = await dispatch('graph:load', { repoId: (r.data as { repoId: string }).repoId })
    expect(g.ok && (g.data as { total: number }).total).toBe(0)
  })
})

describe('navegar por la rama en repo real (H12)', () => {
  const tmp = tempDir('cg-nav-')
  beforeAll(() => makeSmallRepo(tmp.dir))
  afterAll(() => tmp.cleanup())

  it('desde el merge baja por main y vuelve a subir', async () => {
    const open = await dispatch('repo:open', { path: tmp.dir })
    if (!open.ok) throw new Error(open.error.message)
    const repoId = (open.data as { repoId: string }).repoId
    await dispatch('graph:load', { repoId })
    const page = await dispatch('graph:rows', { repoId, offset: 0, limit: 100 })
    const rows = page.ok ? (page.data as { rows: { hash: string }[] }).rows : []
    const at = (rev: string) => rows.findIndex((r) => r.hash === git(tmp.dir, ['rev-parse', rev]).trim())
    const nav = async (index: number, dir: 'parent' | 'child') => {
      const r = await dispatch('graph:neighbor', { repoId, index, dir })
      return r.ok ? (r.data as { index: number | null }).index : 'error'
    }
    expect(await nav(at('main'), 'parent')).toBe(at('main^1'))
    expect(await nav(at('main^1'), 'child')).toBe(at('main'))
    // la rama del agente entra al merge como segundo padre: subir desde su punta no lleva al merge
    expect(await nav(at('claude/fix-timeout'), 'child')).toBeNull()
  })
})

describe('fila de cambios sin commit (H14)', () => {
  const tmp = tempDir('cg-wip-')
  beforeAll(() => makeSmallRepo(tmp.dir))
  afterAll(() => tmp.cleanup())
  type Row = { hash: string; parents: string[]; lane: number; kind?: string; wip?: { staged: number; unstaged: number; untracked: number }; refs: { kind: string }[] }
  const load = async () => {
    const open = await dispatch('repo:open', { path: tmp.dir })
    if (!open.ok) throw new Error(open.error.message)
    const repoId = (open.data as { repoId: string }).repoId
    await dispatch('graph:load', { repoId })
    const page = await dispatch('graph:rows', { repoId, offset: 0, limit: 200 })
    return page.ok ? (page.data as { rows: Row[] }).rows : []
  }

  it('árbol limpio o solo con ignorados: sin fila WIP', async () => {
    writeFileSync(join(tmp.dir, '.gitignore'), 'build/\n')
    git(tmp.dir, ['add', '.gitignore'])
    git(tmp.dir, ['commit', '-q', '-m', 'ignorar build'])
    mkdirSync(join(tmp.dir, 'build'))
    writeFileSync(join(tmp.dir, 'build', 'salida.js'), 'x')
    expect((await load()).some((r) => r.kind === 'wip')).toBe(false)
  })

  it('modificado, en stage y nuevo: fila WIP arriba, hija de HEAD, con sus conteos', async () => {
    // HEAD en una rama vieja: la punta de main queda arriba y la línea WIP→HEAD debe cruzar.
    // Esa rama no tiene el .gitignore de main: build/ dejaría de estar ignorada, se quita antes.
    rmSync(join(tmp.dir, 'build'), { recursive: true })
    git(tmp.dir, ['checkout', '-q', 'claude/fix-timeout'])
    const head = git(tmp.dir, ['rev-parse', 'HEAD']).trim()
    const tracked = git(tmp.dir, ['ls-files']).split('\n').filter((f) => f.endsWith('.txt'))
    writeFileSync(join(tmp.dir, tracked[0]!), 'editado por agente')
    writeFileSync(join(tmp.dir, tracked[1]!), 'en stage')
    git(tmp.dir, ['add', tracked[1]!])
    writeFileSync(join(tmp.dir, 'nuevo.txt'), 'nuevo')
    const rows = await load()
    const wip = rows[0]!
    expect(wip).toMatchObject({ hash: 'WIP', kind: 'wip', parents: [head], wip: { staged: 1, unstaged: 1, untracked: 1 } })
    const headRow = rows.find((r) => r.hash === head)!
    expect(headRow.lane).toBe(wip.lane)
    expect(rows.filter((r) => r.kind === 'wip')).toHaveLength(1)
  })

  it('stash se marca como tal', async () => {
    git(tmp.dir, ['stash', 'push', '-q', '-m', 'guardado'])
    const rows = await load()
    expect(rows.some((r) => r.kind === 'stash' && r.refs.some((ref) => ref.kind === 'stash'))).toBe(true)
  })
})

describe('filtros de ramas (H15)', () => {
  const tmp = tempDir('cg-filter-')
  // main con dos commits propios; feature fusionada en main; claude/viva sin fusionar
  beforeAll(() => {
    git(tmp.dir, ['init', '-q', '-b', 'main'])
    commit(tmp.dir, 'm1')
    git(tmp.dir, ['checkout', '-q', '-b', 'feature'])
    commit(tmp.dir, 'f1')
    git(tmp.dir, ['checkout', '-q', 'main'])
    commit(tmp.dir, 'm2')
    git(tmp.dir, ['merge', '-q', '--no-ff', '-m', 'merge feature', 'feature'])
    git(tmp.dir, ['checkout', '-q', '-b', 'claude/viva', 'main~1'])
    commit(tmp.dir, 'agente trabajando')
    git(tmp.dir, ['checkout', '-q', 'main'])
  })
  afterAll(() => tmp.cleanup())

  type Row = { hash: string; subject: string; lane: number; color: number; refs: { name: string }[] }
  const load = async (filter?: object) => {
    const open = await dispatch('repo:open', { path: tmp.dir })
    if (!open.ok) throw new Error(open.error.message)
    const repoId = (open.data as { repoId: string }).repoId
    const g = await dispatch('graph:load', { repoId, ...(filter ? { filter } : {}) })
    if (!g.ok) throw new Error(g.error.message)
    const page = await dispatch('graph:rows', { repoId, offset: 0, limit: 100 })
    return { rows: (page.ok ? (page.data as { rows: Row[] }).rows : []), branches: (g.data as { branches: { visible: number; total: number } }).branches }
  }
  const subjects = (rows: Row[]) => rows.map((r) => r.subject)

  it('sin filtro: todas las ramas y el contador completo', async () => {
    const { rows, branches } = await load()
    expect(subjects(rows)).toContain('agente trabajando')
    expect(branches).toEqual({ visible: 3, total: 3 })
  })

  it('ocultar una rama quita sus commits propios, no los ya fusionados, y no cambia los colores de las líneas visibles', async () => {
    const all = await load()
    const { rows, branches } = await load({ mode: 'all', hidden: ['refs/heads/claude/viva', 'refs/heads/feature'], pinned: null })
    expect(subjects(rows)).not.toContain('agente trabajando')
    expect(subjects(rows)).toContain('f1') // feature está en main por el merge
    expect(rows.some((r) => r.refs.some((x) => x.name === 'feature'))).toBe(false) // su etiqueta no se pinta
    expect(branches).toEqual({ visible: 1, total: 3 })
    const colorOf = (rs: Row[], s: string) => rs.find((r) => r.subject === s)!.color
    // punta de main y la línea de feature que entra por el merge conservan su color; un commit compartido
    // (m2, padre de main y de claude/viva) toma el color de la línea que llega por el carril más a la izquierda
    for (const s of ['merge feature', 'f1']) expect(colorOf(rows, s), s).toBe(colorOf(all.rows, s))
  })

  it('con main anclada, su línea conserva carril y color aunque se oculten ramas', async () => {
    const pin = { pinned: 'refs/heads/main' }
    const all = await load({ mode: 'all', hidden: [], ...pin })
    const { rows } = await load({ mode: 'all', hidden: ['refs/heads/claude/viva'], ...pin })
    for (const s of ['merge feature', 'm2', 'm1']) {
      const a = all.rows.find((r) => r.subject === s)!
      const b = rows.find((r) => r.subject === s)!
      expect([b.lane, b.color], s).toEqual([0, a.color])
      expect(a.lane, s).toBe(0)
    }
  })

  it('actual y relacionadas: HEAD (main) sin la rama del agente', async () => {
    const { rows, branches } = await load({ mode: 'current', hidden: [], pinned: null })
    expect(subjects(rows)).not.toContain('agente trabajando')
    expect(subjects(rows)).toContain('merge feature')
    expect(branches.visible).toBe(1)
  })

  it('rama anclada a la izquierda: sus commits en el carril 0', async () => {
    const { rows } = await load({ mode: 'all', hidden: [], pinned: 'refs/heads/claude/viva' })
    expect(rows.find((r) => r.subject === 'agente trabajando')!.lane).toBe(0)
    expect(rows.find((r) => r.subject === 'merge feature')!.lane).not.toBe(0)
  })

  it('ref inexistente u oculta con nombre raro: no rompe y el contrato rechaza lo que no es ref', async () => {
    const ok = await load({ mode: 'all', hidden: ['refs/heads/no-existe'], pinned: null })
    expect(ok.branches).toEqual({ visible: 3, total: 3 })
    const open = await dispatch('repo:open', { path: tmp.dir })
    const repoId = open.ok ? (open.data as { repoId: string }).repoId : ''
    const bad = await dispatch('graph:load', { repoId, filter: { mode: 'all', hidden: ['--output=/tmp/x'], pinned: null } })
    expect(bad.ok).toBe(false)
  })
})

describe('commits seguidos del mismo autor agrupados', () => {
  const tmp = tempDir('cg-collapse-')
  const B = { GIT_AUTHOR_NAME: 'Usuario B', GIT_AUTHOR_EMAIL: 'b@ejemplo.com' }
  beforeAll(() => {
    git(tmp.dir, ['init', '-q', '-b', 'main'])
    commit(tmp.dir, 'a1')
    commit(tmp.dir, 'a2')
    commit(tmp.dir, 'a3')
    commit(tmp.dir, 'b1', B)
    commit(tmp.dir, 'a4')
  })
  afterAll(() => tmp.cleanup())

  type Row = { hash: string; subject: string; parents: string[]; group?: { count: number; parents: string[] } }
  const load = async (collapse: boolean) => {
    const open = await dispatch('repo:open', { path: tmp.dir })
    if (!open.ok) throw new Error(open.error.message)
    const repoId = (open.data as { repoId: string }).repoId
    const g = await dispatch('graph:load', { repoId, filter: { mode: 'all', hidden: [], pinned: null, collapse } })
    if (!g.ok) throw new Error(g.error.message)
    const page = await dispatch('graph:rows', { repoId, offset: 0, limit: 100 })
    return page.ok ? (page.data as { rows: Row[] }).rows : []
  }

  it('la cadena a3-a2-a1 queda en a3 con «+2»; la fila conserva sus padres reales', async () => {
    const all = await load(false)
    const rows = await load(true)
    expect(rows.map((r) => r.subject)).toEqual(['a4', 'b1', 'a3'])
    const a3 = rows[2]!
    const a2 = all.find((r) => r.subject === 'a2')!
    expect(a3.group).toEqual({ count: 2, parents: [] })
    expect(a3.parents).toEqual([a2.hash])
    expect(rows[1]!.parents).toEqual([a3.hash])
  })

  it('el detalle y el diff de una fila agrupada suman todo el grupo con la base', async () => {
    const rows = await load(true)
    const a3 = rows[2]!
    const open = await dispatch('repo:open', { path: tmp.dir })
    const repoId = open.ok ? (open.data as { repoId: string }).repoId : ''
    const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
    type Detail = { files: { path: string }[] }
    const solo = await dispatch('commit:detail', { repoId, hash: a3.hash })
    const group = await dispatch('commit:detail', { repoId, hash: a3.hash, base: EMPTY_TREE })
    expect(solo.ok && (solo.data as Detail).files).toHaveLength(1)
    const files = group.ok ? (group.data as Detail).files.map((f) => f.path) : []
    expect(files).toHaveLength(3)
    // el archivo del commit más viejo del grupo (a1) también tiene su diff
    const first = files.find((p) => !(solo.ok && (solo.data as Detail).files.some((f) => f.path === p)))!
    const diff = await dispatch('commit:diff', { repoId, hash: a3.hash, path: first, full: false, ignoreSpace: false, base: EMPTY_TREE })
    expect(diff.ok && (diff.data as { hunks: unknown[] }).hunks.length).toBe(1)
  })

  it('sin agrupar no cambia nada', async () => {
    const rows = await load(false)
    expect(rows.map((r) => r.subject)).toEqual(['a4', 'b1', 'a3', 'a2', 'a1'])
    expect(rows.some((r) => r.group)).toBe(false)
  })
})
