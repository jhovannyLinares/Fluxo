import { EventEmitter } from 'node:events'
import { mkdirSync, statSync, unlinkSync, utimesSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadGraph } from '../../src/backend/git/repository'
import { RepoWatcher, WatcherError, classify, isIgnored, type RepoChange, type WatchFn } from '../../src/backend/git/watcher'
import { commit, git, makeSmallRepo, tempDir } from '../fixtures/make-repo'

/** Spike S3: cambios de agentes o terminal se ven en < 2 s y lecturas ajenas no disparan. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Espera a que se cumpla la condición, sin plazo fijo: con la máquina cargada cada paso de git tarda más. */
const until = async (ok: () => boolean, maxMs = 10_000) => {
  const t0 = Date.now()
  while (!ok() && Date.now() - t0 < maxMs) await sleep(50)
}

function collect() {
  const events: { at: number; change: RepoChange }[] = []
  const onChange = (change: RepoChange) => events.push({ at: performance.now(), change })
  const kinds = () => events.flatMap((e) => e.change.kinds)
  async function waitFor(kind: RepoChange['kinds'][number], timeoutMs = 3000): Promise<number> {
    const t0 = performance.now()
    while (performance.now() - t0 < timeoutMs) {
      const hit = events.find((e) => e.change.kinds.includes(kind))
      if (hit) return hit.at
      await sleep(20)
    }
    throw new Error(`sin evento ${kind}; recibidos: ${JSON.stringify(kinds())}`)
  }
  return { events, onChange, kinds, waitFor }
}

describe('clasificación de rutas en .git', () => {
  it('separa lo que importa del ruido', () => {
    expect(classify('HEAD', 'HEAD')).toBe('head')
    expect(classify('index', 'index')).toBe('index')
    expect(classify('refs/heads/main', 'refs/heads/main')).toBe('refs')
    expect(classify('packed-refs', 'packed-refs')).toBe('refs')
    expect(classify('rebase-merge/done', 'rebase-merge/done')).toBe('operation')
    expect(classify('MERGE_HEAD', 'MERGE_HEAD')).toBe('operation')
    expect(classify('objects/ab/cdef', 'objects/ab/cdef')).toBeNull()
    expect(classify('logs/HEAD', 'logs/HEAD')).toBeNull()
    expect(classify('refs/heads/main.lock', 'refs/heads/main.lock')).toBeNull()
    expect(classify('index.lock', 'index.lock')).toBeNull()
    expect(classify('FETCH_HEAD', 'FETCH_HEAD')).toBeNull()
    // HEAD de otro worktree (dentro de commonDir/worktrees) no es el nuestro
    expect(classify(null, 'worktrees/otro/HEAD')).toBeNull()
  })

  it('isIgnored cubre la ruta y todas sus carpetas', () => {
    const ignored = new Set(['node_modules', 'out/build', 'x.log'])
    expect(isIgnored(ignored, 'node_modules/pkg/index.js')).toBe(true)
    expect(isIgnored(ignored, 'out/build/a.js')).toBe(true)
    expect(isIgnored(ignored, 'x.log')).toBe(true)
    // control: rutas parecidas no ignoradas
    expect(isIgnored(ignored, 'node_modules2/a.js')).toBe(false)
    expect(isIgnored(ignored, 'out/a.js')).toBe(false)
    expect(isIgnored(ignored, 'src/x.log')).toBe(false)
  })
})

