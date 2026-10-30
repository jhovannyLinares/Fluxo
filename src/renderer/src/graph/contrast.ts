/** Color `#rrggbb[aa]` o `rgb[a](r,g,b[,a])` sobre `bg` (opaco), ya compuesto. */
function toRgb(color: string, bg = [255, 255, 255]): number[] {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color)
  const parts = hex
    ? [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(hex[2] ? parseInt(hex[2], 16) / 255 : 1)
    : (color.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number)
  const a = parts[3] ?? 1
  return [0, 1, 2].map((i) => parts[i]! * a + bg[i]! * (1 - a))
}

const luminance = (rgb: number[]) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(rgb[0]!) + 0.7152 * f(rgb[1]!) + 0.0722 * f(rgb[2]!)
}

/** B5: contraste WCAG entre un texto y su fondo (el texto con transparencia se compone sobre el fondo). */
export function contrast(fg: string, bg: string): number {
  const back = toRgb(bg)
  const [x, y] = [luminance(toRgb(fg, back)), luminance(back)].sort((a, b) => b - a)
  return (x! + 0.05) / (y! + 0.05)
}

/** B5: de los candidatos, el que más contraste da sobre el fondo. */
export function readableOn(bg: string, candidates: string[]): string {
  return candidates.reduce((best, c) => (contrast(c, bg) > contrast(best, bg) ? c : best))
}
