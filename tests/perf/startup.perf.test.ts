import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RECENTS_VERSION } from '../../src/shared/recents'
import { makeLargeRepo, tempDir } from '../fixtures/make-repo'

/**
 * A7 (H24): desde lanzar el ejecutable empaquetado hasta ver el grafo del último repo pintado.
 * Meta: < 2 s con un repo de 20 000 commits. Necesita `npm run dist` antes (usa dist/win-unpacked).
 * Cada corrida usa una carpeta de datos propia (`--user-data-dir`) con el repo como único reciente.
 */
const EXE = resolve(__dirname, '../../dist/win-unpacked/Fluxo.exe')
const PORT = 9555
const RUNS = 3

async function evaluate(expr: string): Promise<unknown> {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
  const page = list.find((t) => t.type === 'page')
  if (!page) return null
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  const out = await new Promise<{ result?: { value?: unknown } }>((res) => {
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data))
      if (d.id === 1) res(d.result)
    }
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
  })
  ws.close()
  return out.result?.value ?? null
}

describe.skipIf(!existsSync(EXE))('A7 · arranque del ejecutable con el último repo', () => {
  const tmp = tempDir('cg-start-')
  const repo = join(tmp.dir, 'repo')

  beforeAll(() => {
    mkdirSync(repo)
    makeLargeRepo(repo, 20_000)
  })
  afterAll(() => tmp.cleanup())

  it('ventana con el grafo pintado en menos de 2 s', async () => {
    const times: number[] = []
    for (let run = 0; run < RUNS; run++) {
      const data = join(tmp.dir, `datos-${run}`)
      mkdirSync(data)
      writeFileSync(
        join(data, 'recents.json'),
        JSON.stringify({ version: RECENTS_VERSION, repos: [{ path: repo, name: 'repo', openedAt: Date.now() }] })
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const t0 = performance.now()
      const child = spawn(EXE, [`--user-data-dir=${data}`, `--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })
      let ms = -1
      try {
        while (performance.now() - t0 < 20_000) {
          // el pie dice «primera vista» cuando el canvas pintó filas del repo reabierto
          const painted = await evaluate(`document.querySelector('footer')?.innerText.includes('primera vista') || document.querySelector('footer')?.innerText.includes('first view')`).catch(() => null)
          if (painted === true) {
            ms = performance.now() - t0
            break
          }
          await new Promise((r) => setTimeout(r, 25))
        }
      } finally {
        // /T puede fallar en un hijo protegido de Chromium; el proceso principal sí se cierra
        try {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        } catch {
          child.kill()
        }
        await new Promise((r) => setTimeout(r, 1000))
      }
      expect(ms).toBeGreaterThan(0)
      times.push(ms)
    }
    const med = [...times].sort((a, b) => a - b)[Math.floor(RUNS / 2)]!
    console.log(`[A7] arranque → grafo pintado: ${times.map((t) => Math.round(t)).join(' / ')} ms (mediana ${Math.round(med)})`)
    expect(med).toBeLessThan(2000)
  })
})
