import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ErrorLog, MAX_BYTES } from '../../src/main/error-log'
import { tempDir } from '../fixtures/make-repo'

/** B7: registro de errores en un archivo, una línea JSON con fecha por error. */
describe('registro de errores', () => {
  const tmp = tempDir('cg-log-')
  afterAll(() => tmp.cleanup())

  it('crea la carpeta y agrega una línea por error, con fecha y la salida de git', () => {
    const log = new ErrorLog(join(tmp.dir, 'a', 'logs', 'errores.log'))
    log.write({ source: 'rpc', channel: 'repo:cherryPick', code: 'GIT_FAILED', message: 'falló', gitOutput: 'CONFLICT' })
    log.write({ source: 'renderer', message: 'Unexpected token' })
    const lines = readFileSync(log.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ source: 'rpc', channel: 'repo:cherryPick', gitOutput: 'CONFLICT' })
    expect(Date.parse(lines[1].at)).not.toBeNaN()
  })

  it('al pasar el tope, el archivo actual pasa a .1 y se empieza otro', () => {
    const log = new ErrorLog(join(tmp.dir, 'b', 'errores.log'))
    log.write({ source: 'backend', message: 'primero' })
    writeFileSync(log.file, 'x'.repeat(MAX_BYTES + 1))
    log.write({ source: 'backend', message: 'después' })
    expect(existsSync(`${log.file}.1`)).toBe(true)
    expect(readFileSync(log.file, 'utf8')).toContain('después')
  })

  it('el usuario y el token de una URL no llegan al archivo; la URL sin credenciales queda igual', () => {
    const log = new ErrorLog(join(tmp.dir, 'd', 'errores.log'))
    log.write({
      source: 'rpc',
      message: 'falló',
      gitOutput: "fatal: unable to access 'https://gio:ghp_SECRETO123@github.com/o/r.git/' y git@github.com:o/r.git y https://dev.azure.com/o"
    })
    const text = readFileSync(log.file, 'utf8')
    expect(text).not.toContain('ghp_SECRETO123')
    expect(text).not.toContain('gio:')
    expect(text).toContain('https://***@github.com/o/r.git/')
    expect(text).toContain('git@github.com:o/r.git')
    expect(text).toContain('https://dev.azure.com/o')
  })

  it('un error idéntico seguido no se repite: queda «se repitió N veces» antes de la siguiente línea distinta', () => {
    const log = new ErrorLog(join(tmp.dir, 'e', 'fluxo.log'))
    const fetchErr = { source: 'rpc' as const, channel: 'repo:fetch', code: 'GIT_FAILED', message: 'El fetch falló.', gitOutput: 'not found' }
    for (let i = 0; i < 4; i++) log.write(fetchErr)
    log.write({ source: 'rpc', channel: 'repo:push', message: 'otro' })
    const lines = readFileSync(log.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => l.source)).toEqual(['rpc', 'repeat', 'rpc'])
    expect(lines[1].message).toContain('3 veces')
  })

  it('bitácora: una escritura queda como línea «op», en la misma línea de tiempo que los errores', () => {
    const log = new ErrorLog(join(tmp.dir, 'f', 'fluxo.log'))
    const head = { sha: 'abc1234', branch: 'main' }
    log.writeOp({ id: 1, op: 'pull ff', repo: 'C:/r', auto: false, queuedAt: new Date().toISOString(), waitedMs: 0, ms: 900, before: head, after: head, git: [{ cmd: 'pull --ff', code: 0, ms: 880 }], result: 'ok' })
    expect(JSON.parse(readFileSync(log.file, 'utf8'))).toMatchObject({ source: 'op', op: 'pull ff', git: [{ cmd: 'pull --ff', code: 0 }] })
  })

  it('si no se puede escribir, no lanza', () => {
    const file = join(tmp.dir, 'c.log')
    writeFileSync(file, '')
    // una carpeta con el nombre de un archivo existente no se puede crear
    expect(() => new ErrorLog(join(file, 'errores.log')).write({ source: 'rpc', message: 'x' })).not.toThrow()
  })
})
