import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prCreate, prPrepare, prTemplates } from '../../src/backend/git/pr-create'
import { git, tempDir } from '../fixtures/make-repo'

type Call = { method: string; url: string; body: unknown }

/** Crear un pull request en GitHub (simulado con un fetch falso): datos del formulario, el POST y los errores. */
describe('crear pull request', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-pr-')
  let repo = ''
  const calls: Call[] = []
  let createStatus = 201
  let createBody: unknown = { number: 7, html_url: 'https://github.com/yo/proj/pull/7' }
  let extrasOk = true

  const tok = async () => 'ghp_secreto'
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url).replace('https://api.github.com/repos/yo/proj', '')
    calls.push({ method: init?.method ?? 'GET', url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status })
    if (u === '') return json(200, { default_branch: 'main' })
    if (u.startsWith('/assignees')) return json(200, [{ login: 'ana' }, { login: 'beto' }])
    if (u.startsWith('/labels')) return json(200, [{ name: 'bug' }, { name: 'docs' }])
    if (u.startsWith('/rules/branches/otra')) return json(200, [])
    if (u.startsWith('/rules/branches/main')) return json(200, [{ type: 'pull_request', parameters: { required_approving_review_count: 2 } }])
    if (u === '/pulls') return json(createStatus, createBody)
    return extrasOk ? json(200, {}) : json(422, {})
  }) as unknown as typeof fetch

  beforeAll(() => {
    repo = join(realpathSync.native(tmp.dir), 'proj')
    mkdirSync(repo)
    git(repo, ['init', '-q', '-b', 'main'])
    git(repo, ['config', 'core.autocrlf', 'false'])
    git(repo, ['remote', 'add', 'origin', 'https://github.com/yo/proj.git'])
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'base'])
    git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    git(repo, ['checkout', '-q', '-b', 'feature'])
    writeFileSync(join(repo, 'b.txt'), 'b\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'trabajo'])
    git(repo, ['update-ref', 'refs/remotes/origin/feature', 'HEAD'])
    git(repo, ['config', 'branch.feature.remote', 'origin'])
    git(repo, ['config', 'branch.feature.merge', 'refs/heads/feature'])
    mkdirSync(join(repo, '.github'))
    writeFileSync(join(repo, '.github', 'pull_request_template.md'), '## Qué cambia\n')
  })
  afterAll(() => tmp.cleanup())

  it('el formulario trae la rama subida, la destino principal, plantillas, personas, etiquetas y lo que entra', async () => {
    const p = await prPrepare(repo, undefined, undefined, fake, tok)
    expect(p).toMatchObject({ slug: 'yo/proj', remote: 'origin', head: 'feature', localHead: 'feature', base: 'main', approvals: 2, people: ['ana', 'beto'], labels: ['bug', 'docs'] })
    expect(p.templates).toEqual([{ name: '.github/pull_request_template.md', body: '## Qué cambia\n' }])
    expect(p.branches).toEqual(['main'])
    expect(p.diff).toEqual({ commits: 1, files: 1, conflicts: false })
  })

  it('una rama que no está en el remoto sale con head null (hay que subirla antes)', async () => {
    git(repo, ['branch', 'sin-subir', 'feature'])
    const p = await prPrepare(repo, 'sin-subir', undefined, fake, tok)
    expect(p.head).toBeNull()
    expect(p.localHead).toBe('sin-subir')
  })

  it('el destino pedido manda sobre el principal y avisa si las ramas chocan', async () => {
    git(repo, ['checkout', '-q', 'main'])
    writeFileSync(join(repo, 'b.txt'), 'distinto\n')
    git(repo, ['add', 'b.txt'])
    git(repo, ['commit', '-q', '-m', 'main toca b'])
    git(repo, ['update-ref', 'refs/remotes/origin/otra', 'HEAD'])
    git(repo, ['checkout', '-q', 'feature'])
    const p = await prPrepare(repo, 'feature', 'otra', fake, tok)
    expect(p.base).toBe('otra')
    expect(p.diff?.conflicts).toBe(true)
  })

  it('crea el PR y después pide revisores, asignados y etiquetas', async () => {
    calls.length = 0
    const r = await prCreate(repo, 'origin', { base: 'main', head: 'feature', title: 'Mi PR', body: 'hola', draft: true, reviewers: ['ana'], assignees: ['beto'], labels: ['bug'] }, fake, tok)
    expect(r).toEqual({ number: 7, url: 'https://github.com/yo/proj/pull/7', warning: null })
    expect(calls[0]).toEqual({ method: 'POST', url: '/pulls', body: { title: 'Mi PR', body: 'hola', head: 'feature', base: 'main', draft: true } })
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual(['POST /pulls/7/requested_reviewers', 'POST /issues/7/assignees', 'POST /issues/7/labels'])
    expect(calls[1]!.body).toEqual({ reviewers: ['ana'] })
  })

  it('si fallan los revisores o etiquetas, el PR queda creado y se avisa', async () => {
    extrasOk = false
    const r = await prCreate(repo, 'origin', { base: 'main', head: 'feature', title: 'X', body: '', draft: false, reviewers: ['ana'], assignees: [], labels: ['bug'] }, fake, tok)
    extrasOk = true
    expect(r.number).toBe(7)
    expect(r.warning).toMatch(/revisores, etiquetas/)
  })

  it('PR repetido, sin commits y sin permiso se explican', async () => {
    const req = { base: 'main', head: 'feature', title: 'X', body: '', draft: false, reviewers: [], assignees: [], labels: [] }
    createStatus = 422
    createBody = { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for yo:feature.' }] }
    await expect(prCreate(repo, 'origin', req, fake, tok)).rejects.toMatchObject({ appError: { message: expect.stringMatching(/Ya hay un pull request/) } })
    createBody = { message: 'Validation Failed', errors: [{ message: 'No commits between main and feature' }] }
    await expect(prCreate(repo, 'origin', req, fake, tok)).rejects.toMatchObject({ appError: { message: expect.stringMatching(/No hay commits nuevos/) } })
    createStatus = 403
    createBody = { message: 'Forbidden' }
    await expect(prCreate(repo, 'origin', req, fake, tok)).rejects.toMatchObject({ appError: { message: expect.stringMatching(/no tiene permiso/) } })
  })

  it('sin sesión de GitHub lo dice, y un remoto que no es de GitHub se rechaza', async () => {
    await expect(prPrepare(repo, undefined, undefined, fake, async () => null)).rejects.toMatchObject({ appError: { message: expect.stringMatching(/No hay sesión/) } })
    git(repo, ['remote', 'add', 'gl', 'https://gitlab.com/yo/proj.git'])
    await expect(prCreate(repo, 'gl', { base: 'main', head: 'feature', title: 'X', body: '', draft: false, reviewers: [], assignees: [], labels: [] }, fake, tok)).rejects.toMatchObject({ appError: { message: expect.stringMatching(/solo funciona con GitHub/) } })
  })

  it('las plantillas se leen de .github, la raíz, docs y las carpetas de plantillas', () => {
    mkdirSync(join(repo, '.github', 'PULL_REQUEST_TEMPLATE'), { recursive: true })
    writeFileSync(join(repo, '.github', 'PULL_REQUEST_TEMPLATE', 'bug.md'), 'bug\n')
    writeFileSync(join(repo, 'pull_request_template.md'), 'raiz\n')
    expect(prTemplates(repo).map((t) => t.name).sort()).toEqual(['.github/PULL_REQUEST_TEMPLATE/bug.md', '.github/pull_request_template.md', 'pull_request_template.md'])
  })
})
