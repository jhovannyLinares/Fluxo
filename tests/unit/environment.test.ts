import { describe, expect, it } from 'vitest'
import { evaluateEnvironment, maskProxy, type RawEnvironment } from '../../src/backend/environment/detect'

/** H05: cada pieza del entorno con su estado. */
const base: RawEnvironment = {
  gitVersion: '2.45.1',
  gitPath: 'C:/Program Files/Git/mingw64/libexec/git-core',
  gcmVersion: '2.5.0',
  helpers: ['manager'],
  gitProxy: null,
  envProxy: null,
  sslBackend: 'schannel'
}
const byId = (raw: RawEnvironment) => Object.fromEntries(evaluateEnvironment(raw).map((c) => [c.id, c]))

describe('pantalla de entorno (H05)', () => {
  it('equipo completo: todo listo', () => {
    const c = byId(base)
    expect(c.git).toEqual({ id: 'git', status: 'ok', value: '2.45.1' })
    expect(c.gcm!.status).toBe('ok')
    expect(c.helper!.status).toBe('ok')
    expect(c.proxy).toEqual({ id: 'proxy', status: 'info', value: null })
    expect(c.ssl!.status).toBe('ok')
  })

  it('git ausente: solo la fila de git, en error', () => {
    expect(evaluateEnvironment({ ...base, gitVersion: null })).toEqual([{ id: 'git', status: 'error', value: null }])
  })

  it('git anterior a la mínima: error con su versión', () => {
    expect(byId({ ...base, gitVersion: '2.39.9' }).git).toEqual({ id: 'git', status: 'error', value: '2.39.9' })
  })

  it('sin GCM o con otro helper: atención', () => {
    expect(byId({ ...base, gcmVersion: null }).gcm!.status).toBe('warn')
    expect(byId({ ...base, helpers: ['wincred'] }).helper).toEqual({ id: 'helper', status: 'warn', value: 'wincred' })
    expect(byId({ ...base, helpers: [] }).helper!.status).toBe('warn')
  })

  it('el último helper manda y uno vacío anula los anteriores', () => {
    expect(byId({ ...base, helpers: ['wincred', 'manager'] }).helper!.status).toBe('ok')
    expect(byId({ ...base, helpers: ['manager-core'] }).helper!.status).toBe('ok')
    expect(byId({ ...base, helpers: ['manager', ''] }).helper).toEqual({ id: 'helper', status: 'warn', value: null })
  })

  it('proxy: el de git gana al de entorno y nunca muestra la contraseña', () => {
    expect(byId({ ...base, envProxy: 'http://env:3128' }).proxy!.value).toBe('http://env:3128')
    expect(byId({ ...base, gitProxy: 'http://git:8080', envProxy: 'http://env:3128' }).proxy!.value).toBe('http://git:8080')
    const p = byId({ ...base, gitProxy: 'http://ana:s3creta@proxy.corp:8080' }).proxy!.value
    expect(p).toBe('http://***@proxy.corp:8080')
    expect(p).not.toContain('s3creta')
  })

  it('SSL: schannel listo; openssl o sin valor, información', () => {
    expect(byId({ ...base, sslBackend: 'openssl' }).ssl).toEqual({ id: 'ssl', status: 'info', value: 'openssl' })
    expect(byId({ ...base, sslBackend: null }).ssl).toEqual({ id: 'ssl', status: 'info', value: 'openssl' })
  })

  it('maskProxy deja intacta una URL sin credenciales', () => {
    expect(maskProxy('http://proxy.corp:8080')).toBe('http://proxy.corp:8080')
    expect(maskProxy('https://u@proxy:1')).toBe('https://***@proxy:1')
  })
})
