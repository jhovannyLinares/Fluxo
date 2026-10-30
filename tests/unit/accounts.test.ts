import { describe, expect, it } from 'vitest'
import { githubLogin, githubLogout, listAccounts, parseAzure, parseLines, testRemote, type GitRun } from '../../src/backend/git/accounts'
import type { RunOptions, RunResult } from '../../src/backend/git/runner'

/** A12: Cuentas como capa visual sobre Git Credential Manager; un git falso evita tocar las cuentas reales. */
const fake = (answers: Record<string, RunResult>) => {
  const calls: { args: string[]; opts?: RunOptions }[] = []
  const run: GitRun = async (args, opts) => {
    calls.push({ args: [...args], opts })
    return answers[args.slice(0, 3).join(' ')] ?? { code: 0, stdout: '', stderr: '' }
  }
  return { run, calls }
}
const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' })

describe('cuentas de Git Credential Manager', () => {
  it('lista las cuentas de GitHub y las organizaciones de Azure, sin abrir ventanas', async () => {
    const { run, calls } = fake({
      'credential-manager --version': ok('2.5.0+d34930736e\n'),
      'credential-manager github list': ok('jhovannyLinares\r\notra\n\n'),
      'credential-manager azure-repos list': ok('contoso:\n  (global) -> ana@contoso.com\n')
    })
    expect(await listAccounts(run)).toEqual({
      gcm: true,
      version: '2.5.0',
      github: ['jhovannyLinares', 'otra'],
      azure: [{ org: 'contoso', user: 'ana@contoso.com' }]
    })
    expect(calls.every((c) => c.opts?.env?.GCM_INTERACTIVE === 'never')).toBe(true)
  })

  it('sin GCM lo dice y no lista nada', async () => {
    const { run } = fake({ 'credential-manager --version': { code: 1, stdout: '', stderr: "git: 'credential-manager' is not a git command" } })
    expect(await listAccounts(run)).toEqual({ gcm: false, version: null, github: [], azure: [] })
  })

  it('iniciar sesión abre el navegador de GCM; cerrar sesión pasa la cuenta tal cual', async () => {
    const { run, calls } = fake({})
    await githubLogin(run)
    await githubLogout('jhovannyLinares', run)
    expect(calls[0]).toMatchObject({ args: ['credential-manager', 'github', 'login', '--browser'], opts: { env: { GCM_INTERACTIVE: 'always' } } })
    expect(calls[1]!.args).toEqual(['credential-manager', 'github', 'logout', 'jhovannyLinares'])
  })

  it('probar usa ls-remote en el repo abierto y traduce el rechazo del servidor', async () => {
    const { run, calls } = fake({ 'ls-remote --heads --end-of-options': { code: 128, stdout: '', stderr: 'remote: Invalid username or password.\nfatal: Authentication failed' } })
    await expect(testRemote('C:/repo', 'origin', run)).rejects.toThrow('El servidor rechazó la credencial.')
    expect(calls[0]).toMatchObject({ args: ['ls-remote', '--heads', '--end-of-options', 'origin'], opts: { cwd: 'C:/repo' } })
  })

  it('lectores: líneas sin vacías ni repetidas; Azure con varias organizaciones', () => {
    expect(parseLines('a\n\na\nb ')).toEqual(['a', 'b'])
    expect(parseAzure('o1:\n  (global) -> u1\no2:\n  https://dev.azure.com/o2/p/_git/r -> u2\n')).toEqual([
      { org: 'o1', user: 'u1' },
      { org: 'o2', user: 'u2' }
    ])
  })
})
