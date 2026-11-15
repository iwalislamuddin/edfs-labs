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

  // titik saat ini
  const cur = samples[samples.length - 1]
  if (cur) {
    ctx.fillStyle = C.orange
    ctx.beginPath()
    ctx.arc(X(cur.t), Y(cur.u * o.factor), 4, 0, Math.PI * 2)
    ctx.fill()
  }
}
