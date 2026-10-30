import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { addRecent, MAX_PINNED, MAX_RECENTS, parseRecents, pinRecent, removeRecent, samePath, type Recent } from '../../src/shared/recents'
import { loadRecents, saveRecents } from '../../src/main/recents-store'
import { tempDir } from '../fixtures/make-repo'

/** H08: lista de recientes; el primero se reabre al arrancar. */
const r = (path: string, name = path.split(/[\\/]/).pop()!, openedAt = 1): Recent => ({ path, name, openedAt })

describe('lista de recientes', () => {
  it('el último abierto va primero, sin duplicados', () => {
    let list: Recent[] = []
    list = addRecent(list, r('C:/repos/a'))
    list = addRecent(list, r('C:/repos/b'))
    list = addRecent(list, r('C:/repos/a', 'a', 2))
    expect(list.map((x) => x.path)).toEqual(['C:/repos/a', 'C:/repos/b'])
    expect(list[0]!.openedAt).toBe(2)
  })

  it('misma ruta con otras mayúsculas o barras es el mismo repo', () => {
    expect(samePath('C:\\Repos\\Fluxo', 'c:/repos/fluxo/')).toBe(true)
    expect(samePath('C:/repos/fluxo', 'C:/repos/fluxo2')).toBe(false)
    const list = addRecent([r('C:\\Repos\\Fluxo')], r('c:/repos/fluxo'))
    expect(list).toHaveLength(1)
  })

  it(`guarda como máximo ${MAX_RECENTS}`, () => {
    let list: Recent[] = []
    for (let i = 0; i < MAX_RECENTS + 3; i++) list = addRecent(list, r(`C:/repos/r${i}`))
    expect(list).toHaveLength(MAX_RECENTS)
    expect(list[0]!.path).toBe(`C:/repos/r${MAX_RECENTS + 2}`)
  })

  it('un fijado no sale por el tope, y abrirlo de nuevo no lo desfija', () => {
    let list = pinRecent([r('C:/repos/cliente')], 'c:\\repos\\CLIENTE', true)
    for (let i = 0; i < MAX_RECENTS + 3; i++) list = addRecent(list, r(`C:/repos/r${i}`))
    expect(list).toHaveLength(MAX_RECENTS + 1)
    expect(list.find((x) => x.path === 'C:/repos/cliente')?.pinned).toBe(true)
    list = addRecent(list, r('C:/repos/cliente', 'cliente', 9))
    expect(list[0]).toEqual({ path: 'C:/repos/cliente', name: 'cliente', openedAt: 9, pinned: true })
    expect(pinRecent(list, 'C:/repos/cliente', false)[0]).not.toHaveProperty('pinned')
  })

  it(`como máximo ${MAX_PINNED} fijados; un recents.json viejo, sin el campo, se lee igual`, () => {
    let list: Recent[] = []
    for (let i = 0; i < MAX_PINNED + 1; i++) list = pinRecent(addRecent(list, r(`C:/p${i}`)), `C:/p${i}`, true)
    expect(list.filter((x) => x.pinned)).toHaveLength(MAX_PINNED)
    expect(parseRecents({ version: 1, repos: [r('C:/a')] })).toEqual([r('C:/a')])
  })

  it('quitar por ruta', () => {
    expect(removeRecent([r('C:/a'), r('C:/b')], 'c:\\A').map((x) => x.path)).toEqual(['C:/b'])
  })

  it('disco: otra versión o basura → vacía; entrada dañada o repetida se descarta sola', () => {
    expect(parseRecents(null)).toEqual([])
    expect(parseRecents({ version: 99, repos: [r('C:/a')] })).toEqual([])
    const ok = r('C:/a')
    expect(parseRecents({ version: 1, repos: [ok, { path: '' }, 'x', r('c:/A')] })).toEqual([ok])
  })
})

describe('almacén de recientes (main)', () => {
  const tmp = tempDir('fluxo-recents-')
  afterAll(() => tmp.cleanup())
  const file = join(tmp.dir, 'recents.json')

  it('archivo ausente o corrupto no rompe el arranque', () => {
    expect(loadRecents(join(tmp.dir, 'no-existe.json'))).toEqual([])
    writeFileSync(file, '{ esto no es json')
    expect(loadRecents(file)).toEqual([])
  })

  it('guarda y vuelve a leer igual, en UTF-8 sin BOM', () => {
    const list = [r('C:/repos/año'), r('C:/repos/b')]
    expect(saveRecents(file, list)).toEqual(list)
    expect(loadRecents(file)).toEqual(list)
    expect(readFileSync(file).subarray(0, 3).toString('hex')).not.toBe('efbbbf')
  })
})
