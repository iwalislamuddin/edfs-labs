// Grafik amplitudo tunak pondasi terhadap putaran (rpm) + jejak run-up hasil simulasi + batas kecepatan indikatif.
import { C, FONT, FONT_B } from '../../lab/theme'

export interface RespInput {
  /** Amplitudo tunak teori (m) sebagai fungsi rpm. */
  curve: (rpm: number) => number
  rpmMax: number
  rpmN: number
  torak: boolean
  rpm: number
  target: number
  trace: { rpm: number; amp: number }[]
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
  const N = 500
  const vals: number[] = []
  let mx = 0
  for (let i = 0; i <= N; i++) {
    const v = o.curve((i / N) * o.rpmMax) * 1e6
    vals.push(v)
    if (Number.isFinite(v)) mx = Math.max(mx, v)
  }
  for (const p of o.trace) mx = Math.max(mx, p.amp * 1e6)
  const yMax = mx * 1.12 || 1
  const X = (r: number) => L + (r / o.rpmMax) * pw
  const Y = (v: number) => T + ph - (Math.min(v, yMax * 1.05) / yMax) * ph

  // pita resonansi
  const band = (a: number, b: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(X(Math.max(0, a)), T, X(Math.min(o.rpmMax, b)) - X(Math.max(0, a)), ph)
  }
  band(0.8 * o.rpmN, 1.25 * o.rpmN, 'rgba(181,69,47,0.08)')
  if (o.torak) band(0.4 * o.rpmN, 0.625 * o.rpmN, 'rgba(237,141,59,0.10)')

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
  ctx.fillText('amplitudo (µm)', 0, 0)
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(L, T, pw, ph)
  ctx.clip()
  // batas kecepatan indikatif: X = v/ω
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
  // teori
  ctx.strokeStyle = C.navy
  ctx.lineWidth = 2
  ctx.beginPath()
  vals.forEach((v, i) => {
    const x = L + (i / N) * pw
    if (i === 0) ctx.moveTo(x, Y(v))
    else ctx.lineTo(x, Y(v))
  })
  ctx.stroke()
  // jejak simulasi
  if (o.trace.length > 1) {
    ctx.strokeStyle = C.green
    ctx.lineWidth = 2.4
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    o.trace.forEach((p, i) => {
      if (i === 0) ctx.moveTo(X(p.rpm), Y(p.amp * 1e6))
      else ctx.lineTo(X(p.rpm), Y(p.amp * 1e6))
    })
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  // putaran kerja & sekarang
  ctx.strokeStyle = C.green
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(X(o.target), T)
  ctx.lineTo(X(o.target), T + ph)
  ctx.stroke()
  ctx.setLineDash([])
  const now = o.curve(o.rpm) * 1e6
  ctx.fillStyle = C.orange
  ctx.beginPath()
  ctx.arc(X(o.rpm), Y(now), 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = C.red
  if (o.rpmN < o.rpmMax) ctx.fillText(`resonansi ${Math.round(o.rpmN)} rpm ±20%`, Math.min(X(0.8 * o.rpmN) + 4, L + pw - 160), T + 4)
  if (o.torak && 0.5 * o.rpmN < o.rpmMax) {
    ctx.fillStyle = C.orange
    ctx.fillText('harmonik 2 (2ω = ωn)', Math.min(X(0.4 * o.rpmN) + 4, L + pw - 160), T + 20)
  }
  ctx.textAlign = 'right'
  ctx.fillStyle = C.navy
  ctx.fillText('— teori tunak', L + pw - 8, T + 40)
  ctx.fillStyle = C.green
  ctx.fillText('— jejak simulasi (start/stop)', L + pw - 8, T + 56)
  ctx.fillStyle = C.orange
  ctx.fillText(`- - batas v = ${(o.vLim * 1000).toFixed(1)} mm/s (indikatif)`, L + pw - 8, T + 72)
  ctx.font = FONT_B
  ctx.fillStyle = C.green
  ctx.textAlign = X(o.target) > L + pw - 90 ? 'right' : 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('putaran kerja', X(o.target) + (ctx.textAlign === 'left' ? 4 : -4), T + ph - 4)
  return { L, pw, rpmMax: o.rpmMax }
}

export const rpmAt = (l: RespLayout, x: number) => Math.min(l.rpmMax, Math.max(0, ((x - l.L) / l.pw) * l.rpmMax))