describe('watcher contra repo real', () => {
  const tmp = tempDir('cg-watch-')
  const remote = tempDir('cg-watch-remote-')
  let w: RepoWatcher | null = null

  beforeAll(() => {
    makeSmallRepo(remote.dir)
    git(tmp.dir, ['clone', '-q', remote.dir, '.'])
  })
  afterEach(() => {
    w?.close()
    w = null
  })
  afterAll(() => {
    tmp.cleanup()
    remote.cleanup()
  })

  // la meta de < 2 s la mide tests/perf/watcher.perf.test.ts (npm run bench): con la suite en paralelo
  // la máquina cargada llega a 3 s y la medida dejaría de decir algo del watcher
  it('commit desde terminal llega', async () => {
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    commit(tmp.dir, 'commit de agente')
    await c.waitFor('refs', 10_000)
  })

  it('checkout cambia HEAD', async () => {
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    git(tmp.dir, ['checkout', '-q', '-b', 'claude/nueva'])
    await c.waitFor('head')
    git(tmp.dir, ['checkout', '-q', 'main'])
  })

  it('lecturas ajenas y mantenimiento no disparan', async () => {
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    const index = join(tmp.dir, '.git', 'index')
    const packed = join(tmp.dir, '.git', 'packed-refs')
    const before = { index: statSync(index).mtimeMs, packed: statSync(packed, { throwIfNoEntry: false })?.mtimeMs }

    // git status de otra herramienta reescribe index al refrescar stat (sin GIT_OPTIONAL_LOCKS)
    const tracked = join(tmp.dir, git(tmp.dir, ['ls-files']).split('\n')[0]!)
    const future = new Date(Date.now() + 5000)
    utimesSync(tracked, future, future)
    git(tmp.dir, ['status', '--porcelain'])
    // pack-refs mueve refs sueltas a packed-refs sin cambiar a dónde apuntan
    git(tmp.dir, ['pack-refs', '--all'])
    // fetch sin novedades escribe FETCH_HEAD
    git(tmp.dir, ['fetch', '-q'])
    // lectura propia de la app
    await loadGraph(tmp.dir)
    await sleep(1500)

    // control positivo: los archivos sí cambiaron en disco, el filtro es lo que calla
    expect(statSync(index).mtimeMs).not.toBe(before.index)
    expect(statSync(packed).mtimeMs).not.toBe(before.packed)
    expect(c.kinds()).toEqual([])
  })

  it('merge con conflicto abre y cierra operación', async () => {
    git(tmp.dir, ['checkout', '-q', '-b', 'choque'])
    writeFileSync(join(tmp.dir, 'choque.txt'), 'rama\n')
    git(tmp.dir, ['add', '-A'])
    git(tmp.dir, ['commit', '-q', '-m', 'choque en rama'])
    git(tmp.dir, ['checkout', '-q', 'main'])
    writeFileSync(join(tmp.dir, 'choque.txt'), 'main\n')
    git(tmp.dir, ['add', '-A'])
    git(tmp.dir, ['commit', '-q', '-m', 'choque en main'])

    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    expect(() => git(tmp.dir, ['merge', '-q', 'choque'])).toThrow()
    await c.waitFor('operation')
    c.events.length = 0
    git(tmp.dir, ['merge', '--abort'])
    await c.waitFor('operation')
  })

  it('ráfaga de commits se agrupa en pocos eventos', async () => {
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    const head0 = git(tmp.dir, ['rev-parse', 'HEAD']).trim()
    for (let i = 0; i < 30; i++) commit(tmp.dir, `ráfaga ${i}`)
    await c.waitFor('refs')
    await sleep(1500)
    const refsEvents = c.events.filter((e) => e.change.kinds.includes('refs')).length
    expect(refsEvents).toBeGreaterThan(0)
    expect(refsEvents).toBeLessThan(30)
    expect(git(tmp.dir, ['rev-parse', 'HEAD']).trim()).not.toBe(head0)
  })

  it('worktree vinculado ve refs compartidas pero no el HEAD del otro', async () => {
    const wt = tempDir('cg-watch-wt-')
    git(tmp.dir, ['worktree', 'add', '-q', join(wt.dir, 'wt'), '-b', 'agente/wt'])
    const c = collect()
    w = await RepoWatcher.start(join(wt.dir, 'wt'), c.onChange)
    commit(tmp.dir, 'commit en checkout principal')
    await c.waitFor('refs')
    c.events.length = 0
    git(tmp.dir, ['checkout', '-q', '-b', 'solo-principal'])
    await sleep(1500)
    expect(c.kinds()).not.toContain('head')
    w.close()
    git(tmp.dir, ['worktree', 'remove', '--force', join(wt.dir, 'wt')])
    wt.cleanup()
  })
})

describe('spike S5 · árbol de trabajo', () => {
  const tmp = tempDir('cg-watch-tree-')
  let w: RepoWatcher | null = null

  beforeAll(() => {
    makeSmallRepo(tmp.dir)
    writeFileSync(join(tmp.dir, '.gitignore'), 'node_modules/\n')
    mkdirSync(join(tmp.dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(tmp.dir, 'node_modules', 'pkg', 'index.js'), 'v1\n')
    git(tmp.dir, ['add', '-A'])
    git(tmp.dir, ['commit', '-q', '-m', 'ignora node_modules'])
  })
  afterEach(() => {
    w?.close()
    w = null
    git(tmp.dir, ['reset', '-q', '--hard'])
    git(tmp.dir, ['clean', '-q', '-f'])
  })
  afterAll(() => tmp.cleanup())

  const tracked = () => join(tmp.dir, git(tmp.dir, ['ls-files', '--', '*.txt']).split('\n')[0]!)

  it('edición sin git add llega en menos de 2 s, y una segunda edición también', async () => {
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    const t0 = performance.now()
    writeFileSync(tracked(), 'editado por agente\n')
    const at = await c.waitFor('worktree')
    expect(at - t0).toBeLessThan(2000)
    // mismo archivo ya modificado: status no cambia, tamaño/mtime sí
    c.events.length = 0
    await sleep(50)
    writeFileSync(tracked(), 'segunda edición, más larga\n')
    await c.waitFor('worktree')
  })

  it('archivo nuevo sin seguimiento dispara worktree', async () => {
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    writeFileSync(join(tmp.dir, 'nuevo.md'), 'hola\n')
    await c.waitFor('worktree')
  })

  it('editar en node_modules no dispara ni lanza git; editar archivo no ignorado sí', async () => {
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    const procs = w.stats.gitProcesses
    writeFileSync(join(tmp.dir, 'node_modules', 'pkg', 'index.js'), 'v2\n')
    writeFileSync(join(tmp.dir, 'node_modules', 'pkg', 'nuevo.js'), 'x\n')
    await sleep(1500)
    expect(c.kinds()).toEqual([])
    expect(w.stats.gitProcesses).toBe(procs)
    // control positivo: mismo watcher, archivo no ignorado
    writeFileSync(tracked(), 'cambio visible\n')
    await c.waitFor('worktree')
    expect(w.stats.gitProcesses).toBeGreaterThan(procs)
  })

  it('carpeta ignorada creada después de abrir: primera ráfaga revisa, siguientes no lanzan git', async () => {
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    mkdirSync(join(tmp.dir, 'node_modules', 'otro'), { recursive: true })
    writeFileSync(join(tmp.dir, 'node_modules', 'otro', 'a.js'), 'a\n')
    await sleep(1500)
    const procs = w.stats.gitProcesses
    writeFileSync(join(tmp.dir, 'node_modules', 'otro', 'a.js'), 'b\n')
    await sleep(1500)
    expect(c.kinds()).toEqual([])
    expect(w.stats.gitProcesses).toBe(procs)
  })

  it('git add de una edición se ve como index', async () => {
    writeFileSync(tracked(), 'para stage\n')
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange)
    git(tmp.dir, ['add', '-A'])
    await c.waitFor('index')
  })
})

