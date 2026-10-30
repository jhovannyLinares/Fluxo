import { translate, type Language, type MessageKey } from '@shared/i18n'

export interface Shortcut {
  section: MessageKey
  keys: string[]
  /** otra combinación que hace lo mismo (p. ej. K para ↑) */
  alt?: string[]
  label: MessageKey
}

/** Atajos que existen hoy (C22). Al agregar uno en código, agregarlo aquí. */
export const SHORTCUTS: Shortcut[] = [
  { section: 'shortcuts.section.graph', keys: ['↑'], alt: ['K'], label: 'shortcuts.prev' },
  { section: 'shortcuts.section.graph', keys: ['↓'], alt: ['J'], label: 'shortcuts.next' },
  { section: 'shortcuts.section.graph', keys: ['Shift', '↓'], alt: ['Shift', 'J'], label: 'shortcuts.branchDown' },
  { section: 'shortcuts.section.graph', keys: ['Shift', '↑'], alt: ['Shift', 'K'], label: 'shortcuts.branchUp' },
  { section: 'shortcuts.section.graph', keys: ['PageUp'], label: 'shortcuts.pageUp' },
  { section: 'shortcuts.section.graph', keys: ['PageDown'], label: 'shortcuts.pageDown' },
  { section: 'shortcuts.section.graph', keys: ['Home'], alt: ['Ctrl', 'Home'], label: 'shortcuts.first' },
  { section: 'shortcuts.section.graph', keys: ['End'], alt: ['Ctrl', 'End'], label: 'shortcuts.last' },
  { section: 'shortcuts.section.diff', keys: ['Alt', '↓'], label: 'shortcuts.diffNext' },
  { section: 'shortcuts.section.diff', keys: ['Alt', '↑'], label: 'shortcuts.diffPrev' },
  { section: 'shortcuts.section.diff', keys: ['Esc'], label: 'shortcuts.diffClose' },
  { section: 'shortcuts.section.app', keys: ['Ctrl', '+'], label: 'shortcuts.zoomIn' },
  { section: 'shortcuts.section.app', keys: ['Ctrl', '-'], label: 'shortcuts.zoomOut' },
  { section: 'shortcuts.section.app', keys: ['Ctrl', '0'], label: 'shortcuts.zoomReset' },
  { section: 'shortcuts.section.app', keys: ['Ctrl', '/'], label: 'shortcuts.list' },
  { section: 'shortcuts.section.app', keys: ['Ctrl', 'Shift', 'H'], label: 'menu.fileHistory' },
  { section: 'shortcuts.section.graph', keys: ['Ctrl', 'F'], label: 'menu.findCommits' },
  { section: 'shortcuts.section.app', keys: ['Ctrl', 'P'], label: 'menu.palette' },
  { section: 'shortcuts.section.app', keys: ['F1'], label: 'menu.guide' },
  { section: 'shortcuts.section.app', keys: ['Esc'], label: 'shortcuts.closeDialog' }
]

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

/** Filtra por descripción, sección o teclas; sin distinguir mayúsculas ni acentos. */
export function filterShortcuts(list: Shortcut[], query: string, lang: Language): Shortcut[] {
  const q = fold(query.trim())
  if (!q) return list
  return list.filter((s) =>
    fold([translate(lang, s.label), translate(lang, s.section), s.keys.join('+'), s.alt?.join('+') ?? ''].join(' ')).includes(q)
  )
}
