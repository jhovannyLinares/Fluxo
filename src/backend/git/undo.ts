import { AppException } from '@shared/errors'
import { gitDirOf, readOperation } from './operation'
import { runGit } from './runner'

const fail = (message: string, suggestion: string, gitOutput?: string) =>
  new AppException({ code: 'GIT_FAILED', message, suggestion, ...(gitOutput ? { gitOutput } : {}) })

export interface UndoItem {
  label: string
}
export interface UndoInfo {
  undo: UndoItem | null
  redo: UndoItem | null
}

type Kind = { kind: 'commit'; msg: string } | { kind: 'checkout'; from: string; to: string } | { kind: 'generic'; msg: string }

/** El mensaje que dejó la acción original, sin el rastro que añaden Undo y Redo («: moving to HEAD@{1}»). */
const original = (msg: string) => msg.replace(/: (moving to|updating HEAD)\b.*$/, '')

/**
 * Qué acción del reflog de HEAD se puede deshacer: commit (amend, merge), checkout, reset, merge, pull, cherry pick y
 * revert. Un rebase, un clone o un fetch no: dejan muchos pasos y no se pueden volver atrás con un solo reset.
 */
function classify(raw: string): Kind | null {
  const msg = original(raw)
  let m = /^commit(?: \((?:amend|merge)\))?: (.*)$/.exec(msg)
  if (m) return { kind: 'commit', msg: m[1]! }
  m = /^checkout: moving from (\S+) to (\S+)/.exec(msg)
  if (m) return { kind: 'checkout', from: m[1]!, to: m[2]! }
  if (/^(reset|merge|pull|cherry-pick|revert)\b/.test(msg)) return { kind: 'generic', msg }
  return null
}

const labelOf = (k: Kind) => (k.kind === 'commit' ? `Commit "${k.msg}"` : k.kind === 'checkout' ? `Checkout "${k.to}"` : `Action with reflog message "${k.msg}"`)

async function reflog(root: string): Promise<string[]> {
  const r = await runGit(['reflog', '-n', '3', '--format=%gs', 'HEAD'], { cwd: root })
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []
}

/** Lo que dirían los tooltips de Undo y Redo para el estado actual del repo. */
export async function undoInfo(root: string): Promise<UndoInfo> {
  if (await readOperation(root, await gitDirOf(root))) return { undo: null, redo: null }
  const [e0, e1] = await reflog(root)
  if (!e0 || !e1) return { undo: null, redo: null }
  if (e0.startsWith('undo: ')) {
    const k = classify(e0.slice(6))
    return { undo: null, redo: k ? { label: labelOf(k) } : null }
  }
  const k = classify(e0.startsWith('redo: ') ? e0.slice(6) : e0)
  return { undo: k ? { label: labelOf(k) } : null, redo: null }
}

/** Deshace la última acción soportada, o la rehace si lo último que se hizo fue un Undo. */
export async function undoRedo(root: string, which: 'undo' | 'redo'): Promise<{ ms: number }> {
  const t0 = performance.now()
  if (await readOperation(root, await gitDirOf(root))) {
    throw fail('Hay una operación a medias en este repo.', 'Termínala o abórtala antes de deshacer.')
  }
  const [e0] = await reflog(root)
  if (!e0) throw fail('No hay nada que deshacer.', 'El historial de acciones de este repo está vacío.')
  let kind: Kind | null
  if (which === 'redo') {
    if (!e0.startsWith('undo: ')) throw fail('No hay nada que rehacer.', 'Rehacer solo está disponible justo después de un Undo.')
    kind = classify(e0.slice(6))
  } else {
    if (e0.startsWith('undo: ')) throw fail('La última acción ya fue un Undo.', 'Usa Redo para volver a ella.')
    kind = classify(e0.startsWith('redo: ') ? e0.slice(6) : e0)
  }
  if (!kind) throw fail('Esa acción no se puede deshacer.', 'Solo se deshacen commit, checkout, reset, merge, pull, cherry pick y revert.')

  const action = `${which}: ${original(which === 'redo' ? e0.slice(6) : e0.replace(/^redo: /, ''))}`
  const env = { GIT_REFLOG_ACTION: action }
  const args =
    kind.kind === 'commit'
      ? ['reset', '--soft', 'HEAD@{1}']
      : kind.kind === 'checkout'
        ? ['checkout', '--quiet', which === 'undo' ? kind.from : kind.to]
        : ['reset', '--keep', 'HEAD@{1}']
  const r = await runGit(args, { cwd: root, env, timeoutMs: 120_000 })
  if (r.code !== 0) {
    throw fail(
      which === 'undo' ? 'No se pudo deshacer.' : 'No se pudo rehacer.',
      'Tus cambios locales chocan con lo que habría que devolver, o la rama ya no existe.',
      (r.stdout + r.stderr).trim()
    )
  }
  return { ms: Math.round(performance.now() - t0) }
}
