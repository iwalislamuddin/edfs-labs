// Grafik simpangan terhadap waktu (canvas), jendela waktu bergulir.
import { C, FONT, FONT_B } from './theme'

export interface Sample {
  t: number
  u: number // satuan SI (m atau rad)
}

export interface PlotOptions {
  window: number // detik
  tNow: number
  factor: number // SI -> satuan tampilan
  unit: string
  name: string
  peaks: Sample[]
  showAmplitude: boolean
  showPeriod: boolean
  envelope: { t0: number; a0: number; decay: number } | null
  /** Seri tambahan (mis. model linear, massa kedua) — opsional. */
  extra?: { samples: Sample[]; color: string; dash?: number[]; label: string }[]
  /** Label seri utama untuk legenda (muncul bila ada seri tambahan). */
  mainLabel?: string
  /** Garis datar ±v (satuan SI), mis. amplitudo tunak teoretis — opsional. */
  hlines?: { v: number; color: string; label: string }[]
}

function niceStep(range: number, target = 4) {
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const step = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10
  return step * mag
}

const fmt = (v: number, step: number) => {
  const d = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)))
  return v.toFixed(d)
}

/** Skala sumbu-y bertahan antar frame supaya tidak "berkedip"; hanya tumbuh cepat dan menyusut pelan. */
export class PlotScale {
  y = 1
  update(target: number) {
    if (target > this.y) this.y = target
    else this.y += (target - this.y) * 0.02
  }
}

