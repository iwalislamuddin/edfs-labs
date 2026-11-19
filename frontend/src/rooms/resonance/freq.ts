// Grafik respons frekuensi: rasio amplitudo (Rd atau TR) dan sudut fase φ terhadap β = ω/ωn.
import { C, FONT, FONT_B } from '../../lab/theme'
import { ISOLATION_BETA, phase, phaseTR, Rd, rdPeak, TR, type Excite } from './physics'

export interface Point {
  beta: number
  ratio: number
  phase: number
  zeta: number
}

export interface FreqInput {
  excite: Excite
  zeta: number
  beta: number
  points: Point[]
  showRef: boolean
}

export interface FreqLayout {
  L: number
  pw: number
  bMax: number
}

export const B_MAX = 3
const REF_ZETA = [0.05, 0.1, 0.2, 0.5, 1]

const ratioFn = (e: Excite) => (e === 'force' ? Rd : TR)
const phaseFn = (e: Excite) => (e === 'force' ? phase : phaseTR)

/** Nilai puncak kurva rasio pada ζ tertentu (numerik untuk TR). */
function peakOf(e: Excite, z: number) {
  if (e === 'force') return rdPeak(z).value
  let m = 0
  for (let b = 0; b <= 2; b += 0.002) m = Math.max(m, TR(b, z))
  return m
}

