import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dispatch } from '../../src/backend/handlers'
import { git, tempDir } from '../fixtures/make-repo'

/** «Initialize a Repo» (fase 5): carpeta, README, .gitignore y licencia opcionales, commit inicial. */
describe('init', { timeout: 60_000 }, () => {
  const tmp = tempDir('cg-init-')
  afterAll(() => tmp.cleanup())
  const init = (payload: object) => dispatch('repo:init', payload)
  const fail = async (payload: object) => {
    const r = await init(payload)
    return r.ok ? '' : r.error.message
  }

  it('crea el repo en la rama main con README y un commit inicial', async () => {
    const r = await init({ name: 'uno', parent: tmp.dir })
    expect(r.ok).toBe(true)
    const d = join(tmp.dir, 'uno')
    expect(r.ok && (r.data as { path: string }).path.replace(/\\/g, '/')).toBe(d.replace(/\\/g, '/'))
    expect(git(d, ['branch', '--show-current']).trim()).toBe('main')
    expect(git(d, ['log', '--format=%s']).trim()).toBe('Initial commit')
    expect(readFileSync(join(d, 'README.md'), 'utf8')).toBe('# uno\n')
    expect(git(d, ['ls-files']).trim()).toBe('README.md')
    expect(git(d, ['status', '--short']).trim()).toBe('')
  })

  it('respeta la rama por defecto elegida', async () => {
    expect((await init({ name: 'dos', parent: tmp.dir, branch: 'trunk' })).ok).toBe(true)
    expect(git(join(tmp.dir, 'dos'), ['branch', '--show-current']).trim()).toBe('trunk')
  })

  it('con plantilla de .gitignore y licencia las versiona en el commit inicial', async () => {
    expect((await init({ name: 'tres', parent: tmp.dir, gitignore: 'Node', license: 'MIT License' })).ok).toBe(true)
    const d = join(tmp.dir, 'tres')
    expect(git(d, ['ls-files']).trim().split('\n').sort()).toEqual(['.gitignore', 'LICENSE.md', 'README.md'])
    expect(readFileSync(join(d, '.gitignore'), 'utf8')).toContain('node_modules/')
    const year = new Date().getFullYear()
    const lic = readFileSync(join(d, 'LICENSE.md'), 'utf8')
    expect(lic).toContain(`Copyright (c) ${year} ${git(d, ['config', 'user.name']).trim()}`)
    expect(git(d, ['status', '--short']).trim()).toBe('')
  })

  it('«Copyright (C) [year] [name]» deja solo esa línea', async () => {
    expect((await init({ name: 'cuatro', parent: tmp.dir, license: 'Copyright (C) [year] [name]' })).ok).toBe(true)
    const lic = readFileSync(join(tmp.dir, 'cuatro', 'LICENSE.md'), 'utf8')
    expect(lic).toMatch(/^Copyright \(C\) \d{4} .+\n$/)
  })

  it('rechaza nombres que salen de la carpeta o no valen en Windows', async () => {
    for (const name of ['', '  ', '..', 'a/b', 'a\\b', 'x:y', 'con*', 'fin.']) {
      expect(await fail({ name, parent: tmp.dir }), name).not.toBe('')
    }
    expect(existsSync(join(tmp.dir, '..', 'a'))).toBe(false)
  })

  it('rechaza una carpeta que ya tiene contenido, un padre que no existe, una rama inválida y plantillas desconocidas', async () => {
    mkdirSync(join(tmp.dir, 'ocupada'))
    writeFileSync(join(tmp.dir, 'ocupada', 'x.txt'), 'x')
    expect(await fail({ name: 'ocupada', parent: tmp.dir })).toMatch(/no está vacía/i)
    expect(await fail({ name: 'z', parent: join(tmp.dir, 'nada') })).toMatch(/no existe/i)
    expect(await fail({ name: 'rama', parent: tmp.dir, branch: 'mala rama' })).toMatch(/rama/i)
    expect(existsSync(join(tmp.dir, 'rama'))).toBe(false)
    expect(await fail({ name: 'tpl', parent: tmp.dir, gitignore: 'NoExiste' })).toMatch(/plantilla/i)
    expect(await fail({ name: 'lic', parent: tmp.dir, license: 'NoExiste' })).toMatch(/licencia/i)
    expect(existsSync(join(tmp.dir, 'tpl')) || existsSync(join(tmp.dir, 'lic'))).toBe(false)
  })

  it('una carpeta existente pero vacía se aprovecha', async () => {
    mkdirSync(join(tmp.dir, 'vacia'))
    expect((await init({ name: 'vacia', parent: tmp.dir })).ok).toBe(true)
    expect(git(join(tmp.dir, 'vacia'), ['log', '--format=%s']).trim()).toBe('Initial commit')
  })
})
