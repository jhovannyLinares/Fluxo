import { describe, expect, it } from 'vitest'
import { isProviderUrl, parseRemote, webUrl } from '../../src/shared/web-links'

/** H23: de la URL del remoto a la página del commit, la rama o sus PR. */
describe('enlaces web (H23)', () => {
  it('GitHub por HTTPS (con token, que se descarta), SSH y ssh://', () => {
    const base = { host: 'github', base: 'https://github.com/hokeis/fluxo' }
    expect(parseRemote('https://github.com/hokeis/fluxo.git')).toEqual(base)
    expect(parseRemote('https://x-access-token:ghp_secreto@github.com/hokeis/fluxo')).toEqual(base)
    expect(parseRemote('git@github.com:hokeis/fluxo.git')).toEqual(base)
    expect(parseRemote('ssh://git@github.com/hokeis/fluxo.git')).toEqual(base)
  })

  it('Azure DevOps por HTTPS, SSH y el dominio antiguo visualstudio.com', () => {
    const base = { host: 'azure', base: 'https://dev.azure.com/empresa/Proyecto/_git/app' }
    expect(parseRemote('https://empresa@dev.azure.com/empresa/Proyecto/_git/app')).toEqual(base)
    expect(parseRemote('git@ssh.dev.azure.com:v3/empresa/Proyecto/app')).toEqual(base)
    expect(parseRemote('ssh://git@ssh.dev.azure.com:22/v3/empresa/Proyecto/app')).toEqual(base)
    expect(parseRemote('https://empresa.visualstudio.com/DefaultCollection/Proyecto/_git/app')).toEqual({
      host: 'azure',
      base: 'https://empresa.visualstudio.com/Proyecto/_git/app'
    })
  })

  it('otro proveedor o ruta local: null', () => {
    expect(parseRemote('https://gitlab.com/a/b.git')).toBeNull()
    expect(parseRemote('C:/repos/remoto.git')).toBeNull()
    expect(parseRemote('https://github.com.malo.io/a/b')).toBeNull()
  })

  it('URLs de commit, rama (con / y caracteres raros) y PR', () => {
    const gh = parseRemote('git@github.com:hokeis/fluxo.git')!
    const az = parseRemote('git@ssh.dev.azure.com:v3/empresa/Proyecto/app')!
    expect(webUrl(gh, 'commit', 'abc1234')).toBe('https://github.com/hokeis/fluxo/commit/abc1234')
    expect(webUrl(gh, 'branch', 'claude/tarea #1')).toBe('https://github.com/hokeis/fluxo/tree/claude/tarea%20%231')
    expect(webUrl(gh, 'prs', 'feature/login')).toBe('https://github.com/hokeis/fluxo/pulls?q=is%3Apr%20head%3Afeature%2Flogin')
    expect(webUrl(az, 'commit', 'abc1234')).toBe('https://dev.azure.com/empresa/Proyecto/_git/app/commit/abc1234')
    expect(webUrl(az, 'branch', 'feature/login')).toBe('https://dev.azure.com/empresa/Proyecto/_git/app?version=GBfeature%2Flogin')
    expect(webUrl(az, 'prs', 'feature/login')).toBeNull()
  })

  it('main solo abre https de los proveedores', () => {
    expect(isProviderUrl('https://github.com/a/b/commit/1')).toBe(true)
    expect(isProviderUrl('https://empresa.visualstudio.com/p/_git/r')).toBe(true)
    expect(isProviderUrl('http://github.com/a/b')).toBe(false)
    expect(isProviderUrl('https://github.com.malo.io/a')).toBe(false)
    expect(isProviderUrl('file:///C:/Windows/system32/calc.exe')).toBe(false)
    expect(isProviderUrl('no es url')).toBe(false)
  })
})
