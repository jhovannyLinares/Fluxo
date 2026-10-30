import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { RunResult } from '../../src/backend/git/runner'
import { accountAccess, repoAccount, setRepoAccount } from '../../src/backend/git/repo-account'
import { git, tempDir } from '../fixtures/make-repo'

/** Cuenta de GitHub por repo: se guarda en su .git/config y cada cuenta se prueba contra el remoto. */
describe('cuenta por repo', { timeout: 120_000 }, () => {
  const tmp = tempDir('cg-acct-')
  const d = join(tmp.dir, 'repo')
  git(tmp.dir, ['init', '-q', d])
  git(d, ['remote', 'add', 'origin', 'https://github.com/org-nss-insis/dev-cti-inisis'])
  afterAll(() => tmp.cleanup())

  it('sin cuenta fijada: current null; fijarla la deja en el repo, para github.com; quitarla vuelve a automática', async () => {
    expect((await repoAccount(d)).current).toBeNull()
    await setRepoAccount(d, 'ext-jlinaresf-cti_psalud')
    expect(git(d, ['config', '--local', '--get', 'credential.https://github.com.username']).trim()).toBe('ext-jlinaresf-cti_psalud')
    expect(await repoAccount(d)).toMatchObject({ remote: 'origin', owner: 'org-nss-insis', current: 'ext-jlinaresf-cti_psalud' })
    await setRepoAccount(d, null)
    await setRepoAccount(d, null) // quitar dos veces no falla
    expect((await repoAccount(d)).current).toBeNull()
  })

  it('repo sin remoto de GitHub: no hay cuenta que elegir', async () => {
    const other = join(tmp.dir, 'otro')
    git(tmp.dir, ['init', '-q', other])
    git(other, ['remote', 'add', 'origin', 'https://dev.azure.com/org/p/_git/r'])
    expect(await repoAccount(other)).toEqual({ remote: null, owner: null, current: null, accounts: [] })
  })

  it('acceso por cuenta: entra, pide SSO o no tiene acceso (sin abrir ventanas)', async () => {
    const calls: string[][] = []
    const run = async (args: readonly string[], opts?: { env?: NodeJS.ProcessEnv }): Promise<RunResult> => {
      if (args[0] === 'config') return { stdout: 'remote.origin.url https://github.com/org-nss-insis/dev-cti-inisis\n', stderr: '', code: 0 }
      calls.push([...args])
      expect(opts?.env?.GCM_INTERACTIVE).toBe('never')
      const who = args[1]!.split('=')[1]
      if (who === 'buena') return { stdout: 'abc\trefs/heads/main\n', stderr: '', code: 0 }
      if (who === 'sso') return { stdout: '', stderr: "remote: The 'org-nss-insis' organization has enabled or enforced SAML SSO.\n", code: 128 }
      return { stdout: '', stderr: 'remote: Repository not found.\n', code: 128 }
    }
    expect(await accountAccess(d, ['buena', 'sso', 'personal'], run)).toEqual({ buena: 'ok', sso: 'sso', personal: 'none' })
    expect(calls[0]).toEqual(['-c', 'credential.https://github.com.username=buena', 'ls-remote', '--heads', '--end-of-options', 'origin'])
  })
})
