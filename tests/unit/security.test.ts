import { describe, expect, it } from 'vitest'
import { assertSafeArgs } from '../../src/backend/git/runner'
import { dispatch } from '../../src/backend/handlers'
import { parseGitVersion, versionAtLeast } from '../../src/backend/environment/detect'

describe('GitRunner', () => {
  it('rechaza argumentos con NUL o saltos de línea', () => {
    expect(() => assertSafeArgs(['log', 'a\0b'])).toThrow()
    expect(() => assertSafeArgs(['log', 'a\nb'])).toThrow()
    expect(() => assertSafeArgs(['log', 42])).toThrow()
    expect(() => assertSafeArgs(['log', 'x$(rm -rf /);echo'])).not.toThrow() // texto literal, sin shell
  })
})

describe('contrato IPC en backend', () => {
  it('canal desconocido rechazado', async () => {
    const r = await dispatch('fs:delete', {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_REQUEST')
  })
  it('payload inválido rechazado con error estándar', async () => {
    const r = await dispatch('graph:rows', { repoId: '../etc', offset: -1, limit: 99999 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('INVALID_REQUEST')
  })
  it('repo no abierto', async () => {
    const r = await dispatch('graph:rows', { repoId: 'r999', offset: 0, limit: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('REPO_NOT_OPEN')
  })
})

describe('detección de entorno', () => {
  it('lee versión de Git for Windows', () => {
    expect(parseGitVersion('git version 2.47.1.windows.1')).toBe('2.47.1')
  })
  it('compara versiones', () => {
    expect(versionAtLeast('2.47.1', '2.40.0')).toBe(true)
    expect(versionAtLeast('2.39.9', '2.40.0')).toBe(false)
    expect(versionAtLeast('2.40.0', '2.40.0')).toBe(true)
  })
})
