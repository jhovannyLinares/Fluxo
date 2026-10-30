import { watch, existsSync, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { runGit, runGitOk, type RunResult } from './runner'

/**
 * Spike S3 + S5: vigilar `.git` y el árbol de trabajo con fs.watch recursivo
 * (ReadDirectoryChangesW en Windows).
 *
 * Qué cambio importa:
 * - refs: `refs/**` o `packed-refs` (commit, rama nueva o borrada, fetch con novedades, reset)
 * - head: `HEAD` del worktree (checkout, HEAD desacoplado)
 * - index: `index` (stage; base del nodo WIP, H14)
 * - operation: merge, rebase, cherry-pick, revert o bisect en curso (banner 3.1)
 * - worktree: archivo del árbol de trabajo editado sin `git add` (fila WIP, H14)
 *
 * Falsos disparos: objetos, reflogs, `*.lock`, FETCH_HEAD sin novedades, `git status`
 * de otra herramienta que solo refresca stat del index, `pack-refs`/`gc` que mueven refs
 * sin cambiarlas, archivos ignorados por `.gitignore` (p. ej. `node_modules`).
 * Evento de disco solo marca "revisar"; se emite si cambia la huella del estado.
 *
 * Autoprueba pasiva (S5/A2), sin escribir en el repo (v1.0 es solo lectura): cada `checkMs`,
 * si fs.watch no dio ningún evento, revisa la huella de refs + HEAD; si cambió y el evento no
 * llega, fs.watch está sordo: avisa por `onError`, emite el cambio y pasa a polling.
 * Si fs.watch falla, se reinicia.
 */
export type ChangeKind = 'refs' | 'head' | 'index' | 'operation' | 'worktree'

export interface RepoChange {
  kinds: ChangeKind[]
}

/** watching: fs.watch funciona · polling: respaldo de refs + HEAD cada `pollMs` · closed: cerrado */
export type WatchMode = 'watching' | 'polling' | 'closed'

export type WatcherErrorCode = 'WATCH_DEAF' | 'WATCH_FAILED'

export class WatcherError extends Error {
  constructor(
    readonly code: WatcherErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'WatcherError'
  }
}

export type WatchFn = (
  dir: string,
  opts: { recursive: boolean; persistent: boolean },
  listener: (event: string, name: string | Buffer | null) => void
) => FSWatcher

export interface WatchOptions {
  /** espera tras último evento antes de revisar */
  quietMs?: number
  /** tope de espera durante ráfaga continua (meta: cambio visible < 2 s) */
  maxWaitMs?: number
  /** cada cuánto la autoprueba pasiva compara refs + HEAD si fs.watch estuvo callado */
  checkMs?: number
  /** intervalo del polling de respaldo */
  pollMs?: number
  /** espera antes de reabrir un fs.watch caído */
  restartDelayMs?: number
  /** reinicios seguidos antes de pasar a polling */
  maxRestarts?: number
  /** reemplazo de fs.watch (pruebas: watcher detenido a propósito) */
  watchImpl?: WatchFn
  onError?: (err: WatcherError) => void
  /** cambio de modo (A2: la UI avisa que pasó a polling) */
  onMode?: (mode: WatchMode) => void
}

const OPERATION_FILES = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply']
const ALL_KINDS = ['refs', 'head', 'index', 'operation', 'worktree'] as const

/** Clasifica ruta relativa a gitDir (worktree) o commonDir (refs compartidas). */
export function classify(relGit: string | null, relCommon: string | null): ChangeKind | null {
  const rel = relGit ?? relCommon
  if (rel === null || rel.endsWith('.lock')) return null
  if (relGit !== null) {
    if (relGit === 'HEAD') return 'head'
    if (relGit === 'index') return 'index'
    const top = relGit.split('/')[0]!
    if (OPERATION_FILES.includes(top)) return 'operation'
  }
  if (relCommon !== null) {
    if (relCommon === 'packed-refs' || relCommon.startsWith('refs/')) return 'refs'
  }
  return null
}

/** Ruta relativa con `/` si `path` está dentro de `base`; si no, null. */
function inside(base: string, path: string): string | null {
  const rel = relative(base, path)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.replace(/\\/g, '/')
}

/** `rel` o alguna carpeta que lo contiene está en el conjunto de ignorados. */
export function isIgnored(ignored: ReadonlySet<string>, rel: string): boolean {
  for (let i = rel.indexOf('/'); i !== -1; i = rel.indexOf('/', i + 1)) if (ignored.has(rel.slice(0, i))) return true
  return ignored.has(rel)
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex')

export class RepoWatcher {
  private watchers: FSWatcher[] = []
  private pending = new Set<ChangeKind>()
  private quietTimer: NodeJS.Timeout | null = null
  private maxTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private checkTimer: NodeJS.Timeout | null = null
  /** eventos de fs.watch desde la última autoprueba: con alguno, fs.watch está vivo */
  private eventsSinceCheck = 0
  private checking = false
  private closed = false
  private restarts = 0
  private prints = new Map<ChangeKind, string>()
  /** rutas ignoradas por git (`ls-files -o -i --directory`): eventos ahí no cuestan ningún proceso */
  private ignored = new Set<string>()
  private ignoredStale = false
  private _mode: WatchMode = 'watching'
  /** contadores para medir costo por ráfaga (S5/A8) */
  readonly stats = { flushes: 0, gitProcesses: 0, overflows: 0, checks: 0 }

  private constructor(
    private readonly root: string,
    private readonly gitDir: string,
    private readonly commonDir: string,
    private readonly onChange: (change: RepoChange) => void,
    private readonly opts: Required<Omit<WatchOptions, 'onError' | 'onMode'>> & Pick<WatchOptions, 'onError' | 'onMode'>
  ) {}

  /** Resuelve raíz, gitDir y commonDir (worktrees vinculados) y empieza a vigilar. */
  static async start(root: string, onChange: (change: RepoChange) => void, opts: WatchOptions = {}): Promise<RepoWatcher> {
    const out = await runGitOk(
      ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'],
      { cwd: root }
    )
    const [gitDir = '', commonDir = '', top = ''] = out.split('\n').map((l) => resolve(l.trim()))
    const w = new RepoWatcher(top, gitDir, commonDir, onChange, {
      quietMs: opts.quietMs ?? 250,
      maxWaitMs: opts.maxWaitMs ?? 1000,
      checkMs: opts.checkMs ?? 30_000,
      pollMs: opts.pollMs ?? 2000,
      restartDelayMs: opts.restartDelayMs ?? 1000,
      maxRestarts: opts.maxRestarts ?? 3,
      watchImpl: opts.watchImpl ?? watch,
      onError: opts.onError,
      onMode: opts.onMode
    })
    await w.init()
    return w
  }

  get mode(): WatchMode {
    return this._mode
  }

  private async init(): Promise<void> {
    // huella inicial: primer evento compara contra estado al abrir
    for (const kind of ALL_KINDS) this.prints.set(kind, await this.fingerprint(kind))
    await this.loadIgnored()
    // un watcher por carpeta raíz: `.git` dentro del árbol, gitDir de worktree vinculado dentro de commonDir
    const all = [...new Set([this.root, this.commonDir, this.gitDir])]
    for (const dir of all.filter((d) => !all.some((o) => inside(o, d) !== null))) this.watchDir(dir)
    this.checkTimer = setInterval(() => void this.passiveCheck(), this.opts.checkMs)
    this.checkTimer.unref()
  }

  private watchDir(dir: string): void {
    let fw: FSWatcher
    try {
      fw = this.opts.watchImpl(dir, { recursive: true, persistent: false }, (_ev, name) => this.onFsEvent(dir, name))
    } catch (err) {
      this.report('WATCH_FAILED', `No se pudo vigilar ${dir}.`, err)
      this.retry(dir)
      return
    }
    fw.on('error', (err) => {
      fw.close()
      this.watchers = this.watchers.filter((x) => x !== fw)
      this.report('WATCH_FAILED', `Se cayó la vigilancia de ${dir}; reintentando.`, err)
      this.retry(dir)
    })
    this.watchers.push(fw)
  }

  /** Reabre un fs.watch caído; tras `maxRestarts` intentos pasa a polling. */
  private retry(dir: string): void {
    if (this.closed) return
    if (this.restarts >= this.opts.maxRestarts) {
      this.startPolling()
      return
    }
    this.restarts++
    setTimeout(() => {
      if (this.closed) return
      this.watchDir(dir)
      // eventos perdidos mientras estuvo caído: revisar todo, la huella descarta lo que no cambió
      for (const k of ALL_KINDS) this.pending.add(k)
      this.schedule()
    }, this.opts.restartDelayMs).unref()
  }

  /**
   * Autoprueba pasiva: con fs.watch callado desde la última vez, compara refs + HEAD. Un cambio
   * sin ningún evento (ni tras esperar `maxWaitMs`, por si el evento venía en camino) = fs.watch sordo.
   */
  private async passiveCheck(): Promise<void> {
    if (this.closed || this.pollTimer) return
    const quiet = this.eventsSinceCheck === 0 && !this.checking && this.pending.size === 0
    this.eventsSinceCheck = 0
    if (!quiet) return
    this.stats.checks++
    this.checking = true
    try {
      const changed: ChangeKind[] = []
      const prints = new Map<ChangeKind, string>()
      for (const kind of ['refs', 'head'] as const) {
        const print = await this.fingerprint(kind)
        if (print !== this.prints.get(kind)) {
          prints.set(kind, print)
          changed.push(kind)
        }
      }
      if (changed.length === 0 || this.closed) return
      await sleep(this.opts.maxWaitMs)
      if (this.eventsSinceCheck > 0 || this.closed) return // el evento llegó: fs.watch vivo, flush lo emite
      for (const [kind, print] of prints) this.prints.set(kind, print)
      this.report(
        'WATCH_DEAF',
        `La vigilancia de archivos no avisó un cambio de ramas o HEAD; se revisarán cada ${this.opts.pollMs} ms.`
      )
      this.onChange({ kinds: changed })
      this.startPolling()
    } catch (err) {
      this.report('WATCH_FAILED', 'Falló la autoprueba del watcher.', err)
    } finally {
      this.checking = false
    }
  }

  /** Respaldo: revisa refs, HEAD y operación en curso cada `pollMs`; la huella evita eventos repetidos. */
  private startPolling(): void {
    if (this.closed || this.pollTimer) return
    this._mode = 'polling'
    this.opts.onMode?.('polling')
    this.pollTimer = setInterval(() => {
      for (const k of ['refs', 'head', 'operation'] as const) this.pending.add(k)
      void this.flush()
    }, this.opts.pollMs)
    this.pollTimer.unref()
  }

  private report(code: WatcherErrorCode, message: string, cause?: unknown): void {
    this.opts.onError?.(new WatcherError(code, message, cause))
  }

  private onFsEvent(dir: string, name: string | Buffer | null): void {
    if (this.closed) return
    this.eventsSinceCheck++
    if (name === null) {
      // sistema no dio nombre: revisar todo, la huella descarta lo que no cambió
      for (const k of ALL_KINDS) this.pending.add(k)
      this.stats.overflows++
      this.ignoredStale = true
      this.schedule()
      return
    }
    const abs = join(dir, name.toString())
    // carpeta .git misma cambia de mtime al crear o borrar algo dentro: no es del árbol
    if (abs === this.gitDir || abs === this.commonDir) return
    const relGit = inside(this.gitDir, abs)
    const relCommon = inside(this.commonDir, abs)
    let kind: ChangeKind | null
    if (relGit !== null || relCommon !== null) {
      kind = classify(relGit, relCommon)
      if (relGit === 'info/exclude') {
        this.ignoredStale = true
        kind = 'worktree'
      }
    } else {
      const rel = inside(this.root, abs)
      if (rel === null) return
      if (basename(rel) === '.gitignore') this.ignoredStale = true
      else if (isIgnored(this.ignored, rel)) return
      kind = 'worktree'
    }
    if (!kind) return
    this.pending.add(kind)
    this.schedule()
  }

  private schedule(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer)
    this.quietTimer = setTimeout(() => void this.flush(), this.opts.quietMs)
    this.maxTimer ??= setTimeout(() => void this.flush(), this.opts.maxWaitMs)
  }

  private async flush(): Promise<void> {
    if (this.quietTimer) clearTimeout(this.quietTimer)
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.quietTimer = this.maxTimer = null
    if (this.closed || this.pending.size === 0) return
    if (this.checking) {
      this.schedule() // revisión en curso: eventos nuevos esperan a la siguiente
      return
    }
    this.checking = true
    this.stats.flushes++
    const kinds = [...this.pending]
    this.pending.clear()
    try {
      const changed: ChangeKind[] = []
      for (const kind of kinds) {
        const print = await this.fingerprint(kind)
        if (print !== this.prints.get(kind)) {
          this.prints.set(kind, print)
          changed.push(kind)
        } else if (kind === 'worktree') {
          // ráfaga del árbol sin cambio visible: quizá carpeta ignorada nueva (build, npm install)
          this.ignoredStale = true
        }
      }
      if (this.ignoredStale) await this.loadIgnored()
      if (changed.length > 0 && !this.closed) this.onChange({ kinds: changed })
    } catch (err) {
      this.report('WATCH_FAILED', 'Falló la revisión del estado del repo.', err)
    } finally {
      this.checking = false
    }
  }

  private async git(args: string[]): Promise<RunResult> {
    this.stats.gitProcesses++
    return runGit(args, { cwd: this.root })
  }

  private async gitOk(args: string[]): Promise<string> {
    this.stats.gitProcesses++
    return runGitOk(args, { cwd: this.root })
  }

  /** Carpetas y archivos sin seguimiento que git ignora; `--directory` resume `node_modules/` en una línea. */
  private async loadIgnored(): Promise<void> {
    this.ignoredStale = false
    const out = await this.gitOk(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'])
    this.ignored = new Set(out.split('\0').filter(Boolean).map((p) => p.replace(/\/$/, '')))
  }

  /** Huella del estado de un tipo: solo lectura y sin tomar locks (GIT_OPTIONAL_LOCKS=0 en runner). */
  private async fingerprint(kind: ChangeKind): Promise<string> {
    switch (kind) {
      case 'refs':
        return sha(await this.gitOk(['for-each-ref', '--format=%(objectname) %(refname)']))
      case 'head': {
        const [ref, hash] = await Promise.all([
          this.git(['symbolic-ref', '-q', 'HEAD']),
          this.git(['rev-parse', '-q', '--verify', 'HEAD'])
        ])
        return `${ref.stdout.trim()} ${hash.stdout.trim()}`
      }
      case 'index':
        // ls-files --stage no incluye datos stat: refresco de `git status` ajeno no cambia huella
        return sha(await this.gitOk(['ls-files', '--stage']))
      case 'operation':
        return OPERATION_FILES.filter((f) => existsSync(join(this.gitDir, f))).join(',')
      case 'worktree': {
        // status respeta .gitignore y no lista archivos tocados sin cambio de contenido;
        // tamaño + mtime de cada archivo listado distingue una segunda edición del mismo archivo
        const out = await this.gitOk(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'])
        const entries = out.split('\0').filter(Boolean)
        const parts = await Promise.all(
          entries.map(async (e) => {
            const st = await stat(join(this.root, e.slice(3))).catch(() => null)
            return `${e} ${st ? `${st.size}:${st.mtimeMs}` : '-'}`
          })
        )
        return sha(parts.join('\n'))
      }
    }
  }

  close(): void {
    this.closed = true
    this._mode = 'closed'
    if (this.quietTimer) clearTimeout(this.quietTimer)
    if (this.maxTimer) clearTimeout(this.maxTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.checkTimer) clearInterval(this.checkTimer)
    for (const w of this.watchers) w.close()
    this.watchers = []
  }
}
