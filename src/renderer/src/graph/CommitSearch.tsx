import { useEffect, useRef, useState } from 'react'
import { call } from '../api'
import { usePrefs } from '../prefs'

/**
 * A2: buscar commits (Ctrl+F), caja flotante sobre el grafo (C25): contador, ↑ ↓ para recorrer
 * los resultados y Esc para cerrar. Busca por mensaje, autor o SHA; con `archivo:` delante, por ruta.
 */
export function CommitSearch({
  repoId,
  graphKey,
  focusKey,
  onJump,
  onClose
}: {
  repoId: string
  /** cambia cuando el grafo se recarga: la búsqueda se repite sobre las filas nuevas */
  graphKey: string
  /** cambia con cada Ctrl+F: vuelve a poner el foco en la caja */
  focusKey: number
  onJump: (index: number) => void
  onClose: () => void
}) {
  const { t } = usePrefs()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<number[] | null>(null)
  const [cur, setCur] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusKey])

  // se busca un momento después de dejar de escribir; el primer resultado se muestra en el grafo
  useEffect(() => {
    if (!query.trim()) return setHits(null)
    let alive = true
    const id = setTimeout(() => {
      call('graph:search', { repoId, query })
        .then((r) => {
          if (!alive) return
          setHits(r.indices)
          setCur(0)
          if (r.indices.length) onJump(r.indices[0]!)
        })
        .catch(() => alive && setHits([]))
    }, 200)
    return () => {
      alive = false
      clearTimeout(id)
    }
    // sin onJump en las dependencias: cambia en cada render de App y repetir la búsqueda movería la selección
  }, [repoId, query, graphKey])

  const go = (dir: 1 | -1) => {
    if (!hits?.length) return
    const next = (cur + dir + hits.length) % hits.length
    setCur(next)
    onJump(hits[next]!)
  }

  return (
    <div className="commit-search" role="search">
      <input
        ref={input}
        type="search"
        className="input"
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            go(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="commit-search-count muted" aria-live="polite">
        {hits === null ? '' : hits.length ? t('search.count', { n: String(cur + 1), total: String(hits.length) }) : t('search.none')}
      </span>
      <button type="button" className="diff-icon" disabled={!hits?.length} onClick={() => go(-1)} title={t('search.prev')} aria-label={t('search.prev')}>
        ↑
      </button>
      <button type="button" className="diff-icon" disabled={!hits?.length} onClick={() => go(1)} title={t('search.next')} aria-label={t('search.next')}>
        ↓
      </button>
      <button type="button" className="diff-icon" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
        ✕
      </button>
    </div>
  )
}
