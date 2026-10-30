import { LOCALES, translate, type Language } from '@shared/i18n'
import type { Preferences } from '@shared/preferences'

const cache = new Map<
  Language,
  { rtf: Intl.RelativeTimeFormat; dtf: Intl.DateTimeFormat; month: Intl.DateTimeFormat; monthLong: Intl.DateTimeFormat }
>()
function intl(lang: Language) {
  let f = cache.get(lang)
  if (!f) {
    const locale = LOCALES[lang]
    f = {
      rtf: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
      dtf: new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }),
      month: new Intl.DateTimeFormat(locale, { month: 'short' }),
      monthLong: new Intl.DateTimeFormat(locale, { month: 'long' })
    }
    cache.set(lang, f)
  }
  return f
}

/** Fecha relativa corta: "hace 4 min", "ayer", luego fecha fija. */
export function relativeTime(epochSec: number, now = Date.now(), lang: Language = 'es'): string {
  const { rtf, dtf } = intl(lang)
  const diff = Math.round(epochSec - now / 1000)
  const abs = Math.abs(diff)
  if (abs < 60) return translate(lang, 'time.now')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day')
  return dtf.format(new Date(epochSec * 1000))
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

/**
 * Fecha absoluta con patrón (hora local). Tokens: YYYY YY MMMM MMM MM M DD D HH H mm ss; el texto entre corchetes
 * va tal cual (`D [de] MMMM`) y lo demás se copia sin cambios.
 */
export function formatPattern(epochSec: number, pattern: string, lang: Language = 'es'): string {
  const d = new Date(epochSec * 1000)
  const tokens: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()),
    YY: () => pad(d.getFullYear() % 100),
    MMMM: () => intl(lang).monthLong.format(d),
    MMM: () => intl(lang).month.format(d).replace('.', ''),
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    DD: () => pad(d.getDate()),
    D: () => String(d.getDate()),
    HH: () => pad(d.getHours()),
    H: () => String(d.getHours()),
    mm: () => pad(d.getMinutes()),
    ss: () => pad(d.getSeconds())
  }
  return pattern.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|H|mm|ss/g, (t, literal?: string) =>
    literal !== undefined ? literal : tokens[t]!()
  )
}

/** Fecha de una fila del grafo según la preferencia de formato. */
export function commitDate(epochSec: number, now: number, date: Preferences['date'], lang: Language): string {
  return date.mode === 'absolute' ? formatPattern(epochSec, date.pattern, lang) : relativeTime(epochSec, now, lang)
}
