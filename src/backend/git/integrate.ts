import { AppException } from '@shared/errors'
import { gitDirOf, readOperation } from './operation'
import { runGit } from './runner'
import { applyStash, createStash } from './stash'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

const ms = (t0: number) => Math.round(performance.now() - t0)
const short = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, '')

export type IntegrateKind = 'ff' | 'merge' | 'rebase'

/**
 * Fast-forward / Merge / Rebase de la rama actual con `ref`, como GitKraken: sin confirmar, con los cambios sin
 * commit guardados solos en «Auto stash before …» y reaplicados al terminar. Si queda un conflicto (o el pop
 * choca), el stash se conserva y la respuesta es `conflict`; la operación queda a medias para resolverla o abortar.
 */
export async function integrate(
  root: string,
  kind: IntegrateKind,
  ref: string
): Promise<{ status: 'done' | 'conflict'; stashed: boolean; ms: number }> {
  const t0 = performance.now()
  if (await readOperation(root, await gitDirOf(root))) {
    throw fail('Hay una operación a medias en este repo.', 'Termínala o abórtala antes de empezar otra; el aviso de arriba del grafo dice cómo.')
  }
  if ((await runGit(['show-ref', '--verify', '-q', ref], { cwd: root })).code !== 0) {
    throw fail('Esa rama ya no existe.', 'El grafo se actualiza solo; vuelve a intentarlo sobre la rama que se ve ahora.')
  }
  const cur = (await runGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root })).stdout.trim()
  if (!cur) throw fail('No estás en una rama.', 'Cámbiate a una rama antes de integrar otra.')

  const dirty = (await runGit(['status', '--porcelain=v1', '-uall'], { cwd: root })).stdout.trim() !== ''
  let stash: string | null = null
  if (dirty) {
    const other = short(ref)
    const message =
      kind === 'rebase' ? `Auto stash before rebase of "${cur}" onto "${other}"` : `Auto stash before merge of "${cur}" and "${other}"`
    stash = (await createStash(root, { message, includeUntracked: true })).hash
  }

  const args =
    kind === 'ff'
      ? ['merge', '--ff-only', '--end-of-options', ref]
      : kind === 'merge'
        ? ['merge', '--no-edit', '--end-of-options', ref]
        : ['rebase', '--end-of-options', ref]
  const r = await runGit(args, { cwd: root, timeoutMs: 300_000, env: { GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' } })
  if (r.code !== 0) {
    if (await readOperation(root, await gitDirOf(root))) return { status: 'conflict', stashed: stash !== null, ms: ms(t0) }
    if (stash) await applyStash(root, stash, true).catch(() => undefined)
    const out = (r.stdout + r.stderr).trim()
    if (kind === 'ff') throw fail('No se puede avanzar en línea recta (fast-forward).', 'Las ramas se separaron: usa Merge o Rebase.', out)
    throw fail(`No se pudo ${kind === 'merge' ? 'fusionar' : 'rebasar'}.`, 'Revisa la salida de git.', out)
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

/** Abort / Continue / Skip de la operación a medias. `continue` no abre el editor del mensaje. */
export async function operation(root: string, action: 'abort' | 'continue' | 'skip'): Promise<{ ms: number }> {
  const t0 = performance.now()
  const op = await readOperation(root, await gitDirOf(root))
  if (!op) throw fail('No hay ninguna operación a medias.', 'El grafo se actualiza solo.')
  const cmd = op.kind === 'cherry-pick' || op.kind === 'revert' || op.kind === 'rebase' || op.kind === 'merge' ? op.kind : null
  if (!cmd) throw fail(`Una ${op.kind} a medias no se maneja desde aquí.`, 'Termínala en la terminal.')
  if (action === 'skip' && cmd === 'merge') throw fail('Un merge no se puede saltar.', 'Aborta el merge o resuelve el conflicto.')
  if (action === 'continue' && cmd === 'merge') {
    const r = await runGit(['commit', '--no-edit'], { cwd: root, env: { GIT_EDITOR: 'true' } })
    if (r.code !== 0) throw fail('No se pudo terminar el merge.', 'Resuelve y marca todos los conflictos antes.', (r.stdout + r.stderr).trim())
    return { ms: ms(t0) }
  }
  const r = await runGit([cmd, `--${action}`], { cwd: root, timeoutMs: 120_000, env: { GIT_EDITOR: 'true' } })
  if (r.code !== 0) {
    const verb = action === 'abort' ? 'abortar' : action === 'skip' ? 'saltar' : 'continuar'
    throw fail(`No se pudo ${verb}.`, 'Revisa la salida de git.', (r.stdout + r.stderr).trim())
  }
  return { ms: ms(t0) }
}
