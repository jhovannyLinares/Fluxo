// Genera el ícono de Fluxo (A6): el último cuadro del logo animado (A11) sobre un cuadrado oscuro con esquinas
// redondeadas. Escribe build/icon.ico (16 a 256 px, entradas PNG) y build/icon.png (512 px).
// Uso: npx electron build/icono.mjs
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logoSvg } from '../src/shared/logo.ts'

const here = dirname(fileURLToPath(import.meta.url))
const SIZES = [16, 24, 32, 48, 64, 128, 256]

// Las ramas del logo sin animación, con el trazo completo y los commits visibles (el cuadro final).
const inner = logoSvg().replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
const STATIC = '.fl-line{fill:none;stroke-width:5;stroke-linecap:round}'
// Caja del dibujo completo (las uniones bajan hasta y=284, más allá del viewBox del logo), centrada en un cuadrado
// de 300 con el fondo de la app (#1c1e23).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><style>${STATIC}</style>
<rect width="300" height="300" rx="66" fill="#1c1e23"/>
<g transform="translate(150 150) scale(0.86) translate(-101 -156)">${inner}</g></svg>`

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let offset = head.length
  pngs.forEach(([size, data], i) => {
    const e = 6 + 16 * i
    head.writeUInt8(size % 256, e)
    head.writeUInt8(size % 256, e + 1)
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...pngs.map(([, d]) => d)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const render = (size) =>
    win.webContents.executeJavaScript(`new Promise((ok) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = c.height = ${size}
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
        ok(c.toDataURL('image/png'))
      }
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
    })`)
  const png = async (size) => Buffer.from((await render(size)).split(',')[1], 'base64')
  const pngs = []
  for (const s of SIZES) pngs.push([s, await png(s)])
  writeFileSync(join(here, 'icon.ico'), ico(pngs))
  writeFileSync(join(here, 'icon.png'), await png(512))
  console.log('icon.ico', SIZES.join(','), '+ icon.png 512')
  app.quit()
})
