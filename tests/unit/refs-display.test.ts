import { describe, expect, it } from 'vitest'
import type { RefLabel } from '../../src/shared/graph-types'
import { checkoutTarget, groupRefs, refsTooltip } from '../../src/renderer/src/graph/refs-display'

/** H13: cómo se agrupan las refs de un commit en la columna de etiquetas. */
const L = (name: string): RefLabel => ({ name, kind: 'local' })
const R = (name: string): RefLabel => ({ name, kind: 'remote' })
const T = (name: string): RefLabel => ({ name, kind: 'tag' })

describe('columna de etiquetas', () => {
  it('local y su remota en el mismo commit: una píldora con los dos (C2)', () => {
    expect(groupRefs([L('main'), R('origin/main')])).toEqual([
      { kind: 'branch', name: 'main', local: true, remotes: ['origin'], current: false, refs: ['refs/heads/main', 'refs/remotes/origin/main'] }
    ])
  })

  it('refs completas para ocultar o anclar (H15)', () => {
    const g = groupRefs([R('origin/claude/x'), T('v1'), { name: 'stash', kind: 'stash' }])
    expect(g.map((d) => d.refs)).toEqual([['refs/remotes/origin/claude/x'], ['refs/tags/v1'], []])
  })

  it('remota sin local igual: píldora propia', () => {
    expect(groupRefs([L('main'), R('origin/claude/x')]).map((d) => [d.name, d.local, d.remotes])).toEqual([
      ['main', true, []],
      ['origin/claude/x', false, ['origin']]
    ])
  })

  it('HEAD en una rama: ✓ en esa rama y va primero (C4), sin píldora HEAD aparte', () => {
    const refs: RefLabel[] = [{ name: 'HEAD', kind: 'head' }, L('feature/a'), T('v1'), L('main')]
    const g = groupRefs(refs)
    expect(g[0]).toMatchObject({ name: 'feature/a', current: true })
    expect(g.some((d) => d.kind === 'head')).toBe(false)
    expect(g.map((d) => d.name)).toEqual(['feature/a', 'main', 'v1'])
  })

  it('HEAD desacoplado: píldora HEAD con hash corto, primera', () => {
    const g = groupRefs([{ name: 'HEAD (abc1234)', kind: 'head' }, T('v2')])
    expect(g[0]).toMatchObject({ kind: 'head', name: 'HEAD abc1234' })
  })

  it('orden: actual, locales, solo remotas, tags, stash; tooltip con todo (C3)', () => {
    const g = groupRefs([{ name: 'stash', kind: 'stash' }, T('v1'), R('upstream/x'), L('b'), R('origin/b'), R('upstream/b')])
    expect(g.map((d) => d.name)).toEqual(['b', 'upstream/x', 'v1', 'stash'])
    expect(g[0]!.remotes).toEqual(['origin', 'upstream'])
    expect(refsTooltip(g)).toBe('b (local + origin + upstream)\nupstream/x (upstream)\nv1 (tag)\nstash (stash)')
  })
})

describe('prioridad de la primera píldora', () => {
  it('rama local que también está en el remoto va antes que las solo locales', () => {
    const g = groupRefs([L('claude/tarea-1'), L('claude/tarea-2'), L('feature/login'), R('origin/feature/login'), T('v0.1')])
    expect(g.map((d) => d.name)).toEqual(['feature/login', 'claude/tarea-1', 'claude/tarea-2', 'v0.1'])
  })

  it('doble clic: cambia a la píldora que se ve, salvo que ya sea la actual o no sea rama', () => {
    expect(checkoutTarget(groupRefs([L('main'), R('origin/main')]))).toBe('refs/heads/main')
    expect(checkoutTarget(groupRefs([R('origin/claude/x')]))).toBe('refs/remotes/origin/claude/x')
    expect(checkoutTarget(groupRefs([{ name: 'HEAD', kind: 'head' }, L('main'), L('otra')]))).toBeNull()
    expect(checkoutTarget(groupRefs([T('v1')]))).toBeNull()
    // HEAD desacoplado: la rama del mismo commit sí lleva de vuelta a ella
    expect(checkoutTarget(groupRefs([{ name: 'HEAD (abc1234)', kind: 'head' }, L('main')]))).toBe('refs/heads/main')
  })
})
