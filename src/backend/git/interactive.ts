import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppException } from '@shared/errors'
import { gitDirOf, readOperation } from './operation'
import { runGit } from './runner'
import { applyStash, createStash } from './stash'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

const ms = (t0: number) => Math.round(performance.now() - t0)
const fwd = (p: string) => p.replace(/\\/g, '/')

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'drop'
export interface RebaseStep {
  hash: string
  action: RebaseAction
  message?: string
}

/** Commits de la rama actual que no están en `ref`, del más viejo al más nuevo (lo que se reordena). */
export async function rebasePlan(root: string, ref: string): Promise<{ commits: { hash: string; subject: string }[] }> {
  if ((await runGit(['show-ref', '--verify', '-q', ref], { cwd: root })).code !== 0) {
    throw fail('Esa rama ya no existe.', 'El grafo se actualiza solo; vuelve a intentarlo sobre la rama que se ve ahora.')
  }
  if (!(await runGit(['symbolic-ref', '-q', 'HEAD'], { cwd: root })).stdout.trim()) {
    throw fail('No estás en una rama.', 'Cámbiate a una rama antes de hacer un rebase interactivo.')
  }
  const merges = (await runGit(['rev-list', '--merges', '--count', `${ref}..HEAD`], { cwd: root })).stdout.trim()
  if (merges !== '0') throw fail('La rama tiene merge commits.', 'GitKraken tampoco ofrece el rebase interactivo ahí.')
  const out = (await runGit(['log', '--reverse', '--format=%H%x00%s', '--end-of-options', `${ref}..HEAD`], { cwd: root })).stdout
  const commits = out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subject] = l.split('\0')
      return { hash: hash!, subject: subject ?? '' }
    })
  if (commits.length === 0) throw fail('No hay commits que reordenar.', 'La rama actual no tiene nada que no esté ya en la otra.')
  return { commits }
}

/**
 * Rebase interactivo de la rama actual sobre `ref`. Se escribe la lista de pasos y se la entrega a `git rebase -i`
 * (así Abort / Continue / Skip funcionan igual que en cualquier rebase). Los reword se hacen con un `exec` que
 * enmienda el commit recién aplicado; los squash conservan el mensaje combinado que arma git.
 */
