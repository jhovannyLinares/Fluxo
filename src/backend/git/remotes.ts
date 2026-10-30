import { AppException } from '@shared/errors'
import { runGit } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

const ms = (t0: number) => Math.round(performance.now() - t0)
const NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/

export interface RemoteInfo {
  name: string
  pullUrl: string
  /** URL de push solo si es distinta de la de pull */
  pushUrl: string | null
}

/**
 * Una URL de remoto: http(s), ssh, git, `git@host:ruta` o una ruta local. Se rechazan las que git trataría como un
 * programa (`ext::`, `fd::`) o como una opción (`-x`), que ejecutarían comandos al hacer fetch.
 */
export function checkUrl(url: string, what = 'un remoto'): string {
  const u = url.trim()
  const ok = /^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[A-Za-z0-9._-]+@[^\s:]+:|[A-Za-z]:[\\/]|\/|\.{1,2}[\\/]|\\\\)/.test(u)
  if (!u || /[\0\r\n]/.test(u) || u.startsWith('-') || /^[A-Za-z][A-Za-z0-9+.-]*::/.test(u) || !ok) {
    throw fail(`Esa URL no es válida para ${what}.`, 'Usa una URL https, ssh o git, o la ruta de una carpeta.')
  }
  return u
}

function checkName(name: string): string {
  if (!NAME.test(name)) throw fail(`«${name}» no es un nombre válido para un remoto.`, 'Usa letras, números, «.», «_», «-» o «/», sin espacios.')
  return name
}

async function exists(root: string, name: string): Promise<boolean> {
  return (await runGit(['remote'], { cwd: root })).stdout.split('\n').includes(name)
}

const gone = () => fail('Ese remoto ya no existe.', 'El panel se actualiza solo; vuelve a intentarlo sobre un remoto que se vea.')

/** Los remotos del repo con su URL de pull y, si es otra, la de push. */
export async function listRemotes(root: string): Promise<RemoteInfo[]> {
  const names = (await runGit(['remote'], { cwd: root })).stdout.split('\n').filter(Boolean)
  const out: RemoteInfo[] = []
  for (const name of names) {
    const get = async (key: string) => (await runGit(['config', '--get-all', key], { cwd: root })).stdout.split('\n')[0]?.trim() || null
    const pullUrl = (await get(`remote.${name}.url`)) ?? ''
    const push = await get(`remote.${name}.pushurl`)
    out.push({ name, pullUrl, pushUrl: push && push !== pullUrl ? push : null })
  }
  return out
}

/** «Add Remote»: nombre, URL de pull y, opcional, de push. No hace fetch. */
export async function addRemote(root: string, name: string, pullUrl: string, pushUrl?: string | null): Promise<{ ms: number }> {
  const t0 = performance.now()
  checkName(name)
  const pull = checkUrl(pullUrl)
  const push = pushUrl ? checkUrl(pushUrl) : null
  if (await exists(root, name)) throw fail(`El remoto ${name} ya existe.`, 'Elige otro nombre; el existente no se tocó.')
  const r = await runGit(['remote', 'add', '--', name, pull], { cwd: root })
  if (r.code !== 0) throw fail(`No se pudo agregar el remoto ${name}.`, 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  if (push && push !== pull) await runGit(['remote', 'set-url', '--push', '--', name, push], { cwd: root })
  return { ms: ms(t0) }
}

/** «Edit Remote»: cambia el nombre y las URL. Sin URL de push, la quita. */
export async function editRemote(root: string, name: string, newName: string, pullUrl: string, pushUrl: string | null): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (!(await exists(root, name))) throw gone()
  checkName(newName)
  const pull = checkUrl(pullUrl)
  const push = pushUrl ? checkUrl(pushUrl) : null
  if (newName !== name && (await exists(root, newName))) throw fail(`El remoto ${newName} ya existe.`, 'Elige otro nombre; no se cambió nada.')
  const set = await runGit(['remote', 'set-url', '--', name, pull], { cwd: root })
  if (set.code !== 0) throw fail('No se pudo cambiar la URL.', 'Revisa la salida de git.', (set.stdout + set.stderr).trim())
  if (push && push !== pull) await runGit(['remote', 'set-url', '--push', '--', name, push], { cwd: root })
  else await runGit(['config', '--unset-all', `remote.${name}.pushurl`], { cwd: root })
  if (newName !== name) {
    const rn = await runGit(['remote', 'rename', '--', name, newName], { cwd: root })
    if (rn.code !== 0) throw fail('No se pudo renombrar el remoto.', 'Revisa la salida de git.', (rn.stdout + rn.stderr).trim())
  }
  return { ms: ms(t0) }
}

/** «Remove»: quita el remoto y sus ramas de seguimiento. La interfaz confirma antes. */
export async function removeRemote(root: string, name: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (!(await exists(root, name))) throw gone()
  const r = await runGit(['remote', 'remove', '--', name], { cwd: root })
  if (r.code !== 0) throw fail(`No se pudo quitar el remoto ${name}.`, 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}

/** «Fetch {remoto}»: trae solo ese remoto. */
export async function fetchRemote(root: string, name: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (!(await exists(root, name))) throw gone()
  const r = await runGit(['fetch', '--prune', '--end-of-options', name], { cwd: root, timeoutMs: 300_000, env: { GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' } })
  if (r.code !== 0) throw fail(`No se pudo hacer fetch de ${name}.`, 'Revisa la conexión y tus credenciales.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}
