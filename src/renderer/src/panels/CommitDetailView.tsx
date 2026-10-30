import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { changeSummary, type CommitDetail, type FileChange } from '@shared/commit'
import { buildRefTree, matchesRefFilter, type RefTreeNode } from '@shared/refs'
import type { GraphRow } from '@shared/graph-types'
import { formatPattern } from '../format'
import { usePrefs } from '../prefs'

export const VIEW_KEY = 'fluxo.detail.view'
export const readView = (): 'path' | 'tree' => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'path'
  } catch {
    return 'path'
  }
}

export const STATUS_MARK: Record<FileChange['status'], string> = { A: '+', M: '~', D: '−', R: '→', C: '⧉', T: '≠', U: '!', X: '?' }

/** Alto inicial del mensaje largo: 8 líneas; quien lo agranda arrastrando la esquina, lo deja así para los demás. */
const BODY_KEY = 'fluxo.detail.bodyHeight'
const BODY_H = 160

/**
 * Cuerpo del mensaje del commit. Un mensaje corto se ve entero; uno largo arranca con un alto fijo, con su barra de
 * scroll, y se agranda o achica arrastrando la esquina, para no tener que bajar mucho hasta los archivos.
 */
function CommitBody({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null)
  const [long, setLong] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = ''
    const saved = (() => {
      try {
        return Number(localStorage.getItem(BODY_KEY)) || BODY_H
      } catch {
        return BODY_H
      }
    })()
    const isLong = el.scrollHeight > saved
    setLong(isLong)
    if (isLong) el.style.height = `${saved}px`
  }, [text])

  // al soltar la esquina se recuerda el alto elegido
  const remember = () => {
    const h = ref.current?.offsetHeight
    if (!long || !h) return
    try {
      localStorage.setItem(BODY_KEY, String(h))
    } catch {
      // solo se pierde el alto recordado
    }
  }

  return (
    <pre ref={ref} className={`commit-body${long ? ' long' : ''}`} onMouseUp={remember}>
      {text}
    </pre>
  )
}

/**
 * Detalle de commit (H18): mensaje completo y coautores (C10), todos los padres y aviso de que la comparación
 * es contra el primero (C18), archivos con resumen, vista ruta/árbol, orden y «ver todos los archivos» (C19).
 */