export function drawFreq(ctx: CanvasRenderingContext2D, w: number, h: number, o: FreqInput): FreqLayout {
  const L = 56
  const R = 14
  const T = 12
  const B = 26
  const gap = 22
  const pw = w - L - R
  const hA = Math.round((h - T - B - gap) * 0.64)
  const hP = h - T - B - gap - hA
  const yA0 = T
  const yP0 = T + hA + gap
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)

  const fr = ratioFn(o.excite)
  const fp = phaseFn(o.excite)
  const pk = peakOf(o.excite, o.zeta)
  const yMax = Math.min(12, Math.max(3, Math.ceil(pk * 1.15)))
  const X = (b: number) => L + (b / B_MAX) * pw
  const YA = (v: number) => yA0 + hA - (Math.min(v, yMax * 1.05) / yMax) * hA
  const YP = (deg: number) => yP0 + (deg / 180) * hP
  const sym = o.excite === 'force' ? 'Rd' : 'TR'

  // ---- grid ----
  ctx.font = FONT
  ctx.lineWidth = 1
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const ys = yMax <= 4 ? 1 : yMax <= 8 ? 2 : 3
  for (let v = 0; v <= yMax + 1e-9; v += ys) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(L, YA(v))
    ctx.lineTo(L + pw, YA(v))
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(String(v), L - 6, YA(v))
  }
  for (const d of [0, 90, 180]) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(L, YP(d))
    ctx.lineTo(L + pw, YP(d))
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(`${d}°`, L - 6, YP(d))
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let b = 0; b <= B_MAX + 1e-9; b += 0.5) {
    for (const [y0, hh] of [
      [yA0, hA],
      [yP0, hP],
    ]) {
      ctx.strokeStyle = Math.abs(b - 1) < 1e-9 ? C.line : C.grid
      ctx.beginPath()
      ctx.moveTo(X(b), y0)
      ctx.lineTo(X(b), y0 + hh)
      ctx.stroke()
    }
    ctx.fillStyle = C.mute
    ctx.fillText(b.toFixed(1), X(b), yP0 + hP + 5)
  }
  ctx.strokeStyle = C.line
  ctx.strokeRect(L, yA0, pw, hA)
  ctx.strokeRect(L, yP0, pw, hP)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('β = ω/ωn', L + pw, h - 1)
  for (const [label, y] of [
    [sym, yA0 + hA / 2],
    ['φ', yP0 + hP / 2],
  ] as const) {
    ctx.save()
    ctx.translate(14, y)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = C.ink
    ctx.fillText(label, 0, 0)
    ctx.restore()
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(L, yA0, pw, hA)
  ctx.rect(L, yP0, pw, hP)
  ctx.clip()

  // daerah isolasi (TR < 1) dan garis rasio = 1
  if (o.excite === 'base') {
    ctx.fillStyle = 'rgba(86,100,73,0.07)'
    ctx.fillRect(X(ISOLATION_BETA), yA0, L + pw - X(ISOLATION_BETA), hA)
    ctx.fillStyle = C.green
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('isolasi: TR < 1', X(ISOLATION_BETA) + 6, yA0 + 4)
  }
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = C.mute
  ctx.beginPath()
  ctx.moveTo(L, YA(1))
  ctx.lineTo(L + pw, YA(1))
  ctx.stroke()
  ctx.setLineDash([])

  const curve = (z: number, color: string, width: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    for (let i = 0; i <= 600; i++) {
      const b = (i / 600) * B_MAX
      const y = YA(fr(b, z))
      if (i === 0) ctx.moveTo(X(b), y)
      else ctx.lineTo(X(b), y)
    }
    ctx.stroke()
    ctx.beginPath()
    for (let i = 0; i <= 600; i++) {
      const b = (i / 600) * B_MAX
      const y = YP((fp(b, z) * 180) / Math.PI)
      if (i === 0) ctx.moveTo(X(b), y)
      else ctx.lineTo(X(b), y)
    }
    ctx.stroke()
  }

  if (o.showRef) {
    ctx.font = FONT
    for (const z of REF_ZETA) {
      if (Math.abs(z - o.zeta) < 1e-6) continue
      curve(z, '#d5d2c7', 1)
      // label di dekat puncak
      const bp = o.excite === 'force' ? Math.max(rdPeak(z).beta, 0.05) : 1
      const v = fr(bp, z)
      if (v < yMax) {
        ctx.fillStyle = C.mute
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`ζ=${z}`, X(bp) + 4, YA(v) - 1)
      }
    }
  }
  curve(o.zeta, C.navy, 2.2)

  // titik terukur
  for (const p of o.points) {
    const same = Math.abs(p.zeta - o.zeta) < 1e-6
    ctx.strokeStyle = C.green
    ctx.fillStyle = same ? C.green : '#fff'
    ctx.lineWidth = 1.5
    for (const [x, y] of [
      [X(p.beta), YA(p.ratio)],
      [X(p.beta), YP((p.phase * 180) / Math.PI)],
    ]) {
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  // titik kerja saat ini
  const xb = X(o.beta)
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = C.orange
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(xb, yA0)
  ctx.lineTo(xb, yA0 + hA)
  ctx.moveTo(xb, yP0)
  ctx.lineTo(xb, yP0 + hP)
  ctx.stroke()
  ctx.setLineDash([])
  const rNow = fr(o.beta, o.zeta)
  const pNow = (fp(o.beta, o.zeta) * 180) / Math.PI
  ctx.fillStyle = C.orange
  for (const y of [YA(rNow), YP(pNow)]) {
    ctx.beginPath()
    ctx.arc(xb, y, 5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // label titik kerja
  ctx.font = FONT_B
  ctx.fillStyle = C.orange
  const right = xb < L + pw - 120
  ctx.textAlign = right ? 'left' : 'right'
  ctx.textBaseline = 'bottom'
  const lab = `${sym} = ${Number.isFinite(rNow) ? rNow.toFixed(2) : '∞'}`
  ctx.fillText(lab, xb + (right ? 8 : -8), Math.max(yA0 + 14, YA(rNow) - 6))
  ctx.textBaseline = 'top'
  ctx.fillText(`φ = ${pNow.toFixed(0)}°`, xb + (right ? 8 : -8), Math.min(YP(pNow) + 4, yP0 + hP - 14))
  if (pk > yMax) {
    ctx.font = FONT
    ctx.fillStyle = C.navy
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(`puncak ${sym} = ${Number.isFinite(pk) ? pk.toFixed(1) : '∞'} (terpotong)`, L + pw - 6, yA0 + (o.excite === 'base' ? 20 : 4))
  }
  return { L, pw, bMax: B_MAX }
}

/** β dari posisi x pointer di grafik. */
export const betaAt = (l: FreqLayout, x: number) => Math.min(l.bMax, Math.max(0.02, ((x - l.L) / l.pw) * l.bMax))
