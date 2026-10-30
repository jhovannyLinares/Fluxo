import { describe, expect, it } from 'vitest'
import { parseAzurePulls, parseGithubPulls } from '../../src/shared/pull-requests'

/** A4: PR de GitHub y Azure DevOps leídos con la forma de sus API. */
describe('PR del remoto', () => {
  it('GitHub: número, título, autor, ramas, borrador y página', () => {
    const api = [
      { number: 12, title: 'Agrega login', user: { login: 'ana' }, head: { ref: 'agente/login' }, base: { ref: 'main' }, draft: false, html_url: 'https://github.com/o/r/pull/12' },
      { number: 13, title: 'WIP', user: { login: 'beto' }, head: { ref: 'wip' }, base: { ref: 'main' }, draft: true, html_url: 'https://github.com/o/r/pull/13' }
    ]
    expect(parseGithubPulls(api)).toEqual([
      { id: 12, title: 'Agrega login', author: 'ana', head: 'agente/login', base: 'main', draft: false, url: 'https://github.com/o/r/pull/12' },
      { id: 13, title: 'WIP', author: 'beto', head: 'wip', base: 'main', draft: true, url: 'https://github.com/o/r/pull/13' }
    ])
  })

  it('Azure DevOps: ramas sin refs/heads/ y página armada desde el repo', () => {
    const api = {
      value: [
        { pullRequestId: 7, title: 'Corrige menú', createdBy: { displayName: 'Carla' }, sourceRefName: 'refs/heads/feature/menu', targetRefName: 'refs/heads/develop', isDraft: false }
      ]
    }
    expect(parseAzurePulls(api, 'https://dev.azure.com/org/proj/_git/repo')).toEqual([
      { id: 7, title: 'Corrige menú', author: 'Carla', head: 'feature/menu', base: 'develop', draft: false, url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/7' }
    ])
  })

  it('respuestas que no son lista: ningún PR', () => {
    expect(parseGithubPulls({ message: 'Not Found' })).toEqual([])
    expect(parseAzurePulls(null, 'x')).toEqual([])
  })
})
