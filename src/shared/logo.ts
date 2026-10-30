/** Colores de carril del grafo de Fluxo (sin azul ni naranja, reservados a humano e IA). */
const LANES = ['#15a0bf', '#c517b6', '#7bd938', '#f2ca33']

/**
 * Logo animado de Fluxo (A11): un grafo de cuatro ramas que se dibujan solas una y otra vez, con sus commits. Lo usan
 * la pantalla de carga y «Acerca de Fluxo». Solo SVG y CSS; las clases llevan `fl-` para no chocar con las de la app.
 */
export function logoSvg(width = 200): string {
  const branches = LANES.map((c, i) => {
    const x = 50 + i * 34
    const top = 30 + i * 22
    const dots = [0, 1, 2]
      .map((k) => `<circle class="fl-dot" style="animation-delay:${(i * 0.25 + 0.35 + k * 0.3).toFixed(2)}s" cx="${x}" cy="${top + 40 + k * 46}" r="7" fill="${c}"/>`)
      .join('')
    const merge = i > 0 ? `<path class="fl-line" style="animation-delay:${(i * 0.25 + 1.1).toFixed(2)}s" d="M${x} ${top + 132} C ${x} ${top + 160}, 50 ${top + 150}, 50 ${top + 185}" stroke="${c}"/>` : ''
    return `<path class="fl-line" style="animation-delay:${(i * 0.25).toFixed(2)}s" d="M${x} ${top} V ${top + 132}" stroke="${c}"/>${merge}${dots}`
  }).join('')
  return `<svg width="${width}" height="${Math.round((width * 260) / 200)}" viewBox="0 0 200 260" aria-hidden="true">${branches}</svg>`
}

/** Animación del logo: las ramas se dibujan y los commits aparecen, cada 2.6 s. */
export const LOGO_CSS = `.fl-line{fill:none;stroke-width:5;stroke-linecap:round;stroke-dasharray:240;stroke-dashoffset:240;animation:fl-draw 2.6s ease-in-out infinite}
.fl-dot{opacity:0;transform-box:fill-box;transform-origin:center;animation:fl-pop 2.6s ease-out infinite}
@keyframes fl-draw{0%{stroke-dashoffset:240}45%,80%{stroke-dashoffset:0}100%{stroke-dashoffset:0;opacity:0}}
@keyframes fl-pop{0%{opacity:0;transform:scale(0)}20%,80%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1)}}`
