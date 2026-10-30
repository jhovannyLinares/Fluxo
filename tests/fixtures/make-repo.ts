import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Usuario A',
  GIT_AUTHOR_EMAIL: 'a@ejemplo.com',
  GIT_COMMITTER_NAME: 'Usuario A',
  GIT_COMMITTER_EMAIL: 'a@ejemplo.com',
  GIT_CONFIG_NOSYSTEM: '1'
}

export function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', args, { cwd, env: { ...ENV, ...env }, encoding: 'utf8' })
}

export function tempDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

let n = 0
export function commit(cwd: string, msg: string, env: NodeJS.ProcessEnv = {}): void {
  writeFileSync(join(cwd, `f${n++}.txt`), msg)
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '-q', '-m', msg], env)
}

/**
 * Repo pequeño con: rama main, rama de agente con trailer Co-authored-by,
 * merge, tag anotado, y rama con nombre hostil (prueba de inyección).
 */
export function makeSmallRepo(dir: string): void {
  git(dir, ['init', '-q', '-b', 'main'])
  commit(dir, 'inicio')
  commit(dir, 'segundo')
  git(dir, ['tag', '-a', 'v1.0.0', '-m', 'release'])
  git(dir, ['checkout', '-q', '-b', 'claude/fix-timeout'])
  commit(dir, 'fix: timeout\n\nCo-authored-by: Claude <noreply@anthropic.com>')
  git(dir, ['checkout', '-q', 'main'])
  commit(dir, 'tercero en main')
  git(dir, ['merge', '-q', '--no-ff', '-m', 'Merge claude/fix-timeout', 'claude/fix-timeout'])
  git(dir, ['branch', 'x$(touch${IFS}pwned);echo'])
}

/**
 * Repo grande vía fast-import: `total` commits con `parallel` ramas vivas a la vez
 * que avanzan intercaladas y se fusionan a main tras ~`every` commits
 * (forma típica de equipo con PRs y agentes trabajando en paralelo).
 */
export function makeLargeRepo(dir: string, total: number, every = 25, parallel = 6): void {
  git(dir, ['init', '-q', '-b', 'main'])
  const lines: string[] = []
  let mark = 0
  let t = 1_600_000_000
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const commitCmd = (ref: string, msg: string, from: number, merge: number | null, ai: boolean) => {
    mark++
    const who = ai ? 'Claude <noreply@anthropic.com>' : 'Usuario A <a@ejemplo.com>'
    lines.push(`commit ${ref}`, `mark :${mark}`, `author ${who} ${t} +0000`, `committer ${who} ${t} +0000`)
    lines.push(`data ${Buffer.byteLength(msg)}`, msg)
    if (from) lines.push(`from :${from}`)
    if (merge) lines.push(`merge :${merge}`)
    lines.push('')
    t += 60
    return mark
  }
  let mainHead = commitCmd('refs/heads/main', 'inicio', 0, null, false)
  let count = 1
  let b = 0
  const live: { ref: string; head: number; len: number; ai: boolean }[] = []
  while (count < total) {
    while (live.length < parallel) {
      const ai = b % 3 === 0
      live.push({ ref: `refs/heads/${ai ? 'claude' : 'feature'}/b${b++}`, head: mainHead, len: 0, ai })
    }
    const i = Math.floor(rnd() * live.length)
    const br = live[i]!
    if (br.len >= every * (0.5 + rnd()) || count === total - 1) {
      mainHead = commitCmd('refs/heads/main', `Merge PR ${br.ref.slice(11)}`, mainHead, br.len ? br.head : null, false)
      lines.push(`reset ${br.ref}`, 'from 0000000000000000000000000000000000000000', '')
      live.splice(i, 1)
    } else {
      br.head = commitCmd(br.ref, `${br.ai ? 'fix' : 'feat'}: cambio ${count}`, br.head, null, br.ai)
      br.len++
    }
    count++
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: lines.join('\n') + '\n', env: ENV, maxBuffer: 1 << 30 })
  git(dir, ['checkout', '-q', '-f', 'main'])
}