export function drawPlot(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  samples: Sample[],
  o: PlotOptions,
  scale: PlotScale,
) {
  const L = 56
  const R = 14
  const T = 14
  const B = 28
  const pw = w - L - R
  const ph = h - T - B
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)

  const t1 = Math.max(o.window, o.tNow)
  const t0 = t1 - o.window
  const visible = samples.filter((s) => s.t >= t0 - 0.05)
  let maxAbs = 0
  for (const s of visible) maxAbs = Math.max(maxAbs, Math.abs(s.u * o.factor))
  const extras = (o.extra ?? []).map((e) => ({ ...e, visible: e.samples.filter((s) => s.t >= t0 - 0.05) }))
  for (const e of extras) for (const s of e.visible) maxAbs = Math.max(maxAbs, Math.abs(s.u * o.factor))
  for (const l of o.hlines ?? []) maxAbs = Math.max(maxAbs, Math.abs(l.v * o.factor))
  scale.update(Math.max(maxAbs * 1.2, o.unit === '°' ? 5 : 0.5))
  const yMax = scale.y

  const X = (t: number) => L + ((t - t0) / o.window) * pw
  const Y = (v: number) => T + ph / 2 - (v / yMax) * (ph / 2)

  // grid & sumbu
  ctx.font = FONT
  ctx.lineWidth = 1
  const ys = niceStep(2 * yMax)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let v = -Math.floor(yMax / ys) * ys; v <= yMax + 1e-9; v += ys) {
    const y = Y(v)
    ctx.strokeStyle = Math.abs(v) < 1e-9 ? C.mute : C.grid
    ctx.beginPath()
    ctx.moveTo(L, y)
    ctx.lineTo(L + pw, y)
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(fmt(v, ys), L - 6, y)
  }
  const xs = niceStep(o.window, 10)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let t = Math.ceil(t0 / xs) * xs; t <= t1 + 1e-9; t += xs) {
    const x = X(t)
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(x, T)
    ctx.lineTo(x, T + ph)
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(t.toFixed(xs < 1 ? 1 : 0), x, T + ph + 6)
  }
  ctx.strokeStyle = C.line
  ctx.strokeRect(L, T, pw, ph)

  ctx.save()
  ctx.translate(14, T + ph / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = C.ink
  ctx.fillText(`${o.name} (${o.unit})`, 0, 0)
  ctx.restore()
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = C.mute
  ctx.fillText('t (s)', L + pw, T + ph + 26)

  ctx.save()
  ctx.beginPath()
  ctx.rect(L, T, pw, ph)
  ctx.clip()

  // selubung redaman teoretis
  if (o.envelope && o.envelope.decay > 0) {
    const e = o.envelope
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = C.orange
    ctx.lineWidth = 1.2
    for (const sign of [1, -1]) {
      ctx.beginPath()
      let first = true
      for (let t = Math.max(t0, e.t0); t <= t1; t += o.window / 200) {
        const v = sign * e.a0 * Math.exp(-e.decay * (t - e.t0)) * o.factor
        if (first) ctx.moveTo(X(t), Y(v))
        else ctx.lineTo(X(t), Y(v))
        first = false
      }
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  // garis datar ±v
  for (const l of o.hlines ?? []) {
    const a = Math.abs(l.v * o.factor)
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = l.color
    ctx.lineWidth = 1.2
    for (const v of [a, -a]) {
      ctx.beginPath()
      ctx.moveTo(L, Y(v))
      ctx.lineTo(L + pw, Y(v))
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.fillStyle = l.color
    ctx.font = FONT
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(l.label, L + pw - 6, Y(-a) + 3)
  }

  // seri tambahan (di bawah kurva utama)
  for (const e of extras) {
    ctx.strokeStyle = e.color
    ctx.lineWidth = 1.6
    ctx.setLineDash(e.dash ?? [])
    ctx.beginPath()
    e.visible.forEach((s, i) => {
      const x = X(s.t)
      const y = Y(s.u * o.factor)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    ctx.setLineDash([])
  }

  // kurva
  ctx.strokeStyle = C.navy
  ctx.lineWidth = 2
  ctx.beginPath()
  visible.forEach((s, i) => {
    const x = X(s.t)
    const y = Y(s.u * o.factor)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  const peaks = o.peaks.filter((p) => p.t >= t0)
  const last = peaks[peaks.length - 1]

  // amplitudo dari puncak terakhir
  if (o.showAmplitude && last) {
    const a = last.u * o.factor
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = C.green
    ctx.lineWidth = 1
    for (const v of [a, -a]) {
      ctx.beginPath()
      ctx.moveTo(L, Y(v))
      ctx.lineTo(L + pw, Y(v))
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.fillStyle = C.green
    ctx.font = FONT_B
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`A = ${a.toFixed(a < 10 ? 2 : 1)} ${o.unit}`, L + 6, Y(a) - 2)
  }

  // penanda puncak & periode
  ctx.fillStyle = C.green
  for (const p of peaks) {
    ctx.beginPath()
    ctx.arc(X(p.t), Y(p.u * o.factor), 3.5, 0, Math.PI * 2)
    ctx.fill()
  }
  if (o.showPeriod && peaks.length >= 2) {
    const a = peaks[peaks.length - 2]
    const b = last
    const yb = Math.min(Y(a.u * o.factor), Y(b.u * o.factor)) - 14
    const xa = X(a.t)
    const xb = X(b.t)
    ctx.strokeStyle = C.orange
    ctx.fillStyle = C.orange
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(xa, yb + 6)
    ctx.lineTo(xa, yb)
    ctx.lineTo(xb, yb)
    ctx.lineTo(xb, yb + 6)
    ctx.stroke()
    ctx.font = FONT_B
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`T = ${(b.t - a.t).toFixed(3)} s`, (xa + xb) / 2, Math.max(T + 14, yb - 2))
  }
  ctx.restore()

  // legenda
  if (extras.length) {
    const items = [{ label: o.mainLabel ?? o.name, color: C.navy, dash: [] as number[] }, ...extras]
    ctx.font = FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    let x = L + pw - 8
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      const tw = ctx.measureText(it.label).width
      x -= tw + 26
      const y = T + 10
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(x - 3, y - 8, tw + 28, 16)
      ctx.strokeStyle = it.color
      ctx.lineWidth = 2
      ctx.setLineDash(it.dash ?? [])
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + 18, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = C.ink
      ctx.fillText(it.label, x + 22, y)
    }
  }

  // titik saat ini
  const cur = samples[samples.length - 1]
  if (cur) {
    ctx.fillStyle = C.orange
    ctx.beginPath()
    ctx.arc(X(cur.t), Y(cur.u * o.factor), 4, 0, Math.PI * 2)
    ctx.fill()
  }
}
