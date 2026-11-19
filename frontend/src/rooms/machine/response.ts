// Grafik amplitudo tunak di bantalan terhadap putaran (rpm) + jejak run-up hasil simulasi + batas kecepatan indikatif.
import { C, FONT, FONT_B } from '../../lab/theme'

export interface Curve {
  /** Amplitudo tunak teori (m) sebagai fungsi rpm. */
  fn: (rpm: number) => number
  color: string
  label: string
  /** Jejak simulasi untuk arah yang sama. */
  trace: { rpm: number; amp: number }[]
}

export interface Band {
  rpm: number
  color: string
  label: string
}

export interface RespInput {
  curves: Curve[]
  bands: Band[]
  /** Pita harmonik kedua (torak). */
  bands2: Band[]
  rpmMax: number
  rpm: number
  target: number
  /** Kecepatan puncak batas indikatif (m/s). */
  vLim: number
}

export interface RespLayout {
  L: number
  pw: number
  rpmMax: number
}

export function drawResponse(ctx: CanvasRenderingContext2D, w: number, h: number, o: RespInput): RespLayout {
  const L = 58
  const R = 14
  const T = 12
  const B = 28
  const pw = w - L - R
  const ph = h - T - B
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const N = 400
  const vals = o.curves.map((c) => {
    const out: number[] = []
    for (let i = 0; i <= N; i++) out.push(c.fn((i / N) * o.rpmMax) * 1e6)
    return out
  })
  let mx = 0
  for (const v of vals) for (const x of v) if (Number.isFinite(x)) mx = Math.max(mx, x)
  for (const c of o.curves) for (const p of c.trace) mx = Math.max(mx, p.amp * 1e6)
  const yMax = mx * 1.12 || 1
  const X = (r: number) => L + (r / o.rpmMax) * pw
  const Y = (v: number) => T + ph - (Math.min(v, yMax * 1.05) / yMax) * ph

  const band = (a: number, b: number, color: string) => {
    if (a >= o.rpmMax) return
    ctx.fillStyle = color
    ctx.fillRect(X(Math.max(0, a)), T, X(Math.min(o.rpmMax, b)) - X(Math.max(0, a)), ph)
  }
  for (const b of o.bands2) band(0.8 * b.rpm, 1.25 * b.rpm, b.color)
  for (const b of o.bands) band(0.8 * b.rpm, 1.25 * b.rpm, b.color)

  ctx.font = FONT
  ctx.lineWidth = 1
  const raw = yMax / 4
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const st = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let v = 0; v <= yMax + 1e-12; v += st) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(L, Y(v))
    ctx.lineTo(L + pw, Y(v))
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(st >= 1 ? v.toFixed(0) : v.toFixed(Math.ceil(-Math.log10(st))), L - 5, Y(v))
  }
  const xs = o.rpmMax > 2000 ? 600 : 200
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let r = 0; r <= o.rpmMax + 1e-9; r += xs) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(X(r), T)
    ctx.lineTo(X(r), T + ph)
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(String(r), X(r), T + ph + 6)
  }
  ctx.strokeStyle = C.line
  ctx.strokeRect(L, T, pw, ph)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('putaran (rpm)', L + pw, h - 1)
  ctx.save()
  ctx.translate(13, T + ph / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = C.ink
  ctx.fillText('amplitudo di bantalan (µm)', 0, 0)
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(L, T, pw, ph)
  ctx.clip()
  ctx.strokeStyle = C.orange
  ctx.setLineDash([6, 4])
  ctx.lineWidth = 1.4
  ctx.beginPath()
  for (let i = 1; i <= N; i++) {
    const r = (i / N) * o.rpmMax
    const v = (o.vLim / ((r * 2 * Math.PI) / 60)) * 1e6
    if (i === 1) ctx.moveTo(X(r), Y(v))
    else ctx.lineTo(X(r), Y(v))
  }
  ctx.stroke()
  ctx.setLineDash([])
  o.curves.forEach((c, k) => {
    ctx.strokeStyle = c.color
    ctx.lineWidth = 2
    ctx.beginPath()
    vals[k].forEach((v, i) => {
      const x = L + (i / N) * pw
      if (i === 0) ctx.moveTo(x, Y(v))
      else ctx.lineTo(x, Y(v))
    })
    ctx.stroke()
  })
  // jejak simulasi: garis tebal semi-transparan dengan warna arah yang sama
  for (const c of o.curves) {
    if (c.trace.length < 2) continue
    ctx.strokeStyle = c.color
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 6
    ctx.lineJoin = 'round'
    ctx.beginPath()
    c.trace.forEach((p, i) => {
      if (i === 0) ctx.moveTo(X(p.rpm), Y(p.amp * 1e6))
      else ctx.lineTo(X(p.rpm), Y(p.amp * 1e6))
    })
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.strokeStyle = C.green
  ctx.setLineDash([3, 3])
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(X(o.target), T)
  ctx.lineTo(X(o.target), T + ph)
  ctx.stroke()
  ctx.setLineDash([])
  for (const c of o.curves) {
    ctx.fillStyle = c.color
    ctx.beginPath()
    ctx.arc(X(o.rpm), Y(c.fn(o.rpm) * 1e6), 4.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // label pita
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ;[...o.bands, ...o.bands2].forEach((b, i) => {
    if (b.rpm >= o.rpmMax) return
    ctx.fillStyle = b.color.replace(/[\d.]+\)$/, '1)')
    ctx.fillText(b.label, Math.min(X(0.8 * b.rpm) + 3, L + pw - 130), T + 4 + (i % 4) * 14)
  })
  // legenda
  ctx.textAlign = 'right'
  let ly = T + 64
  for (const c of o.curves) {
    ctx.fillStyle = c.color
    ctx.fillText(`— ${c.label}`, L + pw - 8, ly)
    ly += 15
  }
  ctx.fillStyle = C.mute
  ctx.fillText('▬ jejak simulasi (start/stop)', L + pw - 8, ly)
  ctx.fillStyle = C.orange
  ctx.fillText(`- - batas v = ${(o.vLim * 1000).toFixed(1)} mm/s (indikatif)`, L + pw - 8, ly + 15)
  ctx.font = FONT_B
  ctx.fillStyle = C.green
  const left = X(o.target) < L + pw - 90
  ctx.textAlign = left ? 'left' : 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('putaran kerja', X(o.target) + (left ? 4 : -4), T + ph - 4)
  return { L, pw, rpmMax: o.rpmMax }
}

export const rpmAt = (l: RespLayout, x: number) => Math.min(l.rpmMax, Math.max(0, ((x - l.L) / l.pw) * l.rpmMax))
