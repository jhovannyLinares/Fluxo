import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AppException } from '@shared/errors'
import { checkCloneUrl, parseCloneProgress, repoNameFromUrl, type CloneProgress } from '@shared/clone'
import { runGit } from './runner'

const URL_MESSAGES = {
  empty: 'Escribe la URL del repositorio.',
  notHttps: 'La URL debe empezar con https://.',
  credentials: 'La URL no debe llevar usuario ni contraseña.',
  noName: 'No se pudo sacar el nombre del repositorio de la URL.'
} as const

/** Valida la URL y el destino; devuelve la carpeta donde quedará el clon. */
export function cloneTarget(url: string, parent: string): string {
  const problem = checkCloneUrl(url)
  if (problem) {
    throw new AppException({
      code: 'INVALID_REQUEST',
      message: URL_MESSAGES[problem],
      suggestion:
        problem === 'credentials'
          ? 'Quita usuario y token: Git Credential Manager pide las credenciales y no quedan guardadas en el repo.'
          : 'Copia la URL HTTPS desde Azure DevOps o GitHub (botón Clone).'
    })
  }
  return targetFolder(repoNameFromUrl(url)!, parent)
}

/** Carpeta destino: debe existir el padre y no existir el repo (o estar vacío). */
export function targetFolder(name: string, parent: string): string {
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new AppException({ code: 'PATH_NOT_FOUND', message: 'La carpeta de destino no existe.', gitOutput: parent })
  }
  const dest = join(parent, name)
  if (existsSync(dest) && (!statSync(dest).isDirectory() || readdirSync(dest).length > 0)) {
    throw new AppException({
      code: 'INVALID_REQUEST',
      message: `Ya existe ${dest} y no está vacía.`,
      suggestion: 'Elige otra carpeta de destino, o abre ese repositorio si ya lo clonaste.'
    })
  }
  return dest
}

/**
 * `git clone` (H09), una de las dos escrituras de la v1.0. Sin shell y con `--` antes de la URL;
 * si falla, git borra la carpeta a medio clonar. GCM puede pedir inicio de sesión (clon manual).
 */
export async function cloneInto(source: string, dest: string, onProgress?: (p: CloneProgress) => void): Promise<void> {
  let buffer = ''
  const r = await runGit(['clone', '--progress', '--', source, dest], {
    timeoutMs: 30 * 60_000,
    onStderr: (chunk) => {
      // el progreso llega con \r para reescribir la misma línea
      buffer += chunk
      const parts = buffer.split(/[\r\n]/)
      buffer = parts.pop() ?? ''
      for (const line of parts) {
        const p = parseCloneProgress(line)
        if (p) onProgress?.(p)
      }
    }
  })
  if (r.code !== 0) {
    const auth = /authentication|could not read username|403|401/i.test(r.stderr)
    throw new AppException({
      code: 'GIT_FAILED',
      message: auth ? 'No se pudo iniciar sesión para clonar.' : 'El clon falló.',
      gitOutput: r.stderr.trim(),
      suggestion: auth
        ? 'Revisa Git Credential Manager en la pantalla Entorno y que tu cuenta tenga acceso al repositorio.'
        : 'Revisa la URL y la conexión.'
    })
  }
}
