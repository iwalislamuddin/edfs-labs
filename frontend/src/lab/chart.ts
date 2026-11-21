// Grafik garis umum (sumbu, grid, seri, penanda, titik, legenda) — dipakai Room Buckling dan Tensile Test.
import { C, FONT, FONT_B } from './theme'

type Ctx = CanvasRenderingContext2D

/** Format angka gaya Indonesia (koma desimal, minus tipografis). */
export function fmt(v: number, d = 1) {
  if (!Number.isFinite(v)) return '∞'
  if (Math.abs(v) < 0.5 * 10 ** -d) return '0'
  const s = Math.abs(v).toFixed(d).replace('.', ',')
  return v < 0 ? `−${s}` : s
}

export interface Series {
  pts: [number, number][]
  color: string
  label?: string
  width?: number
  dash?: number[]
}
export interface Mark {
  v: number
  color: string
  label?: string
}
export interface Dot {
  x: number
  y: number
  color: string
  label?: string
  r?: number
}
export interface ChartOpts {
  x: [number, number]
  y: [number, number]
  xlabel: string
  ylabel: string
  series: Series[]
  vmarks?: Mark[]
  hmarks?: Mark[]
  dots?: Dot[]
  title?: string
}

export function niceStep(span: number, n: number) {
  const raw = span / n
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}
export const dec = (step: number) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)))

export function chart(ctx: Ctx, rx: number, ry: number, w: number, h: number, o: ChartOpts) {
  const L = 54
  const R = 12
  const T = o.title ? 38 : 24
  const B = 34
  const pw = w - L - R
  const ph = h - T - B
  const [x0, x1] = o.x
  const [y0, y1] = o.y
  const px = (x: number) => rx + L + ((x - x0) / (x1 - x0)) * pw
  const py = (y: number) => ry + T + ((y1 - y) / (y1 - y0)) * ph

  ctx.font = FONT
  ctx.lineWidth = 1
  const sx = niceStep(x1 - x0, Math.max(3, Math.floor(pw / 70)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(px(x), ry + T)
    ctx.lineTo(px(x), ry + T + ph)
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(fmt(x, dec(sx)), px(x), ry + T + ph + 4)
  }
  const sy = niceStep(y1 - y0, 5)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(rx + L, py(y))
    ctx.lineTo(rx + L + pw, py(y))
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(fmt(y, dec(sy)), rx + L - 6, py(y))
  }
  ctx.strokeStyle = C.mute
  ctx.strokeRect(rx + L, ry + T, pw, ph)
  ctx.fillStyle = C.mute
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(o.xlabel, rx + L + pw, ry + T + ph + 18)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(o.ylabel, rx + 4, ry + T - 4)
  if (o.title) {
    ctx.font = FONT_B
    ctx.fillStyle = C.ink
    ctx.textBaseline = 'top'
    ctx.fillText(o.title, rx + 4, ry + 2)
    ctx.font = FONT
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(rx + L, ry + T, pw, ph)
  ctx.clip()
  for (const m of o.vmarks ?? []) {
    ctx.strokeStyle = m.color
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(px(m.v), ry + T)
    ctx.lineTo(px(m.v), ry + T + ph)
    ctx.stroke()
  }
  for (const m of o.hmarks ?? []) {
    ctx.strokeStyle = m.color
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(rx + L, py(m.v))
    ctx.lineTo(rx + L + pw, py(m.v))
    ctx.stroke()
  }
  for (const s of o.series) {
    if (s.pts.length < 2) continue
    ctx.setLineDash(s.dash ?? [])
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width ?? 2
    ctx.beginPath()
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (const d of o.dots ?? []) {
    ctx.fillStyle = d.color
    ctx.beginPath()
    ctx.arc(px(d.x), py(d.y), d.r ?? 4, 0, 2 * Math.PI)
    ctx.fill()
  }
  ctx.restore()
  ctx.textBaseline = 'middle'
  for (const m of o.vmarks ?? []) {
    if (!m.label) continue
    ctx.fillStyle = m.color
    ctx.textAlign = 'left'
    ctx.fillText(m.label, px(m.v) + 4, ry + T + 9)
  }
  for (const m of o.hmarks ?? []) {
    if (!m.label || m.v > y1 || m.v < y0) continue
    ctx.fillStyle = m.color
    ctx.textAlign = 'right'
    ctx.fillText(m.label, rx + L + pw - 4, py(m.v) - 8)
  }
  for (const d of o.dots ?? []) {
    if (!d.label) continue
    ctx.fillStyle = d.color
    ctx.textAlign = 'left'
    ctx.fillText(d.label, px(d.x) + 7, py(d.y) - 9)
  }
  // legenda
  ctx.font = FONT_B
  const items = o.series.filter((s) => s.label)
  let lx = rx + L + pw
  ctx.textAlign = 'left'
  for (let i = items.length - 1; i >= 0; i--) {
    const s = items[i]
    const tw = ctx.measureText(s.label!).width + 30
    lx -= tw
    const yy = ry + T - 10 - (o.title ? 0 : 0)
    ctx.fillStyle = s.color
    ctx.fillRect(lx, yy - 1, 12, 3)
    ctx.fillText(s.label!, lx + 16, yy)
  }
}
