const DEFAULT_REMOTE = 'origin'

export interface PrMenuBranch {
  /** local: `feature`; solo remota: `origin/feature` */
  name: string
  current: boolean
  remoteOnly?: boolean | undefined
}

export interface PrMenuEntry {
  remote: string
  /** rama de origen del PR en el remoto: la actual */
  from: string
  /** destino mostrado (`origin/feature`); null en la rama actual, que abre el PR sin destino elegido */
  to: string | null
  /** destino sin el nombre del remoto, para preseleccionarlo en el formulario; undefined = el principal del repo */
  base: string | undefined
}

/**
 * «Start a pull request to … from …» como GitKraken: la rama clicada es el DESTINO y la actual es el ORIGEN. El remoto
 * sale del upstream de la rama clicada; sin upstream se supone `origin`.
 */
export function prMenuEntry(branch: PrMenuBranch, upstream: string | null, currentName: string): PrMenuEntry {
  const remote = (branch.remoteOnly ? branch.name : (upstream ?? `${DEFAULT_REMOTE}/${branch.name}`)).split('/')[0] ?? DEFAULT_REMOTE
  const from = `${remote}/${currentName}`
  if (branch.current) return { remote, from, to: null, base: undefined }
  if (branch.remoteOnly) return { remote, from, to: branch.name, base: branch.name.slice(remote.length + 1) }
  return { remote, from, to: `${remote}/${branch.name}`, base: branch.name }
}
