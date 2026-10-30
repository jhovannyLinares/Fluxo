import { useEffect, useMemo, useState } from 'react'
import type { AccountsInfo } from '@shared/accounts'
import { type ApiError, call, toAppError } from '../api'

export const PROVIDERS = [
  { id: 'github', label: 'GitHub.com' },
  { id: 'ghe', label: 'GitHub Enterprise Server' },
  { id: 'gitlab', label: 'GitLab.com' },
  { id: 'gitlab-sm', label: 'GitLab (Self-Managed)' },
  { id: 'bitbucket', label: 'Bitbucket.org' },
  { id: 'bitbucket-dc', label: 'Bitbucket Data Center' },
  { id: 'azure', label: 'Azure DevOps' }
] as const
export type ProviderId = 'local' | (typeof PROVIDERS)[number]['id']

/** Solo estos dos pueden crear el repo en el servidor; el resto muestra «not connected» como GitKraken sin cuenta. */
export const canCreateRemote = (p: ProviderId): p is 'github' | 'azure' => p === 'github' || p === 'azure'

const NO_GCM: AccountsInfo = { gcm: false, version: null, github: [], azure: [] }

export interface AccountOption {
  value: string
  text: string
}

/** Cuentas de Git Credential Manager del proveedor elegido, la cuenta elegida y, en Azure, los proyectos de su organización. */
export function useInitAccounts(provider: ProviderId, onError: (e: ApiError['info']) => void) {
  const [accounts, setAccounts] = useState<AccountsInfo | null>(null)
  const [account, setAccount] = useState('')
  const [project, setProject] = useState('')
  const [projects, setProjects] = useState<string[]>([])

  useEffect(() => {
    if (!canCreateRemote(provider) || accounts) return
    call('accounts:list', {}).then(setAccounts, () => setAccounts(NO_GCM))
  }, [provider, accounts])

  const options = useMemo<AccountOption[]>(() => {
    if (provider === 'github') return (accounts?.github ?? []).map((a) => ({ value: a, text: a }))
    if (provider === 'azure') return (accounts?.azure ?? []).map((a) => ({ value: `${a.org}|${a.user}`, text: `${a.org} · ${a.user}` }))
    return []
  }, [provider, accounts])

  useEffect(() => {
    setAccount((current) => (options.some((o) => o.value === current) ? current : (options[0]?.value ?? '')))
  }, [options])

  // en Azure la cuenta es «organización|usuario»
  const [azureOrg = '', azureUser = ''] = provider === 'azure' ? account.split('|') : []
  useEffect(() => {
    setProject('')
    setProjects([])
    if (provider !== 'azure' || !azureOrg || !azureUser) return
    let alive = true
    call('azure:projects', { org: azureOrg, account: azureUser }).then(
      (r) => {
        if (!alive) return
        setProjects(r.projects)
        setProject(r.projects[0] ?? '')
      },
      (e) => alive && onError(toAppError(e))
    )
    return () => {
      alive = false
    }
  }, [provider, azureOrg, azureUser, onError])

  const hasGithubAccount = (accounts?.github.length ?? 0) > 0
  const hasAzureAccount = (accounts?.azure.length ?? 0) > 0
  const connected = (provider === 'github' && hasGithubAccount) || (provider === 'azure' && hasAzureAccount)
  return { accounts, setAccounts, options, account, setAccount, azureOrg, azureUser, project, setProject, projects, connected }
}
export type InitAccounts = ReturnType<typeof useInitAccounts>
