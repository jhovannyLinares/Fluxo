import { useEffect, useRef, type ReactElement } from 'react'
import type { GraphRow } from '@shared/graph-types'
import type { MessageKey } from '@shared/i18n'
import { usePrefs } from '../prefs'

/** Rama local (o remota) que apunta al commit: las entradas de rama del menú actúan sobre ella. */
export interface MenuBranch {
  name: string
  ref: string
  current: boolean
  /** solo existe en el remoto (`origin/X`): sin Pull, Push, Set Upstream, Rename ni Merge */
  remoteOnly?: boolean
}

/**
 * Menú de clic derecho sobre un commit. Funcionan las entradas que no escriben
 * (copiar, enlaces, anclar, Solo), Pull en la rama actual y el cherry pick de uno o varios commits; las demás se
 * ven en gris hasta la v1.2.
 */
export function CommitMenu(p: {
  x: number
  y: number
  row: GraphRow
  branch: MenuBranch | null
  /** rama de HEAD: los textos de Fast-forward, Merge y Rebase la nombran */
  currentName: string | null
  /** `origin/X` si la rama tiene remota (Delete origin/X, Delete X and origin/X) */
  remote: string | null
  pinned: boolean
  onClose: () => void
  onPull: () => void
  /** push de la rama actual; `pushWhy` = motivo por el que está en gris, o null */
  onPush: () => void
  pushWhy: string | null
  onCopy: (text: string) => void
  onCopyLink: (kind: 'commit' | 'branch') => void
  /** ancla (o desancla) la línea de esa rama: `refs/heads/x` o `refs/remotes/origin/x` */
  onPin: (ref: string) => void
  /** rama que está anclada ahora, para decir «Desanclar» */
  pinnedRef: string | null
  onSolo: () => void
  onHide: () => void
  /** commits a los que se aplica el cherry pick (la selección o solo este) */
  count: number
  onCherryPick: () => void
  /** «Crear rama aquí»: pide el nombre y crea la rama en este commit */
  onCreateBranch: () => void
  /** cambiar a la rama del commit (la remota crea la local que la sigue) */
  onCheckout: () => void
  /** Fast-forward / Merge / Rebase de la rama del menú en la actual */
  onIntegrate: (kind: 'ff' | 'merge' | 'rebase') => void
  onInteractiveRebase: () => void
  onRename: () => void
  onPullBranch: () => void
  onPushBranch: () => void
  /** «Start a pull request to … from …»: texto de la entrada, o null si el remoto no es de GitHub */
  prLabel: string | null
  onPr: () => void
  onCheckoutCommit: () => void
  onCheckoutRemote: () => void
  onWorktree: (ref: string | null) => void
  onEditMessage: () => void
  onDrop: () => void
  /** abierto desde una fila del panel de ramas: GitKraken muestra Checkout, Worktree y Pin planos, de esa rama */
  plain?: boolean
  onMove: (dir: 'up' | 'down') => void
  onReset: (mode: 'soft' | 'mixed' | 'hard') => void
  onRevert: () => void
  onTag: (annotated: boolean) => void
  onSetUpstream: () => void
  onDelete: (scope: 'local' | 'remote' | 'both') => void
  /** clic derecho en un stash del grafo: Apply, Pop, Delete y Edit message */
  onStash: (op: 'apply' | 'pop' | 'drop' | 'rename') => void
  /** motivo por el que no se puede (un merge, ya está en la rama, consultando); null = se puede */
  cherryWhy: string | null
  /** squash de la selección (solo con dos o más): motivo por el que no se puede, o null */
  squashWhy: string | null
  onSquash: () => void
  /** B2: comparar el commit con el directorio de trabajo */
  onCompare: () => void
  /** B3: cambio acumulado de la selección, del más viejo al más nuevo */
  onDiffRange: () => void
}) {
  const { t } = usePrefs()
  const ref = useRef<HTMLDivElement>(null)
  const { onClose } = p

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [onClose])

  // el menú no se sale de la ventana: se abre hacia arriba o a la izquierda si hace falta
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`
    if (r.right > window.innerWidth) el.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`
  }, [])

  const item = (label: string, fn: () => void): ReactElement => (
    <button
      key={label}
      type="button"
      role="menuitem"
      onClick={() => {
        fn()
        onClose()
      }}
    >
      {label}
    </button>
  )
  const soon = (key: MessageKey, vars?: Record<string, string>): ReactElement => {
    const label = t(key, vars)
    return (
      <button key={label} type="button" role="menuitem" disabled title={t('toolbar.soon', { action: label })}>
        {label}
      </button>
    )
  }
  const disabled = (label: string, why: string): ReactElement => (
    <button key={label} type="button" role="menuitem" disabled title={why}>
      {label}
    </button>
  )
  const sub = (label: string, entries: { label: string; run: () => void }[]): ReactElement => (
    <div key={label} className="menu-sub">
      <button type="button" role="menuitem" aria-haspopup="menu">
        {label}
        <span className="menu-sub-arrow" aria-hidden="true">
          ›
        </span>
      </button>
      <div className="refs-menu commit-menu sub" role="menu" aria-label={label}>
        <div className="refs-menu-group">{entries.map((e) => item(e.label, e.run))}</div>
      </div>
    </div>
  )
  const b = p.branch
  const pinEntry = (br: MenuBranch): ReactElement => {
    const remoteRef = p.remote ? `refs/remotes/${p.remote}` : null
    const label = (ref: string) => (p.pinnedRef === ref ? t('filter.unpin') : t('filter.pin'))
    // con rama local y remota, GitKraken ofrece las dos en un submenú; con una sola, la entrada va directa
    if (remoteRef && !br.remoteOnly && !p.plain) {
      return sub(
        p.pinnedRef === br.ref || p.pinnedRef === remoteRef ? t('filter.unpin') : t('filter.pin'),
        [
          { label: br.name, run: () => p.onPin(br.ref) },
          { label: p.remote!, run: () => p.onPin(remoteRef) }
        ]
      )
    }
    return item(label(br.ref), () => p.onPin(br.ref))
  }
  const stashGroups: ReactElement[][] = [
    [
      item(t('stash.apply'), () => p.onStash('apply')),
      item(t('stash.pop'), () => p.onStash('pop')),
      item(t('stash.drop'), () => p.onStash('drop')),
      item(t('stash.edit'), () => p.onStash('rename'))
    ],
    [item(t('cm.copySha'), () => p.onCopy(p.row.hash))]
  ]
  const groups: ReactElement[][] = p.row.kind === 'stash' ? stashGroups : [
    b?.current
      ? [
          item('Pull (fast-forward if possible)', p.onPull),
          p.pushWhy === null ? item(t('cm.push'), p.onPush) : disabled(t('cm.push'), p.pushWhy),
          item(t('cm.setUpstream'), p.onSetUpstream)
        ]
      : b && !b.remoteOnly
        ? [item(t('cm.pull'), p.onPullBranch), item(t('cm.push'), p.onPushBranch), item(t('cm.setUpstream'), p.onSetUpstream)]
        : [],
    // GitKraken: sobre otra rama, integrarla en la actual
    b && !b.current && p.currentName
      ? b.remoteOnly
        ? [item(t('cm.rebase', { current: p.currentName, branch: b.name }), () => p.onIntegrate('rebase'))]
        : [
            item(t('cm.fastForward', { current: p.currentName, branch: b.name }), () => p.onIntegrate('ff')),
            item(t('cm.merge', { current: p.currentName, branch: b.name }), () => p.onIntegrate('merge')),
            item(t('cm.rebase', { current: p.currentName, branch: b.name }), () => p.onIntegrate('rebase')),
            item(t('cm.interactiveRebase', { current: p.currentName, branch: b.name }), p.onInteractiveRebase)
          ]
      : [],
    b && p.prLabel ? [item(p.prLabel, p.onPr)] : [],
    // GitKraken: con una rama en el commit, «Checkout >» ofrece la rama, su remota y este commit
    [
      b && p.plain && !b.remoteOnly
        ? b.current
          ? disabled(t('cm.checkoutBranch', { branch: b.name }), t('cm.alreadyHere'))
          : item(t('cm.checkoutBranch', { branch: b.name }), p.onCheckout)
        : b
        ? sub(t('cm.checkoutSub'), [
            ...(!b.current ? [{ label: b.name, run: p.onCheckout }] : []),
            ...(p.remote && !b.remoteOnly ? [{ label: p.remote, run: p.onCheckoutRemote }] : []),
            { label: t('cm.thisCommit'), run: p.onCheckoutCommit }
          ])
        : item(t('cm.checkout'), p.onCheckoutCommit)
    ],
    [
      b && p.plain && !b.remoteOnly
        ? item(t('cm.worktreeBranch', { branch: b.name }), () => p.onWorktree(b.name))
        : b
        ? sub(t('cm.worktreeSub'), [
            ...(!b.remoteOnly ? [{ label: b.name, run: () => p.onWorktree(b.name) }] : []),
            { label: t('cm.thisCommit'), run: () => p.onWorktree(null) }
          ])
        : item(t('cm.worktree'), () => p.onWorktree(null))
    ],
    [
      item(t('cm.createBranch'), p.onCreateBranch),
      p.cherryWhy === null
        ? item(p.count > 1 ? t('cm.cherryPickN', { n: String(p.count) }) : t('cm.cherryPick'), p.onCherryPick)
        : disabled(p.count > 1 ? t('cm.cherryPickN', { n: String(p.count) }) : t('cm.cherryPick'), p.cherryWhy),
      ...(p.currentName
        ? [
            sub(
              t('cm.resetSub', { branch: p.currentName }),
              (['soft', 'mixed', 'hard'] as const).map((m) => ({
                label: t(m === 'soft' ? 'cm.resetSoftS' : m === 'mixed' ? 'cm.resetMixedS' : 'cm.resetHardS'),
                run: () => p.onReset(m)
              }))
            )
          ]
        : []),
      item(t('cm.revert'), p.onRevert)
    ],
    // como GitKraken, en cualquier commit; si no está en la rama actual el backend lo explica
    [item(t('cm.editMessage'), p.onEditMessage), item(t('cm.dropCommit'), p.onDrop), item(t('cm.moveUp'), () => p.onMove('up')), item(t('cm.moveDown'), () => p.onMove('down')), ...(b?.current ? [soon('cm.applyPatch')] : [])],
    b
      ? [
          ...(b.remoteOnly ? [] : [item(t('cm.rename', { branch: b.name }), p.onRename), b.current ? disabled(t('cm.delete', { branch: b.name }), t('cm.deleteCurrent')) : item(t('cm.delete', { branch: b.name }), () => p.onDelete('local'))]),
          ...(b.remoteOnly ? [item(t('cm.deleteRemote', { remote: b.name }), () => p.onDelete('remote'))] : p.remote ? [item(t('cm.deleteRemote', { remote: p.remote }), () => p.onDelete('remote')), b.current ? disabled(t('cm.deleteBoth', { branch: b.name, remote: p.remote }), t('cm.deleteCurrent')) : item(t('cm.deleteBoth', { branch: b.name, remote: p.remote }), () => p.onDelete('both'))] : [])
        ]
      : [],
    p.count > 1
      ? [
          p.squashWhy === null
            ? item(t('cm.squashN', { n: String(p.count) }), p.onSquash)
            : disabled(t('cm.squashN', { n: String(p.count) }), p.squashWhy)
        ]
      : [],
    [
      ...(b ? [item(t('cm.copyBranch'), () => p.onCopy(b.name))] : []),
      item(t('cm.copySha'), () => p.onCopy(p.row.hash)),
      ...(b ? [item(t('cm.copyBranchLink', { branch: b.name }), () => p.onCopyLink('branch'))] : []),
      item(t('cm.copyCommitLink'), () => p.onCopyLink('commit'))
    ],
    b ? [item(t('refs.hide', { name: b.name }), p.onHide), pinEntry(b), item(t('refs.solo'), p.onSolo)] : [],
    // B2 con un commit; B3 con varios: el cambio acumulado entre el más viejo y el más nuevo
    p.count === 1 ? [item(t('cm.compareWorktree'), p.onCompare)] : [item(t('cm.diffN', { n: String(p.count) }), p.onDiffRange)],
    [item(t('cm.tag'), () => p.onTag(false)), item(t('cm.annotatedTag'), () => p.onTag(true))]
  ].filter((g) => g.length > 0)

  return (
    <div ref={ref} className="refs-menu commit-menu" role="menu" style={{ left: p.x, top: p.y }}>
      {groups.map((g, i) => (
        <div key={i} className="refs-menu-group">
          {g}
        </div>
      ))}
    </div>
  )
}
