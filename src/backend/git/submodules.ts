import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppException } from '@shared/errors'
import type { Submodule } from '@shared/refs'
import { checkUrl } from './remotes'
import { runGit } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

const ms = (t0: number) => Math.round(performance.now() - t0)

/** Nombre y URL de cada submódulo declarado en `.gitmodules`, por ruta. */
async function declared(root: string): Promise<Map<string, { name: string; url: string }>> {
  const out = new Map<string, { name: string; url: string }>()
  if (!existsSync(join(root, '.gitmodules'))) return out
  const r = await runGit(['config', '-f', '.gitmodules', '--get-regexp', String.raw`^submodule\..*\.(path|url)$`], { cwd: root })
  const byName = new Map<string, { path?: string; url?: string }>()
  for (const line of r.stdout.split('\n')) {
    const m = /^submodule\.(.+)\.(path|url) (.*)$/.exec(line.replace(/\r$/, ''))
    if (!m) continue
    const e = byName.get(m[1]!) ?? {}
    e[m[2] as 'path' | 'url'] = m[3]!
    byName.set(m[1]!, e)
  }
  for (const [name, e] of byName) if (e.path) out.set(e.path, { name, url: e.url ?? '' })
  return out
}

/**
 * Los submódulos del repo con su estado: `uncommitted` (agregado y todavía sin commit), `uninitialized`,
 * `outOfSync` (otro commit del que guarda el padre), `conflict` u `ok`. Sin `.gitmodules` no corre ningún git.
 */
export async function listSubmodules(root: string): Promise<Submodule[]> {
  const info = await declared(root)
  if (info.size === 0) return []
  const status = (await runGit(['submodule', 'status'], { cwd: root })).stdout
  const list: Submodule[] = []
  for (const line of status.split('\n')) {
    const m = /^([ +\-U])([0-9a-f]+) (.+?)(?: \(.*\))?\r?$/.exec(line)
    if (!m) continue
    const path = m[3]!
    const meta = info.get(path)
    const inHead = (await runGit(['ls-tree', '--name-only', 'HEAD', '--', path], { cwd: root })).stdout.trim() !== ''
    const state: Submodule['state'] = !inHead ? 'uncommitted' : m[1] === '-' ? 'uninitialized' : m[1] === '+' ? 'outOfSync' : m[1] === 'U' ? 'conflict' : 'ok'
    const date = m[1] === '-' ? null : (await runGit(['log', '-1', '--format=%cI'], { cwd: join(root, path) })).stdout.trim() || null
    list.push({ name: meta?.name ?? path, path, url: meta?.url ?? '', hash: m[2]!.slice(0, 7), date, state })
  }
  return list
}

/** Ruta relativa dentro del repo: sin `..`, sin `.git`, sin unidad ni barra inicial, sin empezar por «-». */
function checkPath(root: string, raw: string): string {
  const p = raw.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = p.split('/')
  if (!p || p.startsWith('-') || /^([A-Za-z]:|\/)/.test(p) || /[\0\r\n]/.test(p) || parts.some((s) => s === '' || s === '..' || s === '.' || s.toLowerCase() === '.git')) {
    throw fail('Esa ruta no sirve para un submódulo.', 'Escribe una carpeta dentro del repo, por ejemplo libs/mi-modulo.')
  }
  if (existsSync(join(root, p))) throw fail(`La carpeta «${p}» ya existe en el repo.`, 'Elige otra carpeta para el submódulo.')
  return p
}

/** «Add Submodule»: clona la URL en la carpeta dada y deja `.gitmodules` y el submódulo en el índice (sin commit). */
export async function addSubmodule(root: string, url: string, path: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  const u = checkUrl(url, 'un submódulo')
  const p = checkPath(root, path)
  const r = await runGit(['submodule', 'add', '--', u, p], { cwd: root, timeoutMs: 30 * 60_000 })
  if (r.code !== 0) throw fail('No se pudo agregar el submódulo.', 'Revisa la URL y tus credenciales.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}

/** «Initialize» (`init`) o «Update» de un submódulo: lo deja en el commit que guarda el padre. */
export async function updateSubmodule(root: string, path: string, init: boolean): Promise<{ ms: number }> {
  const t0 = performance.now()
  const p = path.trim().replace(/\\/g, '/')
  if (!(await listSubmodules(root)).some((s) => s.path === p)) throw fail('Esa ruta no es un submódulo de este repo.', 'El panel se actualiza solo; vuelve a intentarlo sobre uno que se vea.')
  const r = await runGit(['submodule', 'update', ...(init ? ['--init'] : []), '--', p], { cwd: root, timeoutMs: 30 * 60_000 })
  if (r.code !== 0) throw fail(init ? 'No se pudo inicializar el submódulo.' : 'No se pudo actualizar el submódulo.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}

async function mustExist(root: string, path: string): Promise<Submodule> {
  const p = path.trim().replace(/\\/g, '/')
  const sub = (await listSubmodules(root)).find((x) => x.path === p)
  if (!sub) throw fail('Esa ruta no es un submódulo de este repo.', 'El panel se actualiza solo; vuelve a intentarlo sobre uno que se vea.')
  return sub
}

/** «Edit Submodule»: cambia la URL remota (en `.gitmodules` y en la configuración del repo) y/o mueve la carpeta. */
export async function editSubmodule(root: string, path: string, url: string, newPath: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  const sub = await mustExist(root, path)
  const u = checkUrl(url, 'un submódulo')
  const np = newPath.trim().replace(/\\/g, '/').replace(/\/+$/, '') === sub.path ? sub.path : checkPath(root, newPath)
  if (u !== sub.url) {
    const c = await runGit(['config', '-f', '.gitmodules', `submodule.${sub.name}.url`, u], { cwd: root })
    if (c.code !== 0) throw fail('No se pudo cambiar la URL del submódulo.', 'Revisa la salida de git.', (c.stdout + c.stderr).trim())
    const y = await runGit(['submodule', 'sync', '--', sub.path], { cwd: root })
    if (y.code !== 0) throw fail('La URL se cambió en .gitmodules, pero no se pudo sincronizar.', 'Ejecuta git submodule sync.', (y.stdout + y.stderr).trim())
    // como al agregar, el cambio de .gitmodules queda en el índice (y `git mv` lo exige)
    await runGit(['add', '--', '.gitmodules'], { cwd: root })
  }
  if (np !== sub.path) {
    mkdirSync(dirname(join(root, np)), { recursive: true })
    const m = await runGit(['mv', '--', sub.path, np], { cwd: root })
    if (m.code !== 0) throw fail('No se pudo mover el submódulo.', 'Revisa la salida de git.', (m.stdout + m.stderr).trim())
  }
  return { ms: ms(t0) }
}

/** «Delete this submodule»: lo desregistra y lo quita del árbol y de `.gitmodules` (queda en el índice como borrado). */
export async function deleteSubmodule(root: string, path: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  const sub = await mustExist(root, path)
  const d = await runGit(['submodule', 'deinit', '-f', '--', sub.path], { cwd: root })
  if (d.code !== 0) throw fail('No se pudo desinicializar el submódulo.', 'Revisa la salida de git.', (d.stdout + d.stderr).trim())
  const r = await runGit(['rm', '-f', '--', sub.path], { cwd: root })
  if (r.code !== 0) throw fail('No se pudo quitar el submódulo.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}