export async function rebaseInteractive(
  root: string,
  ref: string,
  steps: RebaseStep[]
): Promise<{ status: 'done' | 'conflict'; stashed: boolean; ms: number }> {
  const t0 = performance.now()
  if (await readOperation(root, await gitDirOf(root))) {
    throw fail('Hay una operación a medias en este repo.', 'Termínala o abórtala antes de empezar otra.')
  }
  const plan = (await rebasePlan(root, ref)).commits
  const wanted = new Set(plan.map((c) => c.hash))
  if (steps.length !== plan.length || new Set(steps.map((s) => s.hash)).size !== steps.length || steps.some((s) => !wanted.has(s.hash))) {
    throw fail('La lista de commits ya no coincide con la rama.', 'Vuelve a abrir el rebase interactivo para ver los commits de ahora.')
  }
  const firstKept = steps.find((s) => s.action !== 'drop')
  if (firstKept?.action === 'squash') throw fail('El primer commit no se puede unir (squash) con uno anterior.', 'Déjalo en Pick o cámbialo de lugar.')
  if (steps.some((s) => s.action === 'reword' && !s.message?.trim())) throw fail('Un commit en Reword necesita su mensaje nuevo.', 'Escribe el mensaje o déjalo en Pick.')

  const dir = mkdtempSync(join(tmpdir(), 'fluxo-rebase-'))
  try {
    const lines: string[] = []
    steps.forEach((s, i) => {
      if (s.action === 'drop') lines.push(`drop ${s.hash}`)
      else if (s.action === 'squash') lines.push(`squash ${s.hash}`)
      else {
        lines.push(`pick ${s.hash}`)
        if (s.action === 'reword') {
          const file = join(dir, `msg${i}.txt`)
          writeFileSync(file, s.message!.trim() + '\n')
          lines.push(`exec git commit --amend -q -F "${fwd(file)}"`)
        }
      }
    })
    const todo = join(dir, 'todo.txt')
    writeFileSync(todo, lines.join('\n') + '\n')

    const cur = (await runGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root })).stdout.trim()
    const dirty = (await runGit(['status', '--porcelain=v1', '-uall'], { cwd: root })).stdout.trim() !== ''
    const stash = dirty
      ? (await createStash(root, { message: `Auto stash before rebase of "${cur}" onto "${ref.replace(/^refs\/(heads|remotes)\//, '')}"`, includeUntracked: true })).hash
      : null

    const r = await runGit(['rebase', '-i', '--end-of-options', ref], {
      cwd: root,
      timeoutMs: 300_000,
      env: { GIT_SEQUENCE_EDITOR: `cp "${fwd(todo)}"`, GIT_EDITOR: 'true' }
    })
    if (r.code !== 0) {
      if (await readOperation(root, await gitDirOf(root))) return { status: 'conflict', stashed: stash !== null, ms: ms(t0) }
      if (stash) await applyStash(root, stash, true).catch(() => undefined)
      throw fail('No se pudo hacer el rebase interactivo.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
    }
    if (stash) {
      try {
        await applyStash(root, stash, true)
      } catch {
        return { status: 'conflict', stashed: true, ms: ms(t0) }
      }
    }
    return { status: 'done', stashed: stash !== null, ms: ms(t0) }
  } finally {
    // con un conflicto el rebase sigue leyendo los mensajes de los `exec` pendientes: se dejan en el directorio temporal
    if (!(await readOperation(root, await gitDirOf(root)).catch(() => null))) rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * «Move commit up / down»: intercambia un commit con su vecino (arriba = el más nuevo, abajo = el más viejo) de la historia
 * de la rama actual. Se hace con un `git rebase -i` de solo `pick` para que Abort / Continue / Skip funcionen igual si choca.
 */
export async function moveCommit(root: string, hash: string, dir: 'up' | 'down'): Promise<{ status: 'done' | 'conflict'; stashed: boolean; ms: number }> {
  const t0 = performance.now()
  if (await readOperation(root, await gitDirOf(root))) {
    throw fail('Hay una operación a medias en este repo.', 'Termínala o abórtala antes de mover un commit.')
  }
  if (!(await runGit(['symbolic-ref', '-q', 'HEAD'], { cwd: root })).stdout.trim()) {
    throw fail('No estás en una rama.', 'Cámbiate a una rama antes de mover un commit.')
  }
  const full = (await runGit(['rev-parse', '-q', '--verify', '--end-of-options', `${hash}^{commit}`], { cwd: root })).stdout.trim()
  if (!full) throw fail('Ese commit ya no existe.', 'El grafo se actualiza solo; vuelve a intentarlo.')
  const chain = (await runGit(['rev-list', '--first-parent', 'HEAD'], { cwd: root })).stdout.split('\n').filter(Boolean)
  const i = chain.indexOf(full)
  if (i < 0) throw fail('Ese commit no está en la rama actual.', 'Cámbiate a la rama que lo tiene y vuelve a intentarlo.')
  const j = dir === 'up' ? i - 1 : i + 1
  if (j < 0) throw fail('Ya es el último commit de la rama: no hay uno más nuevo con quien intercambiarse.', 'Solo se puede bajar.')
  const older = Math.max(i, j)
  const onto = older + 1 < chain.length ? chain[older + 1]! : null
  if (!onto) throw fail('Es el primer commit de la rama: no tiene anterior sobre el que apoyar el cambio.', 'Mueve otro commit.')
  const merges = (await runGit(['rev-list', '--merges', '--count', `${onto}..HEAD`], { cwd: root })).stdout.trim()
  if (merges !== '0') throw fail('Hay un merge entre esos commits y la punta de la rama.', 'Reordenar ahí aplanaría el merge; hazlo desde la terminal con git rebase --rebase-merges.')

  const order = chain.slice(0, older + 1).reverse()
  const a = order.indexOf(chain[i]!)
  const b = order.indexOf(chain[j]!)
  ;[order[a], order[b]] = [order[b]!, order[a]!]

  const dirTmp = mkdtempSync(join(tmpdir(), 'fluxo-move-'))
  try {
    const todo = join(dirTmp, 'todo.txt')
    writeFileSync(todo, order.map((h) => `pick ${h}`).join('\n') + '\n')
    const cur = (await runGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root })).stdout.trim()
    const dirty = (await runGit(['status', '--porcelain=v1', '-uall'], { cwd: root })).stdout.trim() !== ''
    const stash = dirty ? (await createStash(root, { message: `Auto stash before move of "${full.slice(0, 7)}" in "${cur}"`, includeUntracked: true })).hash : null
    const r = await runGit(['rebase', '-i', '--end-of-options', onto], {
      cwd: root,
      timeoutMs: 300_000,
      env: { GIT_SEQUENCE_EDITOR: `cp "${fwd(todo)}"`, GIT_EDITOR: 'true' }
    })
    if (r.code !== 0) {
      if (await readOperation(root, await gitDirOf(root))) return { status: 'conflict', stashed: stash !== null, ms: ms(t0) }
      if (stash) await applyStash(root, stash, true).catch(() => undefined)
      throw fail('No se pudo mover el commit.', 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
    }
    if (stash) {
      try {
        await applyStash(root, stash, true)
      } catch {
        return { status: 'conflict', stashed: true, ms: ms(t0) }
      }
    }
    return { status: 'done', stashed: stash !== null, ms: ms(t0) }
  } finally {
    rmSync(dirTmp, { recursive: true, force: true })
  }
}
