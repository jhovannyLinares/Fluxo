import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { azureProjects, createRemoteRepo, savedToken } from '../../src/backend/git/remote-create'
import { git, tempDir } from '../fixtures/make-repo'

/** GitHub y Azure DevOps simulados con un servidor local: el cuerpo, las cabeceras y los códigos de error. */
describe('crear el repo remoto desde Init', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-rc-')
  const base = () => realpathSync.native(tmp.dir)
  let server: Server
  let api = ''
  let bare = ''
  const seen: { method: string; url: string; auth: string; body: string }[] = []
  let status = 201

  beforeAll(async () => {
    bare = join(base(), 'servidor.git')
    git(tmp.dir, ['init', '-q', '--bare', bare])
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', auth: String(req.headers.authorization ?? ''), body })
        res.setHeader('Content-Type', 'application/json')
        res.statusCode = status
        if (req.url?.includes('/_apis/projects')) return void res.end(JSON.stringify({ value: [{ name: 'Zeta' }, { name: 'Alfa' }] }))
        const file = bare.replace(/\\/g, '/')
        res.end(JSON.stringify({ clone_url: file, html_url: 'https://github.com/yo/nuevo', remoteUrl: file, webUrl: 'https://dev.azure.com/o/p/_git/nuevo' }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    api = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => {
    server.close()
    tmp.cleanup()
  })

  const nueva = (n: string) => {
    const d = join(base(), n)
    mkdirSync(d)
    return d
  }
  const deps = () => ({ githubApi: api, azureApi: api, token: async () => 'ghp_secreto', fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => fetch(url, init).then((r) => ({ status: r.status, text: () => r.text() })) })

  it('GitHub: crea el repo con nombre, descripción y visibilidad, y sube la rama inicial', async () => {
    status = 201
    seen.length = 0
    const parent = nueva('p1')
    const r = await createRemoteRepo({ provider: 'github', account: 'yo', name: 'nuevo', description: 'prueba', private: true, parent, gitignore: 'Node', license: 'MIT License' }, deps())
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/user/repos', auth: 'Bearer ghp_secreto' })
    expect(JSON.parse(seen[0]!.body)).toEqual({ name: 'nuevo', description: 'prueba', private: true })
    expect(r.path).toBe(join(parent, 'nuevo'))
    expect(r.webUrl).toBe('https://github.com/yo/nuevo')
    expect(git(r.path!, ['remote', 'get-url', 'origin']).trim()).toMatch(/servidor\.git$/)
    expect(git(bare, ['log', '--format=%s', 'main']).trim()).toBe('Initial commit')
    expect(existsSync(join(r.path!, 'LICENSE.md'))).toBe(true)
  })

  it('sin «Clone after init» solo crea el repo en el servidor', async () => {
    status = 201
    const r = await createRemoteRepo({ provider: 'github', account: 'yo', name: 'solo-remoto' }, deps())
    expect(r.path).toBeNull()
  })

  it('un nombre que ya existe (422) se explica y no deja carpeta local', async () => {
    status = 422
    const parent = nueva('p2')
    await expect(createRemoteRepo({ provider: 'github', account: 'yo', name: 'repetido', parent }, deps())).rejects.toMatchObject({ appError: { message: expect.stringMatching(/ya existe/i) } })
    expect(existsSync(join(parent, 'repetido'))).toBe(false)
  })

  it('una credencial rechazada (401) lo dice', async () => {
    status = 401
    await expect(createRemoteRepo({ provider: 'github', account: 'yo', name: 'x', parent: nueva('p3') }, deps())).rejects.toMatchObject({ appError: { message: expect.stringMatching(/rechaz/i) } })
  })

  it('una plantilla inexistente se rechaza antes de llamar al servidor', async () => {
    status = 201
    seen.length = 0
    await expect(createRemoteRepo({ provider: 'github', account: 'yo', name: 'y', parent: nueva('p4'), gitignore: 'NoExiste' }, deps())).rejects.toThrow()
    expect(seen).toHaveLength(0)
  })

  it('un nombre inválido para GitHub no llega al servidor', async () => {
    seen.length = 0
    await expect(createRemoteRepo({ provider: 'github', account: 'yo', name: 'con espacio' }, deps())).rejects.toThrow()
    expect(seen).toHaveLength(0)
  })

  it('Azure DevOps: lista los proyectos ordenados y crea el repo dentro del elegido', async () => {
    status = 200
    seen.length = 0
    expect(await azureProjects('mi-org', 'yo@x.com', deps())).toEqual(['Alfa', 'Zeta'])
    expect(seen[0]!.auth).toMatch(/^Basic /)
    seen.length = 0
    const r = await createRemoteRepo({ provider: 'azure', account: 'yo@x.com', org: 'mi-org', project: 'Mi Proyecto', name: 'nuevo-az' }, deps())
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/mi-org/Mi%20Proyecto/_apis/git/repositories?api-version=7.1' })
    expect(JSON.parse(seen[0]!.body)).toEqual({ name: 'nuevo-az' })
    expect(r.webUrl).toContain('_git')
  })

  it('Azure DevOps sin proyecto elegido se rechaza', async () => {
    await expect(createRemoteRepo({ provider: 'azure', account: 'a', org: 'o', name: 'n' }, deps())).rejects.toThrow()
  })

  it('la credencial sale de «git credential fill» y sin ella se explica', async () => {
    const run = async (args: readonly string[], o?: { input?: string }) => ({ stdout: o?.input?.includes('host=github.com') ? 'password=tok123\n' : '', stderr: '', code: args[0] === 'credential' ? 0 : 1 })
    expect(await savedToken('github.com', 'yo', run)).toBe('tok123')
    await expect(savedToken('dev.azure.com', 'yo', run)).rejects.toMatchObject({ appError: { message: expect.stringMatching(/sesión guardada/) } })
  })
})
