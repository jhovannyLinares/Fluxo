import { useMemo, useState } from 'react'
import { filterPalette, type PaletteItem } from '../palette'
import { usePrefs } from '../prefs'
import { Modal } from './Modal'

/**
 * B4: paleta de comandos (Ctrl+P): cualquier acción del menú, ir a una rama o abrir un repo reciente. Misma forma que
 * «Buscar archivo»: ↑ ↓ eligen, Enter ejecuta, Esc cierra.
 */
export function CommandPalette({ items, onRun, onClose }: { items: PaletteItem[]; onRun: (item: PaletteItem) => void; onClose: () => void }) {
  const { t } = usePrefs()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const shown = useMemo(() => filterPalette(items, query).slice(0, 200), [items, query])

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    onClose()
    onRun(item)
  }

  return (
    <Modal title={t('menu.palette')} onClose={onClose}>
      <input
        type="search"
        className="input"
        data-autofocus
        placeholder={t('palette.placeholder')}
        aria-label={t('palette.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (!shown.length) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            run(shown[active])
          }
        }}
      />
      {shown.length === 0 && <p className="muted">{t('palette.none')}</p>}
      <ul className="file-search-list" role="listbox" aria-label={t('menu.palette')}>
        {shown.map((item, i) => (
          <li key={item.id} role="option" aria-selected={i === active}>
            <button type="button" className={i === active ? 'active' : undefined} onMouseEnter={() => setActive(i)} onClick={() => run(item)}>
              <strong>{item.label}</strong>
              {item.hint && <span className="muted">{item.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
