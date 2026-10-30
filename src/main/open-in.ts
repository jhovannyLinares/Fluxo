import type { OpenIn } from '@shared/menu'

/** Cómo abrir la carpeta del repo afuera: un proceso con sus argumentos, una URL o la carpeta en el Explorador. */
export type OpenInPlan =
  | { kind: 'path'; path: string }
  | { kind: 'spawn'; cmd: string; args: string[] }
  | { kind: 'url'; url: string }

/**
 * Plan para «Abrir en…» del menú Archivo (A9). Nunca pasa la ruta por `cmd.exe`: Node solo pone comillas a los
 * argumentos con espacios, y una carpeta llamada `repo&calc` ejecutaría `calc`.
 * - VS Code por su URL `vscode://file/<ruta>` (la abre el sistema, sin línea de comandos).
 * - Windows Terminal con `-d <ruta>`, escapando `;`, que para `wt` separa comandos.
 */
export function openInPlan(target: OpenIn, path: string): OpenInPlan {
  if (target === 'explorer') return { kind: 'path', path }
  if (target === 'terminal') return { kind: 'spawn', cmd: 'wt.exe', args: ['-d', path.replace(/;/g, '\\;')] }
  const segments = path.replace(/\\/g, '/').split('/').map((s) => encodeURIComponent(s).replace(/%3A/gi, ':'))
  return { kind: 'url', url: `vscode://file/${segments.join('/')}` }
}
