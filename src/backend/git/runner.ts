import { spawn } from 'node:child_process'
import { AppException } from '@shared/errors'
import { noteGit } from './op-context'

export interface RunOptions {
  /** carpeta del repo; se pasa como `-C <cwd>`, nunca concatenada */
  cwd?: string
  timeoutMs?: number
  /** límite de salida para evitar agotar memoria */
  maxBytes?: number
  /** variables extra (p. ej. GCM_INTERACTIVE=never en autofetch); no pisan las forzadas de seguridad */
  env?: NodeJS.ProcessEnv
  /** recibe stderr a medida que llega (progreso de clone) */
  onStderr?: (chunk: string) => void
  /** texto para la entrada estándar (p. ej. `git credential fill`); sin él, stdin queda como estaba */
  input?: string
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

const GIT_BIN = process.env.FLUXO_GIT_BIN || 'git'

/**
 * Configuración forzada en cada llamada (8.6 / 8.8):
 * - core.fsmonitor=false: config de repo no confiable no ejecuta comandos al leer estado
 * - core.quotepath=off: rutas con acentos sin escapar
 * - color.ui=false: salida parseable
 */
const SAFE_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off', '-c', 'color.ui=false']

/** Valida argumentos: solo strings sin NUL ni saltos de línea. */
export function assertSafeArgs(args: readonly unknown[]): asserts args is string[] {
  for (const a of args) {
    if (typeof a !== 'string') throw new TypeError('Argumento git no es texto')
    if (a.includes('\0') || a.includes('\n') || a.includes('\r')) {
      throw new TypeError('Argumento git con caracteres de control')
    }
  }
}

/**
 * Ejecuta git sin shell: argumentos en arreglo, nunca concatenados.
 * Nombres de rama/archivo con `;`, `&`, comillas o espacios no pueden inyectar comandos.
 */
export function runGit(args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  assertSafeArgs(args)
  const full = [...SAFE_CONFIG, ...(opts.cwd ? ['-C', opts.cwd] : []), ...args]
  const timeoutMs = opts.timeoutMs ?? 60_000
  const t0 = performance.now()
  const maxBytes = opts.maxBytes ?? 256 * 1024 * 1024

  return new Promise((resolve, reject) => {
    const child = spawn(GIT_BIN, full, {
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        ...opts.env,
        GIT_TERMINAL_PROMPT: '0', // nunca colgar esperando usuario/contraseña en consola
        GIT_OPTIONAL_LOCKS: '0', // lecturas no toman index.lock: no chocan con agentes escribiendo
        LC_ALL: 'C',
        LANG: 'C'
      }
    })

    if (opts.input !== undefined) child.stdin.end(opts.input)

    const out: Buffer[] = []
    const err: Buffer[] = []
    let bytes = 0
    let killedReason: 'timeout' | 'size' | null = null

    const timer = setTimeout(() => {
      killedReason = 'timeout'
      child.kill()
    }, timeoutMs)

    child.stdout.on('data', (b: Buffer) => {
      bytes += b.length
      if (bytes > maxBytes) {
        killedReason = 'size'
        child.kill()
        return
      }
      out.push(b)
    })
    child.stderr.on('data', (b: Buffer) => {
      err.push(b)
      opts.onStderr?.(b.toString('utf8'))
    })

    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (e.code === 'ENOENT') {
        reject(
          new AppException({
            code: 'GIT_NOT_FOUND',
            message: 'No se encontró git en este equipo.',
            suggestion: 'Instala Git for Windows (incluye Git Credential Manager) y reinicia la app.'
          })
        )
      } else reject(e)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      noteGit(args, code ?? -1, performance.now() - t0)
      const stderr = Buffer.concat(err).toString('utf8')
      if (killedReason === 'timeout') {
        reject(
          new AppException({
            code: 'TIMEOUT',
            message: `git ${args[0] ?? ''} tardó más de ${Math.round(timeoutMs / 1000)} s.`,
            gitOutput: stderr
          })
        )
        return
      }
      if (killedReason === 'size') {
        reject(
          new AppException({
            code: 'GIT_FAILED',
            message: 'Salida de git demasiado grande.',
            suggestion: 'Reduce el rango de historial a cargar.'
          })
        )
        return
      }
      resolve({ stdout: Buffer.concat(out).toString('utf8'), stderr, code: code ?? -1 })
    })
  })
}

/** Igual que runGit pero falla con error legible si git sale con código ≠ 0. */
export async function runGitOk(args: readonly string[], opts: RunOptions = {}): Promise<string> {
  const r = await runGit(args, opts)
  if (r.code !== 0) {
    throw new AppException({
      code: 'GIT_FAILED',
      message: `git ${args[0] ?? ''} falló (código ${r.code}).`,
      gitOutput: r.stderr.trim()
    })
  }
  return r.stdout
}
