import { describe, expect, it } from 'vitest'
import { prMenuEntry } from '../../src/shared/pr-menu'

describe('entrada «Start a pull request» del menú de rama', () => {
  it('otra rama local: ella es el destino y la actual el origen', () => {
    expect(prMenuEntry({ name: 'main', current: false }, 'origin/main', 'feature')).toEqual({ remote: 'origin', from: 'origin/feature', to: 'origin/main', base: 'main' })
  })

  it('la rama actual abre el PR sin destino elegido', () => {
    expect(prMenuEntry({ name: 'feature', current: true }, 'origin/feature', 'feature')).toEqual({ remote: 'origin', from: 'origin/feature', to: null, base: undefined })
  })

  it('una rama que solo existe en el remoto ya trae su remoto en el nombre', () => {
    expect(prMenuEntry({ name: 'upstream/dev', current: false, remoteOnly: true }, null, 'feature')).toEqual({ remote: 'upstream', from: 'upstream/feature', to: 'upstream/dev', base: 'dev' })
  })

  it('sin upstream se supone origin; con otro remoto se usa el del upstream', () => {
    expect(prMenuEntry({ name: 'x', current: false }, null, 'f').remote).toBe('origin')
    expect(prMenuEntry({ name: 'x', current: false }, 'fork/x', 'f').remote).toBe('fork')
  })

  it('el nombre de una rama con barra no se confunde con un remoto', () => {
    expect(prMenuEntry({ name: 'feat/login', current: false }, 'origin/feat/login', 'f')).toMatchObject({ to: 'origin/feat/login', base: 'feat/login' })
  })
})
