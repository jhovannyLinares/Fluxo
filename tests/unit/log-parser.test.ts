import { describe, expect, it } from 'vitest'
import { FS, RS, isAiCommit, parseLog } from '../../src/backend/git/parsers/log'

const rec = (...f: string[]) => f.join(FS) + RS

describe('parseLog', () => {
  it('lee campos y padres', () => {
    const out = rec('a'.repeat(40), `${'b'.repeat(40)} ${'c'.repeat(40)}`, 'Ana', 'ana@x.com', '1700000000', 'Merge PR 1', '') + '\n' +
      rec('b'.repeat(40), '', 'Luis', 'l@x.com', '1699999999', 'inicio', '')
    const c = parseLog(out)
    expect(c).toHaveLength(2)
    expect(c[0]!.parents).toHaveLength(2)
    expect(c[0]!.time).toBe(1700000000)
    expect(c[1]!.parents).toEqual([])
  })

  it('asunto con separadores comunes no rompe registro', () => {
    const c = parseLog(rec('a'.repeat(40), '', 'Ana', 'a@x', '1', 'fix: a | b ; c "d"', ''))
    expect(c[0]!.subject).toBe('fix: a | b ; c "d"')
  })
})

describe('isAiCommit', () => {
  it('detecta trailer Co-authored-by de agente', () => {
    expect(isAiCommit({ author: 'Gio', email: 'g@x.com', coAuthors: 'Claude <noreply@anthropic.com>' })).toBe(true)
  })
  it('detecta bots por nombre', () => {
    expect(isAiCommit({ author: 'copilot-swe-agent[bot]', email: 'x@y', coAuthors: '' })).toBe(true)
  })
  it('humano sin rastro = false', () => {
    expect(isAiCommit({ author: 'Ana López', email: 'ana@empresa.com', coAuthors: '' })).toBe(false)
  })
})
