import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runGit, runGitOk } from '../../src/backend/git/runner'
import { RepoWatcher, type RepoChange } from '../../src/backend/git/watcher'
import { commit, makeLargeRepo, tempDir } from '../fixtures/make-repo'

/**
 * Spike S3: ¿fs.watch detecta cambios sin CPU alta?
 * Metas: cambio visible < 2 s; CPU en reposo < 1 %.
 * También mide plan B (polling de refs + HEAD cada 2 s) para comparar.
 */
const TOTAL = 20_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

describe(`spike S3 · watcher en repo de ${TOTAL.toLocaleString()} commits`, () => {
  const tmp = tempDir('cg-watch-perf-')
  beforeAll(() => makeLargeRepo(tmp.dir, TOTAL))
  afterAll(() => tmp.cleanup())

  it('latencia y CPU', async () => {
    const events: { at: number; change: RepoChange }[] = []
    const w = await RepoWatcher.start(tmp.dir, (change) => events.push({ at: performance.now(), change }))

    // reposo: CPU del proceso que vigila durante 10 s sin cambios
    const idleMs = 10_000
    const cpu0 = process.cpuUsage()
    await sleep(idleMs)
    const cpu = process.cpuUsage(cpu0)
    const idlePct = ((cpu.user + cpu.system) / 1000 / idleMs) * 100

    // latencia: commits sueltos, uno cada 1.5 s
    const lat: number[] = []
    for (let i = 0; i < 10; i++) {
      events.length = 0
      const t0 = performance.now()
      commit(tmp.dir, `agente ${i}`)
      while (!events.some((e) => e.change.kinds.includes('refs')) && performance.now() - t0 < 5000) await sleep(10)
      const hit = events.find((e) => e.change.kinds.includes('refs'))
      lat.push(hit ? hit.at - t0 : Infinity)
      await sleep(1500)
    }
    w.close()

    // plan B: costo de una revisión por polling (wall time, cota superior de CPU de git)
    const poll: number[] = []
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now()
      await Promise.all([
        runGitOk(['for-each-ref', '--format=%(objectname) %(refname)'], { cwd: tmp.dir }),
        runGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: tmp.dir })
      ])
      poll.push(performance.now() - t0)
    }
    const pollPct = (med(poll) / 2000) * 100

    console.log(
      `\n[S3] reposo CPU=${idlePct.toFixed(2)}% | latencia commit→evento med=${Math.round(med(lat))}ms max=${Math.round(Math.max(...lat))}ms` +
        ` | plan B polling 2 s: ${Math.round(med(poll))}ms por revisión ≈ ${pollPct.toFixed(1)}% de un núcleo\n`
    )
    expect(idlePct).toBeLessThan(1)
    expect(Math.max(...lat)).toBeLessThan(2000)
  })
})
