import { afterEach, describe, expect, it, vi } from 'vitest'

/** H05 contra git real: con git presente lee todo; con git ausente da error sin romperse. */
async function check(gitBin?: string) {
  vi.resetModules()
  if (gitBin === undefined) delete process.env.FLUXO_GIT_BIN
  else process.env.FLUXO_GIT_BIN = gitBin
  // el runner lee FLUXO_GIT_BIN al cargar: importar después de fijarlo
  const { checkEnvironment } = await import('../../src/backend/environment/detect')
  return checkEnvironment()
}

describe('pantalla de entorno con git real (H05)', () => {
  afterEach(() => {
    delete process.env.FLUXO_GIT_BIN
    vi.resetModules()
  })

  it('git presente: versión, ruta y las cinco filas', async () => {
    const env = await check()
    expect(env.gitFound).toBe(true)
    expect(env.gitVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(env.gitPath).toBeTruthy()
    expect(env.checks.map((c) => c.id)).toEqual(['git', 'gcm', 'helper', 'proxy', 'ssl'])
    expect(env.checks[0]!.status).toBe('ok')
  })

  it('git ausente: una sola fila en error y sin excepción', async () => {
    const env = await check('C:/no-existe/git-fluxo-prueba.exe')
    expect(env.gitFound).toBe(false)
    expect(env.gitVersion).toBeNull()
    expect(env.gitVersionOk).toBe(false)
    expect(env.checks).toEqual([{ id: 'git', status: 'error', value: null }])
  })
})
