import { describe, expect, it } from 'vitest'
import { parseTrack } from '../../src/backend/git/refs-list'
import { buildRefTree, matchesRefFilter } from '../../src/shared/refs'

/** H16 (árbol por prefijo, filtro) y H17 (seguimiento). */
describe('panel de ramas', () => {
  it('seguimiento de git → ahead/behind', () => {
    expect(parseTrack('ahead 2, behind 1')).toEqual({ ahead: 2, behind: 1, gone: false })
    expect(parseTrack('ahead 3')).toEqual({ ahead: 3, behind: 0, gone: false })
    expect(parseTrack('behind 4')).toEqual({ ahead: 0, behind: 4, gone: false })
    expect(parseTrack('gone')).toEqual({ ahead: 0, behind: 0, gone: true })
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0, gone: false })
  })

  it('árbol por prefijo: carpetas primero, anidadas y alfabéticas (C6)', () => {
    const names = ['main', 'claude/b', 'claude/a', 'feature/login', 'claude/tareas/x', 'Zeta', 'alfa']
    const tree = buildRefTree(names, (n) => n)
    const show = (nodes: ReturnType<typeof buildRefTree<string>>, depth = 0): string[] =>
      nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.item ? '' : '+'}${n.label}`, ...show(n.children, depth + 1)])
    expect(show(tree)).toEqual(['+claude', '  +tareas', '    x', '  a', '  b', '+feature', '  login', 'alfa', 'main', 'Zeta'])
    expect(tree[0]!.children[1]!.item).toBe('claude/a')
  })

  it('carpeta y rama con el mismo nombre conviven', () => {
    const tree = buildRefTree(['claude', 'claude/x'], (n) => n)
    expect(tree.map((n) => [n.label, n.item ?? 'carpeta'])).toEqual([
      ['claude', 'carpeta'],
      ['claude', 'claude']
    ])
  })

  it('filtro sin mayúsculas ni acentos (C8)', () => {
    expect(matchesRefFilter('feature/Diseño', 'diseno')).toBe(true)
    expect(matchesRefFilter('claude/x', 'CLAUDE')).toBe(true)
    expect(matchesRefFilter('main', 'feat')).toBe(false)
    expect(matchesRefFilter('main', '  ')).toBe(true)
  })
})
