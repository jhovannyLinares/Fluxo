import { describe, expect, it } from 'vitest'
import { parseCoAuthors } from '../../src/backend/git/commit-detail'

/** Coautores del detalle de commit (C10). */
describe('parseCoAuthors', () => {
  it('un coautor repetido (commits unidos con squash) sale una sola vez', () => {
    const trailer = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
    const body = `asunto\n\n${trailer}\n\n* otro commit\n\n${trailer}\nco-authored-by: Claude <NOREPLY@anthropic.com>\n`
    expect(parseCoAuthors(body)).toEqual([{ name: 'Claude Opus 5.5', email: 'noreply@anthropic.com' }])
  })

  it('coautores distintos se conservan en su orden', () => {
    const body = 'Co-authored-by: Ana <ana@x.com>\nCo-authored-by: Luis <luis@x.com>'
    expect(parseCoAuthors(body).map((c) => c.name)).toEqual(['Ana', 'Luis'])
  })
})
