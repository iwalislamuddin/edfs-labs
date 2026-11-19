// Grafik Room Earthquake: riwayat waktu penuh (bertumpuk) dan spektrum respons.
import { sniSa, type DesignSpec, type SpectrumPoint } from '../../lab/ground'
import { C, FONT, FONT_B } from '../../lab/theme'

type Ctx = CanvasRenderingContext2D

export interface Series {
  /** Nilai dengan langkah sampel `dt` mulai t = 0 (satuan SI). */
  data: number[]
  color: string
  label: string
  dash?: number[]
  width?: number
}

export interface Row {
  title: string
  unit: string
  factor: number
  series: Series[]
}

function niceStep(range: number, target = 4) {
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag
}

/** Riwayat waktu bertumpuk dengan sumbu waktu sama 0..tMax dan kursor waktu sekarang. */
export function drawTraces(ctx: Ctx, w: number, h: number, rows: Row[], dt: number, tMax: number, tNow: number, tRec: number) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const L = 58
  const R = 12
  const T = 6
  const B = 24
  const gap = 18
  const pw = w - L - R
  const rh = (h - T - B - gap * (rows.length - 1)) / rows.length
  const X = (t: number) => L + (t / tMax) * pw
  rows.forEach((row, ri) => {
    const y0 = T + ri * (rh + gap)
    let mx = 0
    for (const s of row.series) for (const v of s.data) if (Number.isFinite(v)) mx = Math.max(mx, Math.abs(v * row.factor))
    const yMax = Math.max(mx * 1.1, 1e-6)
    const Y = (v: number) => y0 + rh / 2 - (v / yMax) * (rh / 2)
    ctx.strokeStyle = C.grid
    ctx.lineWidth = 1
    ctx.font = FONT
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const st = niceStep(2 * yMax)
    for (let v = -Math.floor(yMax / st) * st; v <= yMax + 1e-12; v += st) {
      ctx.strokeStyle = Math.abs(v) < 1e-12 ? C.line : C.grid
      ctx.beginPath()
      ctx.moveTo(L, Y(v))
      ctx.lineTo(L + pw, Y(v))
      ctx.stroke()
      ctx.fillStyle = C.mute
      ctx.fillText(Math.abs(st) >= 1 ? v.toFixed(0) : v.toFixed(Math.min(3, Math.ceil(-Math.log10(st)))), L - 5, Y(v))
    }
    // daerah setelah rekaman habis
    if (tRec < tMax) {
      ctx.fillStyle = 'rgba(0,0,0,0.025)'
      ctx.fillRect(X(tRec), y0, L + pw - X(tRec), rh)
    }
    ctx.strokeStyle = C.line
    ctx.strokeRect(L, y0, pw, rh)
    ctx.save()
    ctx.translate(13, y0 + rh / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.fillStyle = C.ink
    ctx.fillText(`${row.title} (${row.unit})`, 0, 0)
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.rect(L, y0, pw, rh)
    ctx.clip()
    for (const s of row.series) {
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width ?? 1.4
      ctx.setLineDash(s.dash ?? [])
      ctx.beginPath()
      const step = Math.max(1, Math.floor(s.data.length / (pw * 1.5)))
      for (let i = 0; i < s.data.length; i += step) {
        const x = X(i * dt)
        const y = Y(s.data[i] * row.factor)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.restore()
    // legenda
    ctx.font = FONT
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    let lx = L + pw - 6
    for (let i = row.series.length - 1; i >= 0; i--) {
      const s = row.series[i]
      if (!s.label) continue
      const tw = ctx.measureText(s.label).width
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(lx - tw - 24, y0 + 3, tw + 26, 15)
      ctx.fillStyle = C.ink
      ctx.fillText(s.label, lx, y0 + 4)
      ctx.strokeStyle = s.color
      ctx.lineWidth = 2
      ctx.setLineDash(s.dash ?? [])
      ctx.beginPath()
      ctx.moveTo(lx - tw - 20, y0 + 11)
      ctx.lineTo(lx - tw - 5, y0 + 11)
      ctx.stroke()
      ctx.setLineDash([])
      lx -= tw + 32
    }
  })
  // sumbu waktu + kursor
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const xs = niceStep(tMax, 8)
  for (let t = 0; t <= tMax + 1e-9; t += xs) ctx.fillText(String(Math.round(t)), X(t), h - B + 6)
  ctx.textAlign = 'right'
  ctx.fillText('t (s)', L + pw, h - 12)
  ctx.strokeStyle = C.orange
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(X(tNow), T)
  ctx.lineTo(X(tNow), h - B)
  ctx.stroke()
}

export interface SpecInput {
  sp: SpectrumPoint[]
  kind: 'Sa' | 'Sd'
  design: DesignSpec | null
  points: { T: number; Sd: number }[]
  /** Periode yang ditandai: [nilai, label, warna]. */
  marks: [number, string, string][]
  tMax: number
}

export interface SpecLayout {
  L: number
  pw: number
  tMax: number
}

/** Spektrum respons Sa (g) atau Sd (cm) terhadap T. */
export function drawSpectrum(ctx: Ctx, w: number, h: number, o: SpecInput): SpecLayout {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const L = 52
  const R = 14
  const T = 12
  const B = 28
  const pw = w - L - R
  const ph = h - T - B
  const G = 9.81
  const val = (T: number, Sd: number) => (o.kind === 'Sa' ? (Sd * (2 * Math.PI / T) ** 2) / G : Sd * 100)
  let mx = 0
  for (const p of o.sp) mx = Math.max(mx, val(p.T, p.Sd))
  for (const p of o.points) mx = Math.max(mx, val(p.T, p.Sd))
  if (o.design && o.kind === 'Sa') mx = Math.max(mx, o.design.SDS)
  const yMax = mx * 1.12 || 1
  const X = (t: number) => L + (t / o.tMax) * pw
  const Y = (v: number) => T + ph - (v / yMax) * ph
  ctx.font = FONT
  ctx.lineWidth = 1
  const st = niceStep(yMax)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let v = 0; v <= yMax + 1e-9; v += st) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(L, Y(v))
    ctx.lineTo(L + pw, Y(v))
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(st >= 1 ? v.toFixed(0) : v.toFixed(Math.ceil(-Math.log10(st))), L - 5, Y(v))
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let t = 0; t <= o.tMax + 1e-9; t += 0.5) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(X(t), T)
    ctx.lineTo(X(t), T + ph)
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(t.toFixed(1), X(t), T + ph + 6)
  }
  ctx.strokeStyle = C.line
  ctx.strokeRect(L, T, pw, ph)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('T (s)', L + pw, h - 1)
  ctx.save()
  ctx.translate(13, T + ph / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = C.ink
  ctx.fillText(o.kind === 'Sa' ? 'PSa (g)' : 'Sd (cm)', 0, 0)
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(L, T, pw, ph)
  ctx.clip()
  if (o.design && o.kind === 'Sa') {
    ctx.strokeStyle = C.orange
    ctx.setLineDash([7, 5])
    ctx.lineWidth = 1.8
    ctx.beginPath()
    for (let i = 0; i <= 300; i++) {
      const t = (i / 300) * o.tMax
      const y = Y(sniSa(o.design, t))
      if (i === 0) ctx.moveTo(X(t), y)
      else ctx.lineTo(X(t), y)
    }
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.strokeStyle = C.navy
  ctx.lineWidth = 2
  ctx.beginPath()
  o.sp.forEach((p, i) => {
    const x = X(p.T)
    const y = Y(val(p.T, p.Sd))
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  for (const p of o.points) {
    ctx.fillStyle = C.green
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(X(p.T), Y(val(p.T, p.Sd)), 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.font = FONT_B
  for (const [t, label, color] of o.marks) {
    ctx.strokeStyle = color
    ctx.setLineDash([3, 3])
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(X(t), T)
    ctx.lineTo(X(t), T + ph)
    ctx.stroke()
    ctx.setLineDash([])
    // nilai di kurva (interpolasi)
    const i = o.sp.findIndex((p) => p.T >= t)
    if (i > 0) {
      const a = o.sp[i - 1]
      const b = o.sp[i]
      const f = (t - a.T) / (b.T - a.T)
      const v = val(a.T, a.Sd) * (1 - f) + val(b.T, b.Sd) * f
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(X(t), Y(v), 5, 0, Math.PI * 2)
      ctx.fill()
      const right = X(t) < L + pw - 110
      ctx.textAlign = right ? 'left' : 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`${label} ${v.toFixed(o.kind === 'Sa' ? 2 : 1)}${o.kind === 'Sa' ? ' g' : ' cm'}`, X(t) + (right ? 7 : -7), Math.max(T + 14, Y(v) - 5))
    }
  }
  ctx.restore()
  // legenda
  ctx.font = FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillStyle = C.navy
  ctx.fillText('— spektrum rekaman ini', L + pw - 8, T + 6)
  ctx.fillStyle = C.green
  ctx.fillText('● titik dari simulasi', L + pw - 8, T + 22)
  if (o.design && o.kind === 'Sa') {
    ctx.fillStyle = C.orange
    ctx.fillText('- - spektrum desain SNI 1726', L + pw - 8, T + 38)
  }
  return { L, pw, tMax: o.tMax }
}

export const tAt = (l: SpecLayout, x: number) => Math.min(l.tMax, Math.max(0.05, ((x - l.L) / l.pw) * l.tMax))
