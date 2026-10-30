import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { FileChange } from '@shared/commit'
import { buildRefTree, type RefTreeNode } from '@shared/refs'
import type { LastCommit, WipArea, WipFiles } from '@shared/wip'
import { call } from '../api'
import { usePrefs } from '../prefs'
import { useAsk } from '../dialogs/ask'
import { WipFileMenu, type MenuEntry } from './WipFileMenu'
import { readView, STATUS_MARK, VIEW_KEY } from './CommitDetailView'

const areaOf = (f: FileChange, staged: boolean): WipArea => (staged ? 'staged' : f.untracked ? 'untracked' : 'unstaged')

/** Largo sugerido del resumen, como GitKraken: pasado esto el contador se pone en rojo, no bloquea. */
const SUMMARY_MAX = 72

/**
 * Cambios sin commit: «N cambios en <rama>», Ruta/Árbol, archivos sin stage y en stage (clic = diff; stage o
 * unstage por archivo al pasar el ratón, o de todo) y abajo la caja de commit con amend.
 */
export function WipDetailView({
  repoId,
  branch,
  files,
  openFile,
  onOpenFile,
  onChanged,
  onError,
  root,
  onHistory,
  onBlame,
  onOpenConflict,
  detached,
  currentName,
  incomingName
}: {
  repoId: string
  /** carpeta del repo, para abrir archivos afuera */
  root: string
  onHistory: (path: string) => void
  onBlame: (path: string) => void
  /** HEAD separado: avisa que los commits pueden perderse */
  detached: boolean
  /** clic en un archivo en conflicto: abre el editor de conflictos */
  onOpenConflict: (path: string) => void
  /** nombres de los dos lados para «Tomar actual / entrante» */
  currentName: string
  incomingName: string
  branch: string | null
  files: WipFiles | null
  openFile: { path: string; area: WipArea } | null
  onOpenFile: (file: FileChange, area: WipArea) => void
  /** el index cambió: pedir de nuevo la lista sin esperar a la vigilancia */
  onChanged: () => void
  onError: (e: unknown) => void
}) {
  const { t } = usePrefs()
  const [view, setView] = useState(readView)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)
  const [last, setLast] = useState<LastCommit | null>(null)
  const ask = useAsk()
  // selección múltiple con Ctrl (suma) o Shift (rango): el menú actúa sobre todas
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; f: FileChange | null; staged: boolean; conflict?: boolean; folder?: { path: string; files: FileChange[] } } | null>(null)

  // otro repo: el mensaje a medio escribir era de ese
  useEffect(() => {
    setSummary('')
    setDescription('')
    setAmend(false)
    setLast(null)
  }, [repoId])

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      onChanged()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }
  const stagePaths = (f: FileChange, staged: boolean) => (staged && f.oldPath ? [f.oldPath, f.path] : [f.path])
  const toggleStage = (f: FileChange, staged: boolean) =>
    run(() => call(staged ? 'wip:unstage' : 'wip:stage', { repoId, paths: stagePaths(f, staged) }))

  const absPath = (rel: string) => `${root.replace(/[\\/]+$/, '')}/${rel}`
  const openOutside = (rel: string, mode: 'open' | 'folder') => call('app:openFile', { path: absPath(rel), mode }).catch(onError)

  const discard = async (paths?: string[]) => {
    const body = paths ? t('ask.discardBody', { files: paths.join('\n') }) : t('ask.discardAllBody')
    if (!(await ask.askConfirm({ title: t('ask.discardTitle'), body, ok: t('ask.discardOk') }))) return
    await run(() => call('wip:discard', { repoId, paths }))
  }

  const ignore = async (f: FileChange, ext: boolean) => {
    const pattern = ext ? `*${f.path.slice(f.path.lastIndexOf('.'))}` : `/${f.path}`
    let stopTracking = false
    if (!f.untracked && !ext) {
      const choice = await ask.askChoice({
        title: t('ask.ignoreTitle'),
        body: t('ask.ignoreBody', { file: f.path }),
        a: t('ask.ignoreStop'),
        b: t('ask.ignoreJust')
      })
      if (!choice) return
      stopTracking = choice === 'a'
    }
    await run(() => call('wip:ignore', { repoId, pattern, stopTracking }))
  }

  /** archivos a los que se aplica el menú: la selección si el clic cayó en ella; si no, solo ese */
  const targets = (f: FileChange): FileChange[] => {
    const all = [...(files?.staged ?? []), ...(files?.unstaged ?? [])]
    const sel = all.filter((x) => picked.has(x.path))
    return picked.has(f.path) && sel.length > 1 ? sel : [f]
  }

  const stashFile = async (f: FileChange) => {
    const message = await ask.askText({ title: t('ask.stashTitle'), label: t('ask.stashLabel'), ok: t('ask.stashOk'), allowEmpty: true })
    if (message === null) return
    const paths = targets(f).flatMap((x) => stagePaths(x, false))
    await run(() => call('repo:stash', { repoId, message: message || undefined, paths, includeUntracked: true }))
  }

  const deleteFile = async (f: FileChange) => {
    if (!(await ask.askConfirm({ title: t('ask.deleteTitle'), body: t('ask.deleteBody', { file: f.path }), ok: t('ask.deleteOk') }))) return
    await run(() => call('wip:deleteFile', { repoId, path: f.path }))
  }

  const conflictMenuGroups = (path: string): MenuEntry[][] => [
    [
      { label: t('conflict.open'), run: () => onOpenConflict(path) },
      { label: t('conflict.takeCurrent', { name: currentName }), run: () => void run(() => call('conflict:take', { repoId, path, side: 'ours' })) },
      { label: t('conflict.takeIncoming', { name: incomingName }), run: () => void run(() => call('conflict:take', { repoId, path, side: 'theirs' })) }
    ]
  ]

  const folderMenuGroups = (folder: { path: string; files: FileChange[] }, staged: boolean): MenuEntry[][] => {
    const tracked = folder.files.filter((f) => !f.untracked)
    const paths = (fs: FileChange[]) => fs.flatMap((f) => stagePaths(f, staged))
    return [
      [
        { label: t('folder.stage'), run: () => void run(() => call(staged ? 'wip:unstage' : 'wip:stage', { repoId, paths: paths(folder.files) })) },
        ...(tracked.length ? [{ label: t('folder.discard'), run: () => void discard(paths(tracked)) }] : []),
        { label: t('folder.ignore', { folder: folder.path }), run: () => void ignoreFolder(folder) },
        { label: t('folder.stash'), run: () => void stashPaths(paths(folder.files)) }
      ],
      [
        { label: t('folder.open'), run: () => void openOutside(folder.path, 'open') },
        { label: t('folder.create'), run: () => void createFile(`${folder.path}/`) }
      ]
    ]
  }

  const ignoreFolder = async (folder: { path: string; files: FileChange[] }) => {
    let stopTracking = false
    if (folder.files.some((f) => !f.untracked)) {
      const choice = await ask.askChoice({
        title: t('ask.ignoreTitle'),
        body: t('ask.ignoreBody', { file: `${folder.path}/` }),
        a: t('ask.ignoreStop'),
        b: t('ask.ignoreJust')
      })
      if (!choice) return
      stopTracking = choice === 'a'
    }
    await run(() => call('wip:ignore', { repoId, pattern: `/${folder.path}/`, stopTracking }))
  }

  const stashPaths = async (paths: string[]) => {
    const message = await ask.askText({ title: t('ask.stashTitle'), label: t('ask.stashLabel'), ok: t('ask.stashOk'), allowEmpty: true })
    if (message === null) return
    await run(() => call('repo:stash', { repoId, message: message || undefined, paths, includeUntracked: true }))
  }

  const createFile = async (initial = '') => {
    const path = await ask.askText({ title: t('ask.fileTitle'), label: t('ask.fileLabel'), initial, ok: t('ask.fileOk') })
    if (path) await run(() => call('wip:createFile', { repoId, path }))
  }

  const fileMenuGroups = (f: FileChange, staged: boolean): MenuEntry[][] => {
    const tracked = !f.untracked
    const ext = f.path.includes('.') ? f.path.slice(f.path.lastIndexOf('.')) : null
    const noTool = t('file.needsTool')
    return [
      [
        { label: staged ? t('file.unstage') : t('file.stage'), run: () => void toggleStage(f, staged) },
        ...(tracked
          ? [
              targets(f).length > 1
                ? { label: t('file.discardSelected'), run: () => void discard(targets(f).flatMap((x) => stagePaths(x, false))) }
                : { label: t('file.discard'), run: () => void discard(stagePaths(f, false)) }
            ]
          : []),
        { label: t('file.ignoreFile', { file: f.path }), run: () => void ignore(f, false) },
        ...(ext ? [{ label: t('file.ignoreExt', { ext }), run: () => void ignore(f, true) }] : []),
        { label: t('file.stash'), run: () => void stashFile(f) }
      ],
      tracked
        ? [
            { label: t('fileHistory.open'), run: () => onHistory(f.path) },
            { label: t('fileHistory.openBlame'), run: () => onBlame(f.path) }
          ]
        : [],
      [
        { label: t('file.externalDiff'), why: noTool },
        { label: t('file.externalEditor'), why: noTool },
        { label: t('file.defaultProgram'), run: () => void openOutside(f.path, 'open') },
        { label: t('file.showInFolder'), run: () => void openOutside(f.path, 'folder') },
        { label: t('file.copyPath'), run: () => void call('app:copy', { text: absPath(f.path) }).catch(onError) }
      ],
      [
        { label: t('file.edit'), run: () => void openOutside(f.path, 'open') },
        { label: t('file.delete'), run: () => void deleteFile(f) }
      ]
    ]
  }

  // amend: se trae el mensaje del último commit para editarlo; al desmarcar, la caja vuelve a quedar vacía
  const toggleAmend = async (on: boolean) => {
    setAmend(on)
    if (!on) {
      setSummary('')
      setDescription('')
      setLast(null)
      return
    }
    try {
      const r = await call('wip:lastCommit', { repoId })
      if (!r.last) {
        setAmend(false)
        return
      }
      setLast(r.last)
      setSummary(r.last.summary)
      setDescription(r.last.description)
    } catch (e) {
      setAmend(false)
      onError(e)
    }
  }

  const setViewMode = (v: 'path' | 'tree') => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // solo se pierde la vista recordada
    }
  }

  const fileRow = (f: FileChange, label: string, depth: number, staged: boolean) => {
    const area = areaOf(f, staged)
    const open = openFile?.path === f.path && openFile.area === area
    return (
      <li
        key={`${area}:${f.path}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        className={`file-row st-${f.status}${open ? ' open' : ''}${picked.has(f.path) && picked.size > 1 ? ' picked' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, f, staged })
        }}
      >
        <button
          type="button"
          title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              setPicked((s) => {
                const n = new Set(s)
                if (n.has(f.path)) n.delete(f.path)
                else n.add(f.path)
                return n
              })
              setAnchor(f.path)
              return
            }
            if (e.shiftKey && anchor) {
              const order = [...(files?.unstaged ?? []), ...(files?.staged ?? [])].map((x) => x.path)
              const a = order.indexOf(anchor)
              const b = order.indexOf(f.path)
              if (a >= 0 && b >= 0) {
                setPicked(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)))
                return
              }
            }
            setPicked(new Set([f.path]))
            setAnchor(f.path)
            onOpenFile(f, area)
          }}
        >
          <span className="file-mark" aria-label={t(`file.status.${f.status}`)}>
            {STATUS_MARK[f.status]}
          </span>
          <span className="file-name">{label}</span>
          {f.untracked ? (
            <span className="file-stat muted">{t('wip.new')}</span>
          ) : f.binary ? (
            <span className="file-stat muted">{t('file.binary')}</span>
          ) : (
            <span className="file-stat">
              <span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span>
            </span>
          )}
        </button>
        <button type="button" className="btn wip-act wip-file-stage" disabled={busy} onClick={() => void toggleStage(f, staged)}>
          {t(staged ? 'wip.unstageFile' : 'wip.stageFile')}
        </button>
      </li>
    )
  }

  const toggle = (key: string) =>
    setClosed((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  /** archivos debajo de una carpeta: nuevos (+N) y modificados (✎N) */
  const counts = (n: RefTreeNode<FileChange>): { add: number; mod: number } =>
    n.item
      ? n.item.status === 'A'
        ? { add: 1, mod: 0 }
        : { add: 0, mod: 1 }
      : n.children.map(counts).reduce((a, b) => ({ add: a.add + b.add, mod: a.mod + b.mod }), { add: 0, mod: 0 })

  const tree = (nodes: RefTreeNode<FileChange>[], depth: number, staged: boolean): ReactElement[] =>
    nodes.flatMap((n) => {
      if (n.item) return [fileRow(n.item, n.label, depth, staged)]
      const key = `f:${staged}:${n.path}`
      const open = !closed.has(key)
      const c = counts(n)
      return [
        <li
          key={key}
          className="file-folder"
          style={{ paddingLeft: 6 + depth * 12 }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const leaves: FileChange[] = []
            const walk = (x: RefTreeNode<FileChange>) => (x.item ? leaves.push(x.item) : x.children.forEach(walk))
            walk(n)
            setMenu({ x: e.clientX, y: e.clientY, f: null, staged, folder: { path: n.path.replace(/\/$/, ''), files: leaves } })
          }}
        >
          <button type="button" aria-expanded={open} onClick={() => toggle(key)}>
            {open ? '▾' : '▸'} {n.label}
            {!open && c.add > 0 && <span className="add"> +{c.add}</span>}
            {!open && c.mod > 0 && <span className="mod"> ✎{c.mod}</span>}
          </button>
        </li>,
        ...(open ? tree(n.children, depth + 1, staged) : [])
      ]
    })

  const list = (items: FileChange[], staged: boolean) =>
    view === 'tree'
      ? tree(buildRefTree(items, (f) => f.path), 0, staged)
      : [...items].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' })).map((f) => fileRow(f, f.path, 0, staged))


  const section = (key: string, title: string, items: FileChange[], staged: boolean, action: string, onAction: () => void) => {
    const open = !closed.has(key)
    return (
      <section className="wip-section">
        <header>
          <button type="button" className="wip-section-title" aria-expanded={open} onClick={() => toggle(key)}>
            {open ? '▾' : '▸'} {title} ({items.length})
          </button>
          <button type="button" className="btn wip-act" disabled={busy || items.length === 0} onClick={onAction}>
            {action}
          </button>
        </header>
        {open && view === 'tree' && items.some((f) => f.path.includes('/')) && (
          <button type="button" className="link wip-expand" onClick={() => setClosed((s) => new Set([...s].filter((k) => !k.startsWith('f:'))))}>
            {t('wip.expandAll')}
          </button>
        )}
        {open && <ul className="file-list">{list(items, staged)}</ul>}
      </section>
    )
  }

  const conflicted = files?.conflicted ?? []
  const total = files ? files.staged.length + files.unstaged.length + conflicted.length : 0
  const stagedN = files?.staged.length ?? 0
  // qué falta para poder hacer commit; null = se puede
  const why = !files
    ? t('toolbar.loading')
    : !amend && stagedN === 0
      ? t('wip.needStaged')
      : !summary.trim()
        ? t('wip.needSummary')
        : null
  const doCommit = () => {
    if (why !== null || busy) return
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim()
    void run(async () => {
      await call('wip:commit', { repoId, message, amend })
      setSummary('')
      setDescription('')
      setAmend(false)
      setLast(null)
    })
  }
  const ctrlEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      doCommit()
    }
  }
  const label = amend ? t('wip.amendCommit') : stagedN === 1 ? t('wip.commitOne') : t('wip.commitN', { n: String(stagedN) })
  return (
    <div
      className="commit-detail wip-detail"
      onContextMenu={(e) => {
        // clic derecho en el espacio vacío: Crear archivo (los archivos abren su propio menú)
        if ((e.target as HTMLElement).closest('.file-row, fieldset')) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, f: null, staged: false })
      }}
    >
      <div className="detail-sha wip-head">
        <span>
          {t('wip.changesOn', { n: total })} {branch && <span className="wip-branch">{branch}</span>}
        </span>
        <button type="button" className="btn ghost wip-trash" title={t('wip.discardAll')} aria-label={t('wip.discardAll')} disabled={busy || total === 0} onClick={() => void discard()}>
          🗑
        </button>
      </div>
      {detached && (
        <p role="status" className="wip-detached">
          {t('wip.detached')}
        </p>
      )}
      {ask.node}
      {menu && (
        <WipFileMenu
          x={menu.x}
          y={menu.y}
          groups={menu.conflict && menu.f ? conflictMenuGroups(menu.f.path) : menu.folder ? folderMenuGroups(menu.folder, menu.staged) : menu.f ? fileMenuGroups(menu.f, menu.staged) : [[{ label: t('file.create'), run: () => void createFile() }]]}
          onClose={() => setMenu(null)}
        />
      )}
      <div className="files-toolbar">
        <button type="button" className={`btn ghost${view === 'path' ? ' on' : ''}`} onClick={() => setViewMode('path')}>
          {t('detail.viewPath')}
        </button>
        <button type="button" className={`btn ghost${view === 'tree' ? ' on' : ''}`} onClick={() => setViewMode('tree')}>
          {t('detail.viewTree')}
        </button>
      </div>
      {!files ? (
        <p className="muted">{t('toolbar.loading')}</p>
      ) : (
        <>
          {conflicted.length > 0 && (
            <section className="wip-section wip-conflicts">
              <header>
                <span className="wip-section-title">
                  ⚠ {t('conflict.files')} ({conflicted.length})
                </span>
                <button type="button" className="btn wip-act" disabled={busy} onClick={() => void run(() => call('conflict:resolveAll', { repoId }))}>
                  {t('conflict.markAll')}
                </button>
              </header>
              <ul className="file-list">
                {conflicted.map((f) => (
                  <li
                    key={f.path}
                    className="file-row st-U wip-conflict-row"
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setMenu({ x: e.clientX, y: e.clientY, f, staged: false, conflict: true })
                    }}
                  >
                    <button type="button" title={t('conflict.open')} onClick={() => onOpenConflict(f.path)}>
                      <span className="file-mark">⚠</span>
                      <span className="file-name">{f.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {section('unstaged', t('wip.unstagedFiles'), files.unstaged, false, t('wip.stageAll'), () => void run(() => call('wip:stage', { repoId })))}
          {section('staged', t('wip.stagedFiles'), files.staged, true, t('wip.unstageAll'), () => void run(() => call('wip:unstage', { repoId })))}
        </>
      )}
      <fieldset className="wip-commit" disabled={busy}>
        <div className="wip-commit-tab">⊸ Commit</div>
        <label className="check">
          <input type="checkbox" checked={amend} onChange={(e) => void toggleAmend(e.target.checked)} /> {t('wip.amend')}
        </label>
        <input
          className="input"
          placeholder={t('wip.summary')}
          aria-label={t('wip.summary')}
          value={summary}
          onChange={(e) => setSummary(e.target.value.replace(/[\r\n]+/g, ' '))}
          onKeyDown={ctrlEnter}
        />
        <div className={`wip-count${summary.length > SUMMARY_MAX ? ' over' : ''}`}>
          {summary.length} / {SUMMARY_MAX}
        </div>
        <textarea
          className="input"
          rows={4}
          placeholder={t('wip.description')}
          aria-label={t('wip.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={ctrlEnter}
        />
        {amend && last?.pushedTo && <div className="wip-warn">{t('wip.amendPushed', { remote: last.pushedTo })}</div>}
        <button
          type="button"
          className={`btn wip-commit-btn${why === null ? (amend ? ' go amend' : ' go') : ''}`}
          disabled={why !== null}
          onClick={doCommit}
        >
          {why ?? label}
        </button>
      </fieldset>
    </div>
  )
}
