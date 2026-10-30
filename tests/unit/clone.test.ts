import { describe, expect, it } from 'vitest'
import { checkCloneUrl, parseCloneProgress, repoNameFromUrl } from '../../src/shared/clone'

/** H09: qué URL se acepta y qué nombre de carpeta sale. */
describe('URL para clonar', () => {
  it('acepta HTTPS de GitHub y Azure DevOps', () => {
    expect(checkCloneUrl('https://github.com/org/repo.git')).toBeNull()
    expect(checkCloneUrl('  https://dev.azure.com/org/proyecto/_git/repo  ')).toBeNull()
  })

  it('rechaza lo que no es HTTPS', () => {
    expect(checkCloneUrl('')).toBe('empty')
    expect(checkCloneUrl('http://github.com/org/repo.git')).toBe('notHttps')
    expect(checkCloneUrl('git@github.com:org/repo.git')).toBe('notHttps')
    expect(checkCloneUrl('file:///C:/repos/x')).toBe('notHttps')
    expect(checkCloneUrl('-c core.sshCommand=calc https://x')).toBe('notHttps')
  })

  it('rechaza usuario o token dentro de la URL', () => {
    expect(checkCloneUrl('https://ana:ghp_token@github.com/org/repo.git')).toBe('credentials')
    expect(checkCloneUrl('https://org@dev.azure.com/org/proyecto/_git/repo')).toBe('credentials')
  })

  it('nombre de carpeta', () => {
    expect(repoNameFromUrl('https://github.com/org/repo.git')).toBe('repo')
    expect(repoNameFromUrl('https://github.com/org/repo/')).toBe('repo')
    expect(repoNameFromUrl('https://dev.azure.com/org/Mi%20Proyecto/_git/App%20Chihuahua')).toBe('App Chihuahua')
    expect(repoNameFromUrl('https://x.com/org/a:b')).toBe('a-b')
    // nombres que Windows no permite como carpeta
    expect(repoNameFromUrl('https://x.com/org/con.git')).toBeNull()
    expect(repoNameFromUrl('https://dev.azure.com/org/p/_git/')).toBeNull()
    expect(checkCloneUrl('https://github.com/')).toBe('noName')
  })

  it('progreso de git clone', () => {
    expect(parseCloneProgress('Receiving objects:  45% (450/1000), 1.2 MiB | 2 MiB/s')).toEqual({
      phase: 'Receiving objects',
      percent: 45
    })
    expect(parseCloneProgress('Resolving deltas: 100% (10/10), done.')).toEqual({ phase: 'Resolving deltas', percent: 100 })
    expect(parseCloneProgress("Cloning into 'repo'...")).toBeNull()
  })
})
