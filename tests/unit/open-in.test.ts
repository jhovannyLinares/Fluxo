import { describe, expect, it } from 'vitest'
import { openInPlan } from '../../src/main/open-in'

/** A9: «Abrir en…» no pasa la ruta por un intérprete de comandos. */
describe('abrir la carpeta del repo afuera', () => {
  const raro = 'C:\\repos\\a&calc;new-tab cmd #1%'

  it('VS Code por URL, sin cmd.exe, con la ruta codificada', () => {
    const p = openInPlan('editor', raro)
    expect(p).toEqual({ kind: 'url', url: 'vscode://file/C:/repos/a%26calc%3Bnew-tab%20cmd%20%231%25' })
    expect(JSON.stringify(p)).not.toContain('cmd.exe')
  })

  it('Windows Terminal: el ; de la ruta va escapado para que wt no lo tome como otro comando', () => {
    expect(openInPlan('terminal', raro)).toEqual({ kind: 'spawn', cmd: 'wt.exe', args: ['-d', 'C:\\repos\\a&calc\\;new-tab cmd #1%'] })
  })

  it('Explorador: la carpeta tal cual, sin proceso', () => {
    expect(openInPlan('explorer', raro)).toEqual({ kind: 'path', path: raro })
  })
})
