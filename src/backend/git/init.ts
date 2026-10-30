import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppException } from '@shared/errors'
import { checkRepoName, GITIGNORE_TEMPLATES, LICENSE_TEMPLATES } from '@shared/init-templates'
import { runGit } from './runner'
import { targetFolder } from './clone'

export interface InitOptions {
  name: string
  parent: string
  /** rama inicial; sin ella, `main` */
  branch?: string | undefined
  /** nombre de una plantilla de `GITIGNORE_TEMPLATES` */
  gitignore?: string | undefined
  /** nombre de una de `LICENSE_TEMPLATES` */
  license?: string | undefined
}

const invalid = (message: string, suggestion?: string) =>
  new AppException({ code: 'INVALID_REQUEST', message, ...(suggestion ? { suggestion } : {}) })

/**
 * «Initialize a Repo»: crea la carpeta, `git init` en la rama elegida, `README.md` con el nombre
 * y, si se pidieron, `.gitignore` y `LICENSE.md`; todo queda en un commit «Initial commit».
 * Valida antes de crear nada; si falla a medias, borra solo lo que acaba de crear.
 */
export async function initRepo(o: InitOptions): Promise<{ path: string }> {
  const name = o.name.trim()
  const problem = checkRepoName(name)
  if (problem) throw invalid(problem === 'empty' ? 'Escribe el nombre del repositorio.' : 'Ese nombre no sirve como carpeta.', 'Evita \\ / : * ? " < > |, no termines en punto ni en espacio.')
  const branch = (o.branch ?? '').trim() || 'main'
  const ref = await runGit(['check-ref-format', '--branch', branch])
  if (ref.code !== 0) throw invalid(`«${branch}» no es un nombre de rama válido.`, 'Usa letras, números, guiones y barras; sin espacios.')
  if (o.gitignore && !(o.gitignore in GITIGNORE_TEMPLATES)) throw invalid(`No hay una plantilla de .gitignore llamada «${o.gitignore}».`)
  if (o.license && !(o.license in LICENSE_TEMPLATES)) throw invalid(`No hay una licencia llamada «${o.license}».`)
  const dest = targetFolder(name, o.parent)

  let holder = ''
  if (o.license) {
    const cfg = await runGit(['config', 'user.name'])
    holder = cfg.stdout.trim()
    if (!holder) throw invalid('Git no tiene tu nombre configurado (user.name).', 'Configúralo en Preferencias o con git config --global user.name.')
  }

  const existed = existsSync(dest)
  try {
    const r = await runGit(['init', '-q', `--initial-branch=${branch}`, '--', dest])
    if (r.code !== 0) throw new AppException({ code: 'GIT_FAILED', message: 'No se pudo crear el repositorio.', gitOutput: r.stderr.trim() })
    writeFileSync(join(dest, 'README.md'), `# ${name}\n`)
    if (o.gitignore) writeFileSync(join(dest, '.gitignore'), GITIGNORE_TEMPLATES[o.gitignore]!)
    if (o.license) writeFileSync(join(dest, 'LICENSE.md'), LICENSE_TEMPLATES[o.license]!(new Date().getFullYear(), holder))
    const add = await runGit(['add', '-A'], { cwd: dest })
    if (add.code !== 0) throw new AppException({ code: 'GIT_FAILED', message: 'No se pudieron preparar los archivos iniciales.', gitOutput: add.stderr.trim() })
    const c = await runGit(['commit', '-q', '-m', 'Initial commit'], { cwd: dest })
    if (c.code !== 0) {
      const noUser = /user\.(name|email)|identity|tell me who you are/i.test(c.stderr)
      throw new AppException({
        code: 'GIT_FAILED',
        message: noUser ? 'Git no sabe quién eres, así que no pudo hacer el commit inicial.' : 'No se pudo hacer el commit inicial.',
        suggestion: noUser ? 'Configura user.name y user.email (git config --global).' : 'Revisa la salida de git.',
        gitOutput: c.stderr.trim()
      })
    }
  } catch (e) {
    // la carpeta estaba vacía o no existía (targetFolder lo garantizó): se deja como estaba
    rmSync(dest, { recursive: true, force: true })
    if (existed) mkdirSync(dest, { recursive: true })
    throw e
  }
  return { path: dest }
}
