import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { migrateDataDir } from '../../src/main/migrate-data'
import { tempDir } from '../fixtures/make-repo'

/** A14: los ajustes de %APPDATA%\Flux pasan a %APPDATA%\Fluxo una sola vez, sin tocar la carpeta vieja. */
const tmp = tempDir('fluxo-migra-')
afterAll(tmp.cleanup)
let n = 0

function oldInstall(): string {
  const dir = join(tmp.dir, String(++n), 'Flux')
  mkdirSync(join(dir, 'themes'), { recursive: true })
  mkdirSync(join(dir, 'Local Storage', 'leveldb'), { recursive: true })
  writeFileSync(join(dir, 'preferences.json'), '{"zoom":1.2}')
  writeFileSync(join(dir, 'recents.json'), '{"repos":[]}')
  writeFileSync(join(dir, 'themes', 'mio.json'), '{"name":"Mío"}')
  writeFileSync(join(dir, 'Local Storage', 'leveldb', '000003.log'), 'flux.layout.widths')
  writeFileSync(join(dir, 'Cookies'), 'no se copia')
  return dir
}

describe('migración de la carpeta de datos', () => {
  it('copia preferencias, recientes, temas y almacenamiento local; la vieja queda igual', () => {
    const old = oldInstall()
    const neu = join(old, '..', 'Fluxo')
    expect(migrateDataDir(old, neu)).toEqual(['preferences.json', 'recents.json', 'themes', 'Local Storage'])
    expect(readFileSync(join(neu, 'preferences.json'), 'utf8')).toBe('{"zoom":1.2}')
    expect(readFileSync(join(neu, 'themes', 'mio.json'), 'utf8')).toBe('{"name":"Mío"}')
    expect(existsSync(join(neu, 'Local Storage', 'leveldb', '000003.log'))).toBe(true)
    expect(existsSync(join(neu, 'Cookies'))).toBe(false)
    expect(readFileSync(join(old, 'preferences.json'), 'utf8')).toBe('{"zoom":1.2}')
  })

  it('si Fluxo ya tiene ajustes no copia nada', () => {
    const old = oldInstall()
    const neu = join(old, '..', 'Fluxo')
    mkdirSync(neu)
    writeFileSync(join(neu, 'preferences.json'), '{"zoom":1}')
    expect(migrateDataDir(old, neu)).toEqual([])
    expect(readFileSync(join(neu, 'preferences.json'), 'utf8')).toBe('{"zoom":1}')
    expect(existsSync(join(neu, 'themes'))).toBe(false)
  })

  it('sin instalación anterior no hace nada', () => {
    const base = join(tmp.dir, 'vacio')
    expect(migrateDataDir(join(base, 'Flux'), join(base, 'Fluxo'))).toEqual([])
    expect(existsSync(join(base, 'Fluxo'))).toBe(false)
  })
})
