import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { AppException } from '@shared/errors'
import { checkoutError } from './checkout'
import { gitDirOf, readOperation } from './operation'
import { runGit } from './runner'
import { applyStash, createStash } from './stash'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

const ms = (t0: number) => Math.round(performance.now() - t0)

async function assertCommit(root: string, hash: string): Promise<void> {
  if ((await runGit(['cat-file', '-e', `${hash}^{commit}`], { cwd: root })).code !== 0) {
    throw fail('Ese commit ya no está en el repo.', 'El grafo se actualiza solo; vuelve a intentarlo sobre un commit que se vea.')
  }
}

/**
 * «Reset {rama} to this commit»: soft deja los cambios en el stage, mixed los deja sin stage y hard los descarta.
 * La interfaz confirma el hard antes de llamar.
 */
export async function resetTo(root: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<{ ms: number }> {
  const t0 = performance.now()
  await assertCommit(root, hash)
  const r = await runGit(['reset', `--${mode}`, '--end-of-options', hash], { cwd: root, timeoutMs: 120_000 })
  if (r.code !== 0) throw fail('No se pudo mover la rama.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}

/**
 * «Revert commit»: un commit nuevo que deshace el cambio. Con cambios sin commit los guarda y los devuelve;
 * si el revert choca queda a medias (`conflict`) para resolverlo o abortar.
 */
export async function revertCommit(root: string, hash: string): Promise<{ status: 'done' | 'conflict'; stashed: boolean; ms: number }> {
  const t0 = performance.now()
  if (await readOperation(root, await gitDirOf(root))) {
    throw fail('Hay una operación a medias en este repo.', 'Termínala o abórtala antes de empezar otra.')
  }
  await assertCommit(root, hash)
  const dirty = (await runGit(['status', '--porcelain=v1', '-uall'], { cwd: root })).stdout.trim() !== ''
  const stash = dirty ? (await createStash(root, { message: `Auto stash before revert of "${hash.slice(0, 7)}"`, includeUntracked: true })).hash : null
  const parents = (await runGit(['rev-list', '--parents', '-n1', hash], { cwd: root })).stdout.trim().split(' ').length - 1
  const args = ['revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), '--end-of-options', hash]
  const r = await runGit(args, { cwd: root, timeoutMs: 120_000, env: { GIT_EDITOR: 'true' } })
  if (r.code !== 0) {
    if (await readOperation(root, await gitDirOf(root))) return { status: 'conflict', stashed: stash !== null, ms: ms(t0) }
    if (stash) await applyStash(root, stash, true).catch(() => undefined)
    throw fail('No se pudo revertir el commit.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  }
  if (stash) {
    try {
      await applyStash(root, stash, true)
    } catch {
      return { status: 'conflict', stashed: true, ms: ms(t0) }
    }
  }
  return { status: 'done', stashed: stash !== null, ms: ms(t0) }
}

/** «Create tag here» (ligera) y «Create annotated tag here» (con `message`). Nunca mueve una etiqueta existente. */
export async function createTag(root: string, hash: string, name: string, message?: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  if ((await runGit(['check-ref-format', `refs/tags/${name}`], { cwd: root })).code !== 0 || name.startsWith('-')) {
    throw fail(`«${name}» no es un nombre válido para una etiqueta.`, 'Evita espacios, «..», «~», «^», «:» y que termine en «.lock».')
  }
  if ((await runGit(['show-ref', '--verify', '-q', `refs/tags/${name}`], { cwd: root })).code === 0) {
    throw fail(`La etiqueta ${name} ya existe.`, 'Elige otro nombre; la existente no se movió.')
  }
  await assertCommit(root, hash)
  const args = message ? ['tag', '-a', '-m', message, '--end-of-options', name, hash] : ['tag', '--end-of-options', name, hash]
  const r = await runGit(args, { cwd: root })
  if (r.code !== 0) throw fail(`No se pudo crear la etiqueta ${name}.`, 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}

/** «Checkout this commit»: HEAD separado en ese commit. Si los cambios locales chocan, git no toca nada. */
export async function checkoutCommit(root: string, hash: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (await readOperation(root, await gitDirOf(root))) {
    throw fail('Hay una operación a medias en este repo.', 'Termínala o cancélala antes de cambiar de commit.')
  }
  await assertCommit(root, hash)
  const r = await runGit(['checkout', '--detach', '--quiet', hash], { cwd: root, timeoutMs: 120_000 })
  if (r.code !== 0) throw checkoutError(r.stdout + r.stderr, hash.slice(0, 7))
  return { ms: ms(t0) }
}

/** «Create worktree from…»: carpeta nueva con una rama (la que no esté abierta ya) o con un commit separado. */
export async function addWorktree(root: string, path: string, opts: { ref?: string; hash?: string; newBranch?: string }): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (!isAbsolute(path)) throw fail('La carpeta del worktree tiene que ser una ruta completa.', 'Escribe la ruta completa, por ejemplo C:\\trabajo\\mi-rama.')
  if (existsSync(path)) throw fail('Esa carpeta ya existe.', 'Elige una carpeta nueva; no se tocó nada.')
  // «Worktree branch to create»: vacía o igual a la rama que se saca = no se crea ninguna
  const newBranch = opts.newBranch?.trim() && opts.newBranch.trim() !== opts.ref ? opts.newBranch.trim() : null
  if (newBranch) {
    if ((await runGit(['check-ref-format', '--branch', newBranch])).code !== 0) throw fail(`«${newBranch}» no es un nombre de rama válido.`, 'Usa letras, números, guiones y barras; sin espacios.')
    if ((await runGit(['show-ref', '--verify', '-q', `refs/heads/${newBranch}`], { cwd: root })).code === 0) throw fail(`La rama ${newBranch} ya existe.`, 'Elige otro nombre, o déjalo vacío para sacar la rama que ya existe.')
  }
  let args: string[]
  if (opts.ref) {
    if ((await runGit(['show-ref', '--verify', '-q', `refs/heads/${opts.ref}`], { cwd: root })).code !== 0) {
      throw fail('Esa rama ya no existe.', 'El grafo se actualiza solo; vuelve a intentarlo sobre la rama que se ve ahora.')
    }
    args = newBranch ? ['worktree', 'add', '-b', newBranch, '--', path, opts.ref] : ['worktree', 'add', '--', path, opts.ref]
  } else if (opts.hash) {
    await assertCommit(root, opts.hash)
    args = newBranch ? ['worktree', 'add', '-b', newBranch, '--', path, opts.hash] : ['worktree', 'add', '--detach', '--', path, opts.hash]
  } else {
    throw fail('Falta la rama o el commit.', 'Vuelve a intentarlo desde el menú.')
  }
  const r = await runGit(args, { cwd: root, timeoutMs: 120_000 })
  if (r.code !== 0) {
    const out = (r.stdout + r.stderr).trim()
    if (/already (checked out|used by worktree)/i.test(out)) throw fail(`La rama ${opts.ref} ya está abierta en otro worktree.`, 'Ábrela desde el panel WORKTREES.', out)
    throw fail('No se pudo crear el worktree.', 'Revisa la salida de git.', out)
  }
  return { ms: ms(t0) }
}

async function assertNoMergesAbove(root: string, hash: string): Promise<void> {
  const merges = (await runGit(['rev-list', '--merges', '--count', `${hash}..HEAD`], { cwd: root })).stdout.trim()
  if (merges !== '0') {
    throw fail('Hay un merge entre ese commit y la punta de la rama.', 'Reescribir ahí aplanaría el merge; hazlo desde la terminal con git rebase --rebase-merges.')
  }
  if ((await runGit(['merge-base', '--is-ancestor', hash, 'HEAD'], { cwd: root })).code !== 0) {
    throw fail('Ese commit no está en la rama actual.', 'Cámbiate a la rama que lo tiene y vuelve a intentarlo.')
  }
}

/**
 * «Edit commit message»: reemplaza el mensaje y conserva autor, fecha y contenido. Si no es el último, los
 * commits siguientes se vuelven a colgar encima del nuevo; los cambios sin commit viajan intactos.
 */
export async function editMessage(root: string, hash: string, message: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  const text = message.trim()
  if (!text) throw fail('El mensaje no puede estar vacío.', 'Escribe el mensaje del commit.')
  if (await readOperation(root, await gitDirOf(root))) {
    throw fail('Hay una operación a medias en este repo.', 'Termínala o cancélala antes de editar un commit.')
  }
  await assertCommit(root, hash)
  if (!(await runGit(['symbolic-ref', '-q', 'HEAD'], { cwd: root })).stdout.trim()) {
    throw fail('No estás en una rama.', 'Cámbiate a una rama antes de editar un commit.')
  }
  await assertNoMergesAbove(root, hash)
  const info = (await runGit(['show', '-s', '--format=%an%x00%ae%x00%aI%x00%P%x00%T', hash], { cwd: root })).stdout.trim().split('\0')
  const [an, ae, ad, parents, tree] = info
  const parentArgs = (parents ?? '').split(' ').filter(Boolean).flatMap((p) => ['-p', p])
  const made = await runGit(['commit-tree', tree!, ...parentArgs, '-m', text], {
    cwd: root,
    env: { GIT_AUTHOR_NAME: an!, GIT_AUTHOR_EMAIL: ae!, GIT_AUTHOR_DATE: ad! }
  })
  if (made.code !== 0) throw fail('No se pudo escribir el commit nuevo.', 'Revisa la salida de git.', (made.stdout + made.stderr).trim())
  const fresh = made.stdout.trim()
  const head = (await runGit(['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
  const r =
    head === (await runGit(['rev-parse', `${hash}^{commit}`], { cwd: root })).stdout.trim()
      ? await runGit(['reset', '--soft', fresh], { cwd: root })
      : await runGit(['rebase', '--autostash', '--onto', fresh, hash], { cwd: root, timeoutMs: 300_000, env: { GIT_EDITOR: 'true' } })
  if (r.code !== 0) throw fail('No se pudo reescribir el mensaje.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}

/** «Drop commit»: quita el commit de la rama actual con un rebase; si choca queda a medias (`conflict`). */
export async function dropCommit(root: string, hash: string): Promise<{ status: 'done' | 'conflict'; stashed: boolean; ms: number }> {
  const t0 = performance.now()
  if (await readOperation(root, await gitDirOf(root))) {
    throw fail('Hay una operación a medias en este repo.', 'Termínala o cancélala antes de quitar un commit.')
  }
  await assertCommit(root, hash)
  if (!(await runGit(['symbolic-ref', '-q', 'HEAD'], { cwd: root })).stdout.trim()) {
    throw fail('No estás en una rama.', 'Cámbiate a una rama antes de quitar un commit.')
  }
  await assertNoMergesAbove(root, hash)
  if ((await runGit(['rev-parse', '-q', '--verify', `${hash}^`], { cwd: root })).code !== 0) {
    throw fail('El primer commit del repo no se puede quitar.', 'No tiene un commit anterior sobre el que apoyar el resto.')
  }
  const dirty = (await runGit(['status', '--porcelain=v1', '-uall'], { cwd: root })).stdout.trim() !== ''
  const stash = dirty ? (await createStash(root, { message: `Auto stash before drop of "${hash.slice(0, 7)}"`, includeUntracked: true })).hash : null
  const r = await runGit(['rebase', '--onto', `${hash}^`, hash], { cwd: root, timeoutMs: 300_000, env: { GIT_EDITOR: 'true' } })
  if (r.code !== 0) {
    if (await readOperation(root, await gitDirOf(root))) return { status: 'conflict', stashed: stash !== null, ms: ms(t0) }
    if (stash) await applyStash(root, stash, true).catch(() => undefined)
    throw fail('No se pudo quitar el commit.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  }
  if (stash) {
    try {
      await applyStash(root, stash, true)
    } catch {
      return { status: 'conflict', stashed: true, ms: ms(t0) }
    }
  }
  return { status: 'done', stashed: stash !== null, ms: ms(t0) }
}

const tagGone = () => fail('Esa etiqueta ya no existe.', 'El panel se actualiza solo; vuelve a intentarlo sobre una etiqueta que se vea.')

async function tagExists(root: string, name: string): Promise<boolean> {
  return (await runGit(['show-ref', '--verify', '-q', `refs/tags/${name}`], { cwd: root })).code === 0
}

async function defaultRemote(root: string, wanted?: string): Promise<string> {
  const remotes = (await runGit(['remote'], { cwd: root })).stdout.split('\n').filter(Boolean)
  const remote = wanted ?? (remotes.includes('origin') ? 'origin' : remotes[0])
  if (!remote || !remotes.includes(remote)) throw fail('Este repo no tiene ese remoto.', 'Configura un remoto antes de subir o borrar etiquetas.')
  return remote
}

/** «Delete» de un tag (local, remoto o los dos). No se deshace: la interfaz confirma antes. */
export async function deleteTag(root: string, name: string, scope: 'local' | 'remote' | 'both', remote?: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (name.startsWith('-') || (await runGit(['check-ref-format', `refs/tags/${name}`], { cwd: root })).code !== 0) {
    throw fail(`«${name}» no es un nombre válido para una etiqueta.`, 'Evita espacios, «..», «~», «^», «:» y que termine en «.lock».')
  }
  if (scope !== 'remote' && !(await tagExists(root, name))) throw tagGone()
  if (scope !== 'local') {
    const to = await defaultRemote(root, remote)
    const r = await runGit(['push', to, '--delete', '--end-of-options', `refs/tags/${name}`], { cwd: root, timeoutMs: 120_000 })
    if (r.code !== 0) throw fail(`No se pudo borrar ${name} en ${to}.`, 'Revisa la conexión y tus permisos en el remoto.', (r.stdout + r.stderr).trim())
  }
  if (scope !== 'remote') {
    const r = await runGit(['tag', '-d', '--end-of-options', name], { cwd: root })
    if (r.code !== 0) throw fail(`No se pudo borrar la etiqueta ${name}.`, 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  }
  return { ms: ms(t0) }
}

/** «Push tag»: sube una etiqueta local al remoto (por defecto `origin`). */
export async function pushTag(root: string, name: string, remote?: string): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (!(await tagExists(root, name))) throw tagGone()
  const to = await defaultRemote(root, remote)
  const r = await runGit(['push', to, '--end-of-options', `refs/tags/${name}`], { cwd: root, timeoutMs: 120_000 })
  if (r.code !== 0) throw fail(`No se pudo subir ${name}.`, 'Revisa la conexión y tus permisos en el remoto.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}

/** Nombres de los tags que el remoto ya tiene (para ofrecer «Push tag» solo en los que son locales). Sin red, vacío. */
export async function tagsOnRemote(root: string): Promise<{ names: string[]; remote: string | null }> {
  let remote: string
  try {
    remote = await defaultRemote(root)
  } catch {
    return { names: [], remote: null }
  }
  const r = await runGit(['ls-remote', '--tags', '--refs', remote], { cwd: root, timeoutMs: 20_000, env: { GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' } })
  if (r.code !== 0) return { names: [], remote }
  const names = r.stdout
    .split('\n')
    .map((l) => /refs\/tags\/(.+)$/.exec(l)?.[1])
    .filter((x): x is string => !!x)
  return { names, remote }
}

function safeRel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  if (!path || isAbsolute(path) || parts.includes('..') || parts.some((p) => p.toLowerCase() === '.git')) {
    throw fail('Esa ruta no está dentro del repo.', 'Usa una ruta relativa a la raíz, sin «..» ni la carpeta .git.')
  }
  return parts.join('/')
}

/** «Restore file from this commit»: trae esos archivos como estaban en el commit al árbol de trabajo (el stage no cambia). */
export async function restoreFiles(root: string, hash: string, paths: string[]): Promise<{ ms: number }> {
  const t0 = performance.now()
  await assertCommit(root, hash)
  const rels = paths.map(safeRel)
  for (const rel of rels) {
    if ((await runGit(['cat-file', '-e', `${hash}:${rel}`], { cwd: root })).code !== 0) {
      throw fail(`Ese commit no tiene ese archivo: ${rel}.`, 'Si se creó después, no hay nada que restaurar de este commit.')
    }
  }
  const r = await runGit(['--literal-pathspecs', 'restore', '--source', hash, '--worktree', '--', ...rels], { cwd: root })
  if (r.code !== 0) throw fail('No se pudo restaurar el archivo.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  return { ms: ms(t0) }
}
