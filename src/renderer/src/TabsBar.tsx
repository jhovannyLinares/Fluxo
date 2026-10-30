import type { Tabs } from './tabs'
import { usePrefs } from './prefs'

/**
 * Barra de pestañas (34 px): ícono fijo de carpeta a la izquierda (gestión de repositorios),
 * una pestaña por repo con ícono de rama, la activa con ✕, y «+» al final. La ruta completa va en el texto al
 * pasar el ratón (C23: repos con el mismo nombre de carpeta).
 */
export function TabsBar(p: {
  tabs: Tabs
  /** gestión de repositorios abierta: el ícono de carpeta se ve activo */
  reposOpen: boolean
  onSelect: (id: number) => void
  onClose: (id: number) => void
  onNew: () => void
  onRepos: () => void
}) {
  const { t } = usePrefs()
  return (
    <div className="tabs-bar" role="tablist" aria-label={t('tabs.aria')}>
      <button type="button" className={`tabs-fixed${p.reposOpen ? ' on' : ''}`} title={t('repos.manager')} aria-label={t('repos.manager')} onClick={p.onRepos}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13z" strokeLinejoin="round" />
        </svg>
      </button>
      {p.tabs.tabs.map((tab) => {
        const on = tab.id === p.tabs.active && !p.reposOpen
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={on}
            className={`tab${on ? ' on' : ''}`}
            title={tab.path ?? undefined}
            onMouseDown={(e) => {
              // clic con la rueda cierra la pestaña, como en el navegador
              if (e.button === 1) {
                e.preventDefault()
                p.onClose(tab.id)
              }
            }}
            onClick={() => p.onSelect(tab.id)}
          >
            {tab.path && (
              <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="3" cy="3" r="1.6" />
                <circle cx="3" cy="11" r="1.6" />
                <circle cx="8" cy="5" r="1.6" />
                <path d="M3 4.6v4.8M8 6.6c0 2-5 1.5-5 3" />
              </svg>
            )}
            <span className="tab-name">{tab.name ?? t('tabs.new')}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={t('tabs.close', { name: tab.name ?? t('tabs.new') })}
              onClick={(e) => {
                e.stopPropagation()
                p.onClose(tab.id)
              }}
            >
              ✕
            </button>
          </div>
        )
      })}
      <button type="button" className="tabs-plus" title={t('menu.newTab')} aria-label={t('menu.newTab')} onClick={p.onNew}>
        +
      </button>
    </div>
  )
}
