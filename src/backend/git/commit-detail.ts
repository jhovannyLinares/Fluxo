import { AppException } from '@shared/errors'
import type { CommitDetail, FileChange } from '@shared/commit'
import { runGit, runGitOk } from './runner'

const FIELDS = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B']
const FORMAT = FIELDS.join('%x00')

/**
 * Trailers `Co-authored-by: Nombre <correo>` del mensaje (C10), uno por correo (sin distinguir mayúsculas):
 * un commit unido con squash repite el trailer de cada commit original.
 */
export function parseCoAuthors(body: string): { name: string; email: string }[] {
  const out: { name: string; email: string }[] = []
  const seen = new Set<string>()
  for (const m of body.matchAll(/^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)) {
    const key = m[2]!.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: m[1]!, email: m[2]! })
  }
  return out
}

/**
 * Salida de `git diff-tree -r -z -M --raw --numstat`: primero las entradas raw (`:modo modo sha sha ESTADO`, ruta;
 * con R/C dos rutas), después numstat (`añadidas\tquitadas\truta`, o con renombre `a\tq\t` + vieja + nueva;
 * binario = `-\t-`).
 */
export function parseDiffTree(out: string): FileChange[] {
  const t = out.split('\0')
  const files: FileChange[] = []
  const byPath = new Map<string, FileChange>()
  let i = 0
  while (i < t.length) {
    const tok = t[i]!
    if (tok.startsWith(':')) {
      const status = tok.split(' ').at(-1)!
      const letter = status[0] as FileChange['status']
      if (letter === 'R' || letter === 'C') {
        const f: FileChange = { status: letter, oldPath: t[i + 1]!, path: t[i + 2]!, additions: 0, deletions: 0, binary: false }
        files.push(f)
        byPath.set(f.path, f)
        i += 3
      } else {
        const f: FileChange = { status: letter, path: t[i + 1]!, additions: 0, deletions: 0, binary: false }
        files.push(f)
        byPath.set(f.path, f)
        i += 2
      }
    } else if (/^(\d+|-)\t(\d+|-)\t/.test(tok)) {
      const [a, d, path] = tok.split('\t') as [string, string, string]
      let target = path
      if (path === '') {
        target = t[i + 2]! // renombre: vieja y nueva en los dos tokens siguientes
        i += 3
      } else i += 1
      const f = byPath.get(target)
      if (f) {
        f.binary = a === '-'
        f.additions = a === '-' ? 0 : Number(a)
        f.deletions = d === '-' ? 0 : Number(d)
      }
    } else i += 1
  }
  return files
}

/**
 * Detalle de un commit (H18): metadatos completos, coautores y archivos cambiados contra el primer padre
 * (C18: un merge se compara con su primer padre y la UI lo dice). Dos procesos git por commit.
 * `base`: compara contra ese commit o árbol en lugar del primer padre (fila con commits agrupados: el padre
 * del más viejo del grupo, así los archivos suman todo el grupo).
 */
export async function commitDetail(root: string, hash: string, base?: string): Promise<CommitDetail> {
  const meta = await runGit(['show', '-s', `--format=${FORMAT}`, hash, '--'], { cwd: root })
  if (meta.code !== 0) {
    throw new AppException({ code: 'GIT_FAILED', message: 'No se encontró ese commit.', gitOutput: meta.stderr.trim() })
  }
  const [h, parents, author, email, at, committer, committerEmail, ct, ...rest] = meta.stdout.split('\0')
  const message = rest.join('\0').replace(/\n+$/, '')
  const [subject = '', ...bodyLines] = message.split('\n')
  const parentList = parents ? parents.split(' ').filter(Boolean) : []
  const from = base ?? parentList[0]
  const range = from ? [from, h!] : ['--root', h!]
  const diff = await runGitOk(['diff-tree', '-r', '-z', '-M', '--raw', '--numstat', '--no-commit-id', ...range], {
    cwd: root
  })
  return {
    hash: h!,
    parents: parentList,
    author: author!,
    email: email!,
    time: Number(at),
    committer: committer!,
    committerEmail: committerEmail!,
    commitTime: Number(ct),
    subject,
    body: bodyLines.join('\n').replace(/^\n+/, ''),
    coAuthors: parseCoAuthors(message),
    files: parseDiffTree(diff)
  }
}

/** Todos los archivos del árbol del commit («ver todos los archivos», C19). */
export async function commitTree(root: string, hash: string): Promise<string[]> {
  const out = await runGitOk(['ls-tree', '-r', '-z', '--name-only', hash, '--'], { cwd: root, maxBytes: 64 * 1024 * 1024 })
  return out.split('\0').filter(Boolean)
}
