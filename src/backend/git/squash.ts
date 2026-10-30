import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppException } from '@shared/errors'
import { runGit, runGitOk } from './runner'

/** Un squash por repo a la vez. */
const running = new Map<string, Promise<{ ms: number }>>()

/** Lo que el squash necesita saber de la selección, ya ordenado del más viejo al más nuevo. */
interface Plan {
  oldest: string
  newest: string
  /** padre del más viejo; null si el más viejo es el primer commit del repo */
  base: string | null
  /** el más nuevo es HEAD: basta mover la rama, sin volver a aplicar nada */
  atHead: boolean
}

/**
 * Motivo legible por el que no se puede hacer squash de esos commits, o null si se puede. Guarda de Gio: solo commits
 * seguidos de la rama actual, sin merges y que todavía no se subieron a ningún remoto, para no reescribir lo que otros
 * ya bajaron.
 */
export async function squashBlocker(root: string, hashes: string[]): Promise<string | null> {
  return (await planSquash(root, hashes)).why
}

async function planSquash(root: string, hashes: string[]): Promise<{ why: string; plan?: never } | { why: null; plan: Plan }> {
  const no = (why: string) => ({ why })
  if (hashes.length < 2) return no('El squash necesita dos o más commits.')
  const opts = { cwd: root }
  if ((await runGit(['symbolic-ref', '-q', 'HEAD'], opts)).code !== 0) return no('No hay una rama actual (HEAD suelto).')
  const full = await Promise.all(hashes.map((h) => runGitOk(['rev-parse', '--verify', '--end-of-options', `${h}^{commit}`], opts).then((s) => s.trim())))
  for (const h of full) {
    if ((await runGit(['merge-base', '--is-ancestor', '--end-of-options', h, 'HEAD'], opts)).code !== 0) {
      return no('Solo se pueden unir commits de la rama actual.')
    }
  }
  // del más nuevo al más viejo por la línea principal de la rama: la selección tiene que ser un tramo sin huecos
  // el más viejo es antecesor de todos los demás; basta el tramo de HEAD hasta él, no toda la historia
  let first = full[0]!
  for (const h of full.slice(1)) {
    if ((await runGit(['merge-base', '--is-ancestor', h, first], opts)).code === 0) first = h
  }
  const line = (await runGitOk(['rev-list', '--first-parent', 'HEAD', '--not', `${first}^@`], opts)).trim().split('\n')
  const pos = full.map((h) => line.indexOf(h)).sort((a, b) => a - b)
  if (pos[0]! < 0 || pos.some((p, i) => p !== pos[0]! + i)) return no('Los commits tienen que ser seguidos, sin huecos entre ellos.')
  const newest = line[pos[0]!]!
  const oldest = line[pos[pos.length - 1]!]!
  const parents = await Promise.all(full.map((h) => runGitOk(['rev-list', '--parents', '-n', '1', h], opts)))
  if (parents.some((p) => p.trim().split(' ').length > 2)) return no('No se puede hacer squash de un commit de merge.')
  const remotes = (await runGitOk(['for-each-ref', '--contains', oldest, '--format=%(refname:short)', 'refs/remotes'], opts)).trim()
  if (remotes) return no(`Uno de los commits ya se subió (${remotes.split('\n')[0]}): unirlos reescribiría lo que otros ya bajaron.`)
  const atHead = pos[0] === 0
  if (!atHead) {
    if ((await runGitOk(['rev-list', '--merges', `${newest}..HEAD`], opts)).trim()) return no('Hay un merge encima de los commits elegidos.')
    if ((await runGitOk(['status', '--porcelain', '--untracked-files=no'], opts)).trim()) {
      return no('Hay cambios sin commit: para unir commits del medio de la rama, haz commit o stash primero.')
    }
  }
  const base = (await runGit(['rev-parse', '--verify', '-q', `${oldest}^`], opts)).stdout.trim() || null
  return { why: null, plan: { oldest, newest, base, atHead } }
}

/**
 * Une commits seguidos de la rama actual en uno solo («Squash de N commits»): el árbol del más nuevo,
 * el autor y la fecha del más viejo y los mensajes de todos, del más viejo al más nuevo. Si hay commits encima, se
 * vuelven a aplicar sobre el nuevo con `git rebase --onto`. Tercera escritura de Fluxo (decisión de Gio del 2026-10-22).
 */
export function squash(root: string, hashes: string[]): Promise<{ ms: number }> {
  const key = root.toLowerCase()
  const current = running.get(key)
  if (current) return current
  const p = (async () => {
    const t0 = performance.now()
    const r = await planSquash(root, hashes)
    if (r.why !== null) throw new AppException({ code: 'GIT_FAILED', message: r.why, suggestion: 'Elige otros commits.' })
    const { oldest, newest, base, atHead } = r.plan
    const opts = { cwd: root }
    const range = base ? `${base}..${newest}` : newest
    const messages = (await runGitOk(['log', '--reverse', '--format=%B%x00', range], opts))
      .split('\0')
      .map((m) => m.trim())
      .filter(Boolean)
    const [name, email, date] = (await runGitOk(['log', '-1', '--format=%an%x00%ae%x00%aI', oldest], opts)).trim().split('\0')
    // el mensaje va por archivo: el runner no deja pasar saltos de línea en los argumentos
    const dir = mkdtempSync(join(tmpdir(), 'fluxo-squash-'))
    const msgFile = join(dir, 'MSG')
    writeFileSync(msgFile, messages.join('\n\n') + '\n', 'utf8')
    const squashed = await runGitOk(['commit-tree', `${newest}^{tree}`, ...(base ? ['-p', base] : []), '-F', msgFile], {
      ...opts,
      env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date }
    })
      .then((s) => s.trim())
      .finally(() => rmSync(dir, { recursive: true, force: true }))
    if (atHead) {
      // mismo árbol que HEAD: mover la rama no toca ni el índice ni los archivos
      await runGitOk(['reset', '--soft', squashed], opts)
    } else {
      const rb = await runGit(['rebase', '--onto', squashed, newest], { ...opts, timeoutMs: 300_000, env: { GIT_EDITOR: 'true' } })
      if (rb.code !== 0) {
        throw new AppException({
          code: 'GIT_FAILED',
          message: 'El squash dejó conflictos al volver a aplicar los commits de encima.',
          suggestion: 'Resuélvelos en tu terminal o cancela con git rebase --abort: la rama vuelve a como estaba.',
          gitOutput: (rb.stdout + rb.stderr).trim()
        })
      }
    }
    return { ms: Math.round(performance.now() - t0) }
  })().finally(() => running.delete(key))
  running.set(key, p)
  return p
}
