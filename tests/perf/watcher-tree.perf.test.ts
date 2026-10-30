import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runGitOk } from '../../src/backend/git/runner'
import { RepoWatcher, type RepoChange } from '../../src/backend/git/watcher'
import { git, makeLargeRepo, tempDir } from '../fixtures/make-repo'

/**
 * Spike S5: ¿fs.watch sobre todo el árbol de trabajo cumple en un repo grande?
 * Repo: 20 000 commits, 50 000 archivos con seguimiento y `node_modules` ignorado.
 * Metas: CPU en reposo < 1 %; edición sin `git add` → evento < 2 s;
 * editar en node_modules no dispara (control: archivo no ignorado sí).
 * A8: costo de lanzar git (mediana y p95) y procesos por ráfaga.
 */
const COMMITS = 20_000
const FILES = 50_000
const PER_DIR = 100
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!

async function timeIt(n: number, fn: () => Promise<unknown>): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    await fn()
    out.push(performance.now() - t0)
  }
  return out
}

describe(`spike S5 · árbol de ${FILES.toLocaleString()} archivos y ${COMMITS.toLocaleString()} commits`, () => {
  const tmp = tempDir('cg-tree-perf-')
  const file = (i: number) => join(tmp.dir, 'src', `d${Math.floor(i / PER_DIR)}`, `f${i}.ts`)

  beforeAll(() => {
    makeLargeRepo(tmp.dir, COMMITS)
    for (let d = 0; d < FILES / PER_DIR; d++) mkdirSync(join(tmp.dir, 'src', `d${d}`), { recursive: true })
    for (let i = 0; i < FILES; i++) writeFileSync(file(i), `export const v${i} = ${i}\n`)
    writeFileSync(join(tmp.dir, '.gitignore'), 'node_modules/\n')
    for (let p = 0; p < 50; p++) {
      mkdirSync(join(tmp.dir, 'node_modules', `pkg${p}`), { recursive: true })
      for (let i = 0; i < 20; i++) writeFileSync(join(tmp.dir, 'node_modules', `pkg${p}`, `m${i}.js`), `module.exports = ${i}\n`)
    }
    git(tmp.dir, ['add', '-A'])
    git(tmp.dir, ['commit', '-q', '-m', 'árbol grande'])
  }, 1_800_000) // escribir 50 000 archivos con antivirus tarda ~10 min
  afterAll(() => tmp.cleanup())

  it('costo de git, latencia, CPU y ruido de node_modules', async () => {
    const opts = { cwd: tmp.dir }
    // A8: proceso git mínimo y comandos de la huella
    const spawn = await timeIt(30, () => runGitOk(['--version']))
    const status = await timeIt(10, () =>
      runGitOk(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], opts)
    )
    const ignored = await timeIt(10, () =>
      runGitOk(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], opts)
    )
    const lsStage = await timeIt(10, () => runGitOk(['ls-files', '--stage'], opts))

    const events: { at: number; change: RepoChange }[] = []
    const errors: Error[] = []
    const t0open = performance.now()
    const w = await RepoWatcher.start(tmp.dir, (change) => events.push({ at: performance.now(), change }), {
      onError: (e) => errors.push(e)
    })
    const openMs = performance.now() - t0open

    // reposo: CPU del proceso que vigila durante 10 s sin cambios
    const idleMs = 10_000
    const cpu0 = process.cpuUsage()
    await sleep(idleMs)
    const cpu = process.cpuUsage(cpu0)
    const idlePct = ((cpu.user + cpu.system) / 1000 / idleMs) * 100

    // latencia: edición sin git add, una cada 1.5 s, archivos distintos
    const lat: number[] = []
    const perBurst: number[] = []
    for (let i = 0; i < 10; i++) {
      events.length = 0
      const procs = w.stats.gitProcesses
      const t0 = performance.now()
      writeFileSync(file(i * 997), `// editado por agente ${i}\n`)
      while (!events.some((e) => e.change.kinds.includes('worktree')) && performance.now() - t0 < 5000) await sleep(10)
      const hit = events.find((e) => e.change.kinds.includes('worktree'))
      lat.push(hit ? hit.at - t0 : Infinity)
      await sleep(1500)
      perBurst.push(w.stats.gitProcesses - procs)
    }

    // ruido: 200 escrituras en node_modules no emiten ni lanzan git
    events.length = 0
    const procs0 = w.stats.gitProcesses
    const over0 = w.stats.overflows
    for (let i = 0; i < 200; i++) writeFileSync(join(tmp.dir, 'node_modules', `pkg${i % 50}`, `m${i % 20}.js`), `// ${i}\n`)
    await sleep(2000)
    const noiseEvents = events.length
    const noiseProcs = w.stats.gitProcesses - procs0
    // ráfaga rápida puede desbordar el búfer de ReadDirectoryChangesW: evento sin nombre → una revisión completa (6 procesos)
    const noiseOverflows = w.stats.overflows - over0
    // control positivo: mismo watcher, archivo no ignorado
    const t1 = performance.now()
    writeFileSync(file(FILES - 1), '// control\n')
    while (!events.some((e) => e.change.kinds.includes('worktree')) && performance.now() - t1 < 5000) await sleep(10)
    const control = events.some((e) => e.change.kinds.includes('worktree'))
    const mode = w.mode
    w.close()

    const ms = (xs: number[]) => `med=${Math.round(pct(xs, 0.5))}ms p95=${Math.round(pct(xs, 0.95))}ms`
    console.log(
      `\n[S5] abrir watcher ${Math.round(openMs)}ms · modo ${mode} · reposo CPU=${idlePct.toFixed(2)}%` +
        `\n[S5] edición→evento ${ms(lat)} max=${Math.round(Math.max(...lat))}ms · procesos git por ráfaga: ${perBurst.join(',')}` +
        `\n[S5] node_modules: 200 escrituras → ${noiseEvents} eventos, ${noiseProcs} procesos git, ${noiseOverflows} desbordes · control no ignorado: ${control ? 'dispara' : 'NO dispara'}` +
        `\n[A8] lanzar git (--version) ${ms(spawn)} · status ${ms(status)} · ls-files ignorados ${ms(ignored)} · ls-files --stage ${ms(lsStage)}\n`
    )
    expect(errors).toEqual([])
    expect(mode).toBe('watching')
    expect(idlePct).toBeLessThan(1)
    expect(Math.max(...lat)).toBeLessThan(2000)
    expect(noiseEvents).toBe(0)
    expect(noiseProcs).toBeLessThanOrEqual(noiseOverflows * 6)
    expect(control).toBe(true)
  })
})
