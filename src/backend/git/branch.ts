import { AppException } from '@shared/errors'
import { runGit } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

/**
 * «Create branch here»: rama local nueva en un commit, sin cambiarse a ella (GitKraken pide el nombre y la crea
 * ahí). Escritura de Fluxo: la llama `writeOp`. El nombre lo valida git; nunca pasa por un shell.
 */
export async function createBranch(root: string, name: string, at: string): Promise<{ ref: string; ms: number }> {
  const t0 = performance.now()
  if ((await runGit(['check-ref-format', '--branch', name], { cwd: root })).code !== 0 || name === '@') {
    throw fail(`«${name}» no es un nombre válido para una rama.`, 'Evita espacios, «..», «~», «^», «:» y que termine en «.lock».')
  }
  const ref = `refs/heads/${name}`
  if ((await runGit(['show-ref', '--verify', '-q', ref], { cwd: root })).code === 0) {
    throw fail(`La rama ${name} ya existe.`, 'Elige otro nombre; la existente no se movió.')
  }
  if ((await runGit(['cat-file', '-e', `${at}^{commit}`], { cwd: root })).code !== 0) {
    throw fail('Ese commit ya no está en el repo.', 'El grafo se actualiza solo; vuelve a intentarlo sobre un commit que se vea.')
  }
  const r = await runGit(['branch', '--no-track', '--end-of-options', name, at], { cwd: root })
  if (r.code !== 0) throw fail(`No se pudo crear la rama ${name}.`, 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ref, ms: Math.round(performance.now() - t0) }
}

async function assertValidName(root: string, name: string): Promise<void> {
  if ((await runGit(['check-ref-format', '--branch', name], { cwd: root })).code !== 0 || name === '@') {
    throw fail(`«${name}» no es un nombre válido para una rama.`, 'Evita espacios, «..», «~», «^», «:» y que termine en «.lock».')
  }
}

const exists = async (root: string, ref: string) => (await runGit(['show-ref', '--verify', '-q', ref], { cwd: root })).code === 0

const gone = () => fail('Esa rama ya no existe.', 'El grafo se actualiza solo; vuelve a intentarlo sobre la rama que se ve ahora.')

/** «Rename X»: `git branch -m`; si la rama es la actual, git mueve también HEAD. */
export async function renameBranch(root: string, from: string, to: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  await assertValidName(root, to)
  if (!(await exists(root, `refs/heads/${from}`))) throw gone()
  if (await exists(root, `refs/heads/${to}`)) throw fail(`La rama ${to} ya existe.`, 'Elige otro nombre; no se cambió nada.')
  const r = await runGit(['branch', '-m', '--end-of-options', from, to], { cwd: root })
  if (r.code !== 0) throw fail(`No se pudo renombrar ${from}.`, 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: Math.round(performance.now() - t0) }
}

/**
 * «Delete X»: la interfaz ya pidió confirmar. Local con `-D` (la rama puede no estar fusionada), remota con
 * `push --delete`. La rama actual no se borra: hay que cambiar de rama antes.
 */
export async function deleteBranch(
  root: string,
  name: string,
  scope: 'local' | 'remote' | 'both',
  remote?: string
): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (scope !== 'remote') {
    if (!(await exists(root, `refs/heads/${name}`))) throw gone()
    const cur = (await runGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root })).stdout.trim()
    if (cur === name) throw fail('Para borrar la rama actual hay que cambiar de rama antes.', 'Cámbiate a otra rama y vuelve a intentarlo.')
  }
  if (scope !== 'local') {
    if (!remote) throw fail('Falta el remoto de la rama.', 'Vuelve a intentarlo desde el menú de la rama remota.')
    const r = await runGit(['push', remote, '--delete', '--end-of-options', name], { cwd: root, timeoutMs: 120_000 })
    if (r.code !== 0) throw fail(`No se pudo borrar ${remote}/${name}.`, 'Revisa la conexión y tus permisos en el remoto.', (r.stdout + r.stderr).trim())
  }
  if (scope !== 'remote') {
    const r = await runGit(['branch', '-D', '--end-of-options', name], { cwd: root })
    if (r.code !== 0) throw fail(`No se pudo borrar la rama ${name}.`, 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  }
  return { ms: Math.round(performance.now() - t0) }
}

/** «Set Upstream»: la remota tiene que existir ya; no se crea nada en el servidor. */
export async function setUpstream(root: string, branch: string, remote: string, remoteBranch: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (!(await exists(root, `refs/heads/${branch}`))) throw gone()
  if (!(await exists(root, `refs/remotes/${remote}/${remoteBranch}`))) {
    throw fail(`${remote}/${remoteBranch} no existe.`, 'Haz push de la rama primero o haz fetch para ver las ramas del remoto.')
  }
  const r = await runGit(['branch', `--set-upstream-to=${remote}/${remoteBranch}`, '--end-of-options', branch], { cwd: root })
  if (r.code !== 0) throw fail('No se pudo asociar la rama.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: Math.round(performance.now() - t0) }
}