describe('spike S5 · autoprueba, reinicio y polling', () => {
  const tmp = tempDir('cg-watch-probe-')
  let w: RepoWatcher | null = null
  beforeAll(() => makeSmallRepo(tmp.dir))
  afterEach(() => {
    w?.close()
    w = null
  })
  afterAll(() => tmp.cleanup())

  it('autoprueba pasiva con fs.watch real: no escribe en .git ni da falso aviso', async () => {
    const errors: WatcherError[] = []
    const c = collect()
    w = await RepoWatcher.start(tmp.dir, c.onChange, { checkMs: 200, onError: (e) => errors.push(e) })
    // espía propio sobre .git: ve cualquier archivo creado o borrado, aunque dure un instante
    const touched: string[] = []
    const spyGit = watch(join(tmp.dir, '.git'), { recursive: true }, (_ev, name) => touched.push(String(name)))
    try {
      // solo lectura: varias autopruebas pasivas sin tocar nada en .git
      await until(() => w!.stats.checks > 1)
      expect(w.stats.checks).toBeGreaterThan(1)
      expect(touched).toEqual([])
      // control positivo: el espía sí ve un archivo testigo como el que se quitó
      writeFileSync(join(tmp.dir, '.git', 'testigo-control'), '')
      unlinkSync(join(tmp.dir, '.git', 'testigo-control'))
      await sleep(200)
      expect(touched).toContain('testigo-control')
    } finally {
      spyGit.close()
    }
    // commit con fs.watch vivo: lo emite el flujo normal, la autoprueba no lo toma por sordera
    commit(tmp.dir, 'commit con watcher vivo')
    await c.waitFor('refs')
    await sleep(700)
    expect(errors).toEqual([])
    expect(w.mode).toBe('watching')
  })

  it('watcher detenido a propósito: autoprueba pasiva avisa y polling detecta el commit', async () => {
    const errors: WatcherError[] = []
    const c = collect()
    // fs.watch que nunca emite: simula unidad de red u OneDrive sin notificaciones
    const deaf = () => Object.assign(new EventEmitter(), { close: () => {} }) as unknown as FSWatcher
    w = await RepoWatcher.start(tmp.dir, c.onChange, {
      watchImpl: deaf,
      checkMs: 300,
      maxWaitMs: 300,
      pollMs: 300,
      onError: (e) => errors.push(e)
    })
    // sin cambios no hay nada que comparar: sordo pero sin falso aviso
    await sleep(800)
    expect(errors).toEqual([])
    expect(w.mode).toBe('watching')
    // primer commit lo detecta la autoprueba
    commit(tmp.dir, 'commit que fs.watch no avisa')
    await c.waitFor('refs')
    expect(errors.map((e) => e.code)).toEqual(['WATCH_DEAF'])
    expect(w.mode).toBe('polling')
    // siguiente commit lo detecta el polling
    c.events.length = 0
    commit(tmp.dir, 'commit visto por polling')
    await c.waitFor('refs')
  })

  it('fs.watch caído se reinicia y sigue viendo commits', async () => {
    const errors: WatcherError[] = []
    const c = collect()
    const made: FSWatcher[] = []
    const spy: WatchFn = (dir, opts, listener) => {
      const fw = watch(dir, opts, listener)
      made.push(fw)
      return fw
    }
    w = await RepoWatcher.start(tmp.dir, c.onChange, { watchImpl: spy, restartDelayMs: 100, onError: (e) => errors.push(e) })
    made[0]!.emit('error', new Error('caída simulada'))
    await sleep(300)
    expect(errors.map((e) => e.code)).toEqual(['WATCH_FAILED'])
    expect(made.length).toBe(2)
    expect(w.mode).toBe('watching')
    commit(tmp.dir, 'commit tras reinicio')
    await c.waitFor('refs')
  })
})
