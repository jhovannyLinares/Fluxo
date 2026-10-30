import { useEffect, useState } from 'react'
import { call } from '../api'
import { usePrefs } from '../prefs'
import { Modal } from './Modal'

/** A1: buscar un archivo del repo por nombre o ruta (Ctrl+Shift+H) y abrir su historial. ↑ ↓ eligen, Enter abre. */
export function FileSearchDialog({ repoId, onPick, onClose }: { repoId: string; onPick: (path: string) => void; onClose: () => void }) {
  const { t } = usePrefs()
  const [query, setQuery] = useState('')
  const [paths, setPaths] = useState<string[] | null>(null)
  const [active, setActive] = useState(0)

  // se pregunta al backend un momento después de dejar de escribir
  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      call('file:search', { repoId, query })
        .then((r) => {
          if (!alive) return
          setPaths(r.paths)
          setActive(0)
        })
        .catch(() => alive && setPaths([]))
    }, 120)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [repoId, query])

  const pick = (p: string | undefined) => {
    if (!p) return
    onPick(p)
    onClose()
  }

  return (
    <Modal title={t('fileSearch.title')} onClose={onClose}>
      <input
        type="search"
        className="input"
        data-autofocus
        placeholder={t('fileSearch.placeholder')}
        aria-label={t('fileSearch.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (!paths?.length) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : paths.length - 1)) % paths.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(paths[active])
          }
        }}
      />
      {paths?.length === 0 && <p className="muted">{t('fileSearch.none')}</p>}
      <ul className="file-search-list" role="listbox" aria-label={t('fileSearch.title')}>
        {paths?.map((p, i) => {
          const slash = p.lastIndexOf('/')
          return (
            <li key={p} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? 'active' : undefined} onMouseEnter={() => setActive(i)} onClick={() => pick(p)}>
                <strong>{p.slice(slash + 1)}</strong>
                {slash > 0 && <span className="muted">{p.slice(0, slash)}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
