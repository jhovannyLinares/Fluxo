import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { OpEntry } from '@shared/op-journal'

/** Un error tal como queda en el registro: de dónde vino, qué dijo y la salida de git si la hubo. */
export interface ErrorEntry {
  /** rpc (petición fallida), renderer (error en la consola de la ventana), ventana (se cayó), backend (se cayó), app (arranque) */
  source: 'rpc' | 'renderer' | 'ventana' | 'backend' | 'app'
  message: string
  channel?: string
  code?: string
  gitOutput?: string
  suggestion?: string
  where?: string
}

/** Tope del archivo; al pasarlo, el actual pasa a `.1` y se empieza otro, así nunca crece sin límite. */
export const MAX_BYTES = 1_000_000

/** Quita usuario y contraseña o token de las URL (`https://usuario:token@host` → `https://***@host`). */
export function redact(s: string): string {
  return s.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@')
}

/**
 * Una línea JSON por error, con fecha: se puede leer a mano, filtrar con grep o vigilar con tail. Las credenciales de
 * una URL que git haya puesto en su salida no llegan al archivo (A9).
 */
export function errorLine(e: ErrorEntry, at = new Date()): string {
  return redact(JSON.stringify({ at: at.toISOString(), ...e })) + '\n'
}

/**
 * Registro de la app en `userData/logs/fluxo.log`: las escrituras de Fluxo (bitácora: inicio, espera, fin, HEAD
 * antes y después, comandos de git) y los errores, en orden. Un error idéntico al anterior (el fetch automático cada
 * 5 minutos) no se repite: se cuenta y queda una línea «se repitió N veces» antes de la siguiente distinta. Nunca
 * lanza: si no se puede escribir, el error original sigue su camino igual.
 */
export class ErrorLog {
  private last: { key: string; times: number; until: string } | null = null

  constructor(readonly file: string) {}

  write(e: ErrorEntry, at = new Date()): void {
    const key = JSON.stringify([e.source, e.channel, e.code, e.message, e.gitOutput])
    if (this.last?.key === key) {
      this.last.times++
      this.last.until = at.toISOString()
      return
    }
    this.flushRepeat()
    this.last = { key, times: 0, until: at.toISOString() }
    this.append(errorLine(e, at))
  }

  /** Una escritura terminada (bitácora de operaciones). */
  writeOp(entry: OpEntry, at = new Date()): void {
    this.flushRepeat()
    this.last = null
    this.append(redact(JSON.stringify({ at: at.toISOString(), source: 'op', ...entry })) + '\n')
  }

  private flushRepeat(): void {
    if (this.last && this.last.times > 0) {
      this.append(JSON.stringify({ at: this.last.until, source: 'repeat', message: `La línea anterior se repitió ${this.last.times} veces más.` }) + '\n')
    }
  }

  private append(line: string): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      try {
        if (statSync(this.file).size > MAX_BYTES) renameSync(this.file, `${this.file}.1`)
      } catch {
        // todavía no existe
      }
      appendFileSync(this.file, line, 'utf8')
    } catch {
      // sin registro antes que sin app
    }
  }
}