export function CommitDetailView({
  row,
  detail,
  loadTree,
  onCopy,
  onOpenWeb,
  onGoTo,
  onOpenFile,
  onFileMenu,
  openFile
}: {
  row: GraphRow
  detail: CommitDetail | null
  loadTree: () => Promise<string[]>
  onCopy: (text: string) => void
  /** H23: abrir el commit en la web; null en un stash (no está en el remoto) */
  onOpenWeb: (() => void) | null
  onGoTo: (hash: string) => void
  /** abrir el diff de un archivo (H19) */
  onOpenFile: (file: FileChange) => void
  /** clic derecho en un archivo: historial y blame (A1) */
  onFileMenu: (path: string, x: number, y: number) => void
  openFile: string | null
}) {
  const { lang, t, prefs } = usePrefs()
  const [view, setView] = useState(readView)
  const [desc, setDesc] = useState(false)
  const [all, setAll] = useState<string[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')

  // otro commit: se vuelve a la lista de cambios
  useEffect(() => {
    setShowAll(false)
    setAll(null)
    setQuery('')
  }, [row.hash])

  const setViewMode = (v: 'path' | 'tree') => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // solo se pierde la vista recordada
    }
  }

  const files = detail?.files ?? []
  const summary = changeSummary(files)
  const changed = new Map(files.map((f) => [f.path, f]))
  const sorted = (paths: string[]) => [...paths].sort((a, b) => (desc ? -1 : 1) * a.localeCompare(b, undefined, { sensitivity: 'base' }))

  const fileRow = (path: string, label: string, depth: number) => {
    const f = changed.get(path)
    return (
      <li
        key={path}
        style={{ paddingLeft: 6 + depth * 12 }}
        className={`file-row${f ? ` st-${f.status}` : ' unchanged'}${openFile === path ? ' open' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault()
          onFileMenu(path, e.clientX, e.clientY)
        }}
      >
        {f ? (
          <button type="button" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path} onClick={() => onOpenFile(f)}>
            <span className="file-mark" aria-label={t(`file.status.${f.status}`)}>
              {STATUS_MARK[f.status]}
            </span>
            <span className="file-name">{label}</span>
            {f.binary ? (
              <span className="file-stat muted">{t('file.binary')}</span>
            ) : (
              <span className="file-stat">
                <span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span>
              </span>
            )}
          </button>
        ) : (
          <span className="file-name muted">{label}</span>
        )}
      </li>
    )
  }

  const tree = (nodes: RefTreeNode<string>[], depth: number): ReactElement[] =>
    nodes.flatMap((n) =>
      n.item
        ? [fileRow(n.item, n.label, depth)]
        : [
            <li key={`d:${n.path}`} className="file-folder" style={{ paddingLeft: 6 + depth * 12 }}>
              {n.label}/
            </li>,
            ...tree(n.children, depth + 1)
          ]
    )

  const paths = showAll && all ? all.filter((p) => matchesRefFilter(p, query)) : files.map((f) => f.path)
  const list =
    view === 'tree'
      ? tree(desc ? buildRefTree(paths, (p) => p).reverse() : buildRefTree(paths, (p) => p), 0)
      : sorted(paths).map((p) => fileRow(p, p, 0))

  return (
    <div className="commit-detail">
      {/* cabecera del panel: «commit: <sha>» y las acciones a la derecha */}
      <div className="detail-sha">
        <span className="mono muted" title={row.hash}>
          commit: {row.hash.slice(0, 7)}
        </span>
        <span className="detail-actions">
          <button type="button" className="btn ghost" onClick={() => onCopy(row.hash)}>
            {t('refs.copySha')}
          </button>
          {onOpenWeb && (
            <button type="button" className="btn ghost" onClick={onOpenWeb}>
              {t('web.commit')}
            </button>
          )}
        </span>
      </div>
      <h2>{detail?.subject ?? row.subject}</h2>
      {detail?.body && <CommitBody text={detail.body} />}
      {/* autor: avatar, nombre y fecha en una línea; el color del avatar dice IA o humano */}
      <div className="who" title={row.email}>
        <span className={`avatar ${row.ai ? 'ai' : 'human'}`} aria-hidden="true">
          {row.author.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span>
          <span className="who-name">{row.author}</span>
          <span className="muted who-date">{t('detail.authored', { date: formatPattern(row.time, prefs.detailDate, lang) })}</span>
        </span>
      </div>
      {row.ai && <div className="ai-badge">{t('detail.aiBadge')}</div>}
      <dl>
        {detail && (detail.committer !== detail.author || detail.committerEmail !== detail.email) && (
          <>
            <dt>{t('detail.committer')}</dt>
            <dd>
              {detail.committer} &lt;{detail.committerEmail}&gt;
            </dd>
          </>
        )}
        {detail && detail.coAuthors.length > 0 && (
          <>
            <dt>{t('detail.coAuthors')}</dt>
            <dd>
              {detail.coAuthors.map((c) => (
                <div key={c.email}>
                  {c.name} &lt;{c.email}&gt;
                </div>
              ))}
            </dd>
          </>
        )}
        <dt>{t('detail.parents')}</dt>
        <dd className="mono">
          {row.parents.length === 0
            ? '—'
            : row.parents.map((p, i) => (
                <button key={p} type="button" className="link" onClick={() => onGoTo(p)}>
                  {p.slice(0, 7)}
                  {i < row.parents.length - 1 ? ',' : ''}
                </button>
              ))}
        </dd>
        {row.refs.length > 0 && (
          <>
            <dt>{t('detail.refs')}</dt>
            <dd>{row.refs.map((r) => r.name).join(', ')}</dd>
          </>
        )}
      </dl>

      {row.parents.length > 1 && <p className="muted merge-note">{t('detail.mergeNote', { sha: row.parents[0]!.slice(0, 7) })}</p>}
      {row.group && <p className="muted merge-note">{t('detail.groupNote', { n: String(row.group.count + 1) })}</p>}

      <section className="files">
        <header>
          <strong>{t('detail.files', { n: files.length })}</strong>
          <span className="muted file-summary">
            {(Object.keys(summary) as FileChange['status'][]).map((s) => t(`file.summary.${s}`, { n: summary[s]! })).join(' · ')}
          </span>
        </header>
        <div className="files-toolbar">
          <button type="button" className={`btn ghost${view === 'path' ? ' on' : ''}`} onClick={() => setViewMode('path')}>
            {t('detail.viewPath')}
          </button>
          <button type="button" className={`btn ghost${view === 'tree' ? ' on' : ''}`} onClick={() => setViewMode('tree')}>
            {t('detail.viewTree')}
          </button>
          <button type="button" className="btn ghost" onClick={() => setDesc((v) => !v)} title={t('detail.sort')}>
            {desc ? 'Z→A' : 'A→Z'}
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => {
                setShowAll(e.target.checked)
                if (e.target.checked && !all) void loadTree().then(setAll)
              }}
            />
            {t('detail.allFiles')}
          </label>
        </div>
        {showAll && (
          <input
            type="search"
            className="input"
            placeholder={t('detail.filterFiles')}
            aria-label={t('detail.filterFiles')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {!detail ? <p className="muted">{t('toolbar.loading')}</p> : <ul className="file-list">{list}</ul>}
      </section>
    </div>
  )
}
