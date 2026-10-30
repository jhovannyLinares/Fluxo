import { beforeEach, describe, expect, it } from 'vitest'
import { activeTab, closeTab, cycleTab, initialTabs, loadTabs, newTab, reopenClosed, saveTabs, showRepo, tabAt } from '../../src/renderer/src/tabs'

/** Pestañas de repos. */
describe('pestañas', () => {
  const two = () => {
    let s = showRepo(initialTabs(), 1, 'C:/r/uno', 'uno')
    s = newTab(s)
    return showRepo(s, s.active, 'C:/r/dos', 'dos')
  }

  it('empieza con una pestaña nueva; abrir un repo la ocupa', () => {
    const s = initialTabs()
    expect(activeTab(s).path).toBeNull()
    expect(activeTab(showRepo(s, 1, 'C:/r/uno', 'uno')).name).toBe('uno')
  })

  it('pestaña nueva a la derecha de la activa y activa', () => {
    let s = two()
    s = { ...s, active: s.tabs[0]!.id }
    s = newTab(s)
    expect(s.tabs.map((t) => t.path)).toEqual(['C:/r/uno', null, 'C:/r/dos'])
    expect(activeTab(s).path).toBeNull()
  })

  it('cerrar activa la de la derecha; cerrar la última deja una pestaña nueva; reabrir devuelve la ruta', () => {
    let s = two()
    s = closeTab({ ...s, active: s.tabs[0]!.id }, s.tabs[0]!.id)
    expect(activeTab(s).name).toBe('dos')
    s = closeTab(s, s.active)
    expect(s.tabs).toHaveLength(1)
    expect(activeTab(s).path).toBeNull()
    const r = reopenClosed(s)
    expect(r.path).toBe('C:/r/dos')
    expect(r.tabs.closed).toEqual(['C:/r/uno'])
    expect(reopenClosed(initialTabs()).path).toBeNull()
  })

  it('un repo vive en una sola pestaña: abrirlo de nuevo activa la que ya lo tiene', () => {
    let s = two()
    s = newTab(s)
    const nueva = s.active
    s = showRepo(s, nueva, 'c:\\r\\UNO\\', 'uno')
    expect(s.tabs).toHaveLength(2)
    expect(activeTab(s).path).toBe('C:/r/uno')
  })

  it('Ctrl+Tab da la vuelta; Ctrl+9 es la última', () => {
    const s = two()
    expect(activeTab(cycleTab(s, 1)).name).toBe('uno')
    expect(activeTab(cycleTab(s, -1)).name).toBe('uno')
    expect(activeTab(tabAt(s, 1)).name).toBe('uno')
    expect(activeTab(tabAt(s, 9)).name).toBe('dos')
    expect(tabAt(s, 5)).toBe(s)
  })

  describe('recordar pestañas', () => {
    beforeEach(() => {
      const store = new Map<string, string>()
      globalThis.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v)
      } as unknown as Storage
    })

    it('guarda solo las de repo y la activa; sin nada guardado devuelve null', () => {
      expect(loadTabs()).toBeNull()
      const s = newTab(two())
      saveTabs({ ...s, active: s.tabs[0]!.id })
      const back = loadTabs()!
      expect(back.tabs.map((t) => t.name)).toEqual(['uno', 'dos'])
      expect(activeTab(back).name).toBe('uno')
      localStorage.setItem('fluxo.tabs', '{basura')
      expect(loadTabs()).toBeNull()
    })
  })
})
