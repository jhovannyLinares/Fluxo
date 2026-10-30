import { toAppError } from '@shared/errors'
import type { OpEntry } from '@shared/op-journal'
import { emit } from '../events'
import { opContext, type OpContext } from './op-context'
import { runGit } from './runner'

/** Cola por repo: cada escritura espera a la anterior, así un pull y un checkout nunca se pisan. */
const tails = new Map<string, Promise<unknown>>()
/** la última encolada en cada repo, para que la bitácora diga a quién se esperó */
const lastQueued = new Map<string, string>()
let nextOp = 1

/** HEAD (hash y rama) en una sola llamada a git, fuera de la lista de comandos de la operación. */
async function headOf(root: string): Promise<{ sha: string | null; branch: string | null }> {
  const r = await runGit(['rev-parse', '-q', 'HEAD', '--symbolic-full-name', 'HEAD'], { cwd: root })
  const [sha, ref] = r.stdout.trim().split('\n')
  return { sha: sha && /^[0-9a-f]{7,64}$/.test(sha) ? sha : null, branch: ref?.startsWith('refs/heads/') ? ref.slice(11) : null }
}

const accountOf = async (root: string) => {
  const r = await runGit(['config', '--get', 'credential.https://github.com.username'], { cwd: root })
  return r.code === 0 ? r.stdout.trim() || null : null
}

/**
 * Corre una escritura en la fila de su repo y la deja en la bitácora (inicio, espera, fin, HEAD antes y después,
 * comandos de git con su código de salida, cuenta, si fue automática). Nunca cambia el resultado de la operación.
 */
export function writeOp<T>(root: string, op: string, opts: { auto?: boolean; network?: boolean }, fn: () => Promise<T>): Promise<T> {
  const key = root.toLowerCase()
  const id = nextOp++
  const queuedAt = Date.now()
  const waitedFor = tails.has(key) ? (lastQueued.get(key) ?? null) : null
  const prev = tails.get(key) ?? Promise.resolve()
  lastQueued.set(key, op)
  const run = prev
    .catch(() => {})
    .then(async () => {
      const startedAt = Date.now()
      const ctx: OpContext = { cmds: [] }
      const [before, account] = await Promise.all([headOf(root), opts.network ? accountOf(root) : Promise.resolve(null)])
      let error: ReturnType<typeof toAppError> | null = null
      try {
        return await opContext.run(ctx, fn)
      } catch (e) {
        error = toAppError(e)
        throw e
      } finally {
        const after = await headOf(root).catch(() => ({ sha: null, branch: null }))
        const entry: OpEntry = {
          id,
          op,
          repo: root,
          auto: !!opts.auto,
          ...(account ? { account } : {}),
          queuedAt: new Date(queuedAt).toISOString(),
          waitedMs: startedAt - queuedAt,
          ...(waitedFor ? { waitedFor } : {}),
          ms: Date.now() - startedAt,
          before,
          after,
          git: ctx.cmds.map((c) => ({ cmd: c.args.join(' '), code: c.code, ms: c.ms })),
          result: error ? 'error' : 'ok',
          ...(error ? { error: error.message } : {})
        }
        emit({ type: 'op:journal', entry })
      }
    })
  tails.set(key, run)
  void run.finally(() => tails.get(key) === run && tails.delete(key)).catch(() => {})
  return run
}
