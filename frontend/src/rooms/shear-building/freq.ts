// Grafik respons frekuensi gedung: amplitudo tunak simpangan relatif tiap lantai / ug0 vs ω/ω1 (sumbu-y log).
import { steadyRel, type Modes } from '../../lab/mdof'
import { C, FONT, FONT_B } from '../../lab/theme'

export interface Point {
  r: number // ω/ω1
  ratio: number // u_atap / ug0
  zeta: number
  key: string // identitas sistem (m, k, …) — titik dari sistem lain digambar kosong
}

export interface FreqLayout {
  L: number
  pw: number
  rMax: number
}

const Y_MIN = 0.01
const FLOOR_COLORS = ['#c9c4b5', '#a9b49c', '#8a9a7a', '#6c7e5d']

export function drawFreq(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  md: Modes,
  zeta: number,
  r: number,
  points: Point[],
  key: string,
): FreqLayout {
  const L = 56
  const R = 14
  const T = 12
  const B = 28
  const pw = w - L - R
  const ph = h - T - B
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const n = md.n
  const w1 = md.w[0]
  const rMax = Math.max(2, Math.ceil(((md.w[n - 1] / w1) * 1.15) * 2) / 2)
  // nilai fungsi di banyak titik
  const N = 700
  const curves: number[][] = Array.from({ length: n }, () => [])
  let yMaxV = 1
  for (let i = 0; i <= N; i++) {
    const rr = 0.001 + (i / N) * rMax
    const a = steadyRel(md, zeta, rr * w1, 1)
    for (let j = 0; j < n; j++) {
      curves[j].push(a[j])
      if (Number.isFinite(a[j])) yMaxV = Math.max(yMaxV, a[j])
    }
  }
  const yMax = Math.min(1000, Math.pow(10, Math.ceil(Math.log10(yMaxV * 1.3))))
  const X = (v: number) => L + (v / rMax) * pw
  const Y = (v: number) => {
    const lv = Math.log10(Math.min(Math.max(v, Y_MIN / 2), yMax * 2))
    return T + ph - ((lv - Math.log10(Y_MIN)) / (Math.log10(yMax) - Math.log10(Y_MIN))) * ph
  }

  // grid
  ctx.font = FONT
  ctx.lineWidth = 1
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let e = Math.log10(Y_MIN); e <= Math.log10(yMax) + 1e-9; e++) {
    const v = Math.pow(10, e)
    ctx.strokeStyle = Math.abs(v - 1) < 1e-9 ? C.mute : C.grid
    ctx.beginPath()
    ctx.moveTo(L, Y(v))
    ctx.lineTo(L + pw, Y(v))
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(v >= 1 ? String(v) : v.toString(), L - 6, Y(v))
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const xs = rMax > 5 ? 1 : 0.5
  for (let v = 0; v <= rMax + 1e-9; v += xs) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(X(v), T)
    ctx.lineTo(X(v), T + ph)
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(String(v), X(v), T + ph + 6)
  }
  ctx.strokeStyle = C.line
  ctx.strokeRect(L, T, pw, ph)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('ω/ω₁', L + pw, h - 1)
  ctx.save()
  ctx.translate(14, T + ph / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = C.ink
  ctx.fillText('u₀ / ug₀ (log)', 0, 0)
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(L, T, pw, ph)
  ctx.clip()
  // garis frekuensi alami
  ctx.font = FONT
  for (let k = 0; k < n; k++) {
    const x = X(md.w[k] / w1)
    ctx.setLineDash([2, 4])
    ctx.strokeStyle = C.mute
    ctx.beginPath()
    ctx.moveTo(x, T)
    ctx.lineTo(x, T + ph)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = C.mute
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`ω${k + 1}`, x + 3, T + 3)
  }
  // kurva lantai bawah (tipis) lalu atap (tebal)
  for (let j = 0; j < n; j++) {
    const roof = j === n - 1
    ctx.strokeStyle = roof ? C.navy : FLOOR_COLORS[j % FLOOR_COLORS.length]
    ctx.lineWidth = roof ? 2.2 : 1.2
    ctx.beginPath()
    curves[j].forEach((v, i) => {
      const x = L + (i / N) * pw
      if (i === 0) ctx.moveTo(x, Y(v))
      else ctx.lineTo(x, Y(v))
    })
    ctx.stroke()
  }
  // titik terukur
  for (const p of points) {
    if (p.r > rMax) continue
    const same = Math.abs(p.zeta - zeta) < 1e-9 && p.key === key
    ctx.fillStyle = same ? C.green : '#fff'
    ctx.strokeStyle = C.green
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(X(p.r), Y(p.ratio), 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  // titik kerja
  const now = steadyRel(md, zeta, r * w1, 1)[n - 1]
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = C.orange
  ctx.beginPath()
  ctx.moveTo(X(r), T)
  ctx.lineTo(X(r), T + ph)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = C.orange
  ctx.beginPath()
  ctx.arc(X(r), Y(now), 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.font = FONT_B
  ctx.fillStyle = C.orange
  const right = X(r) < L + pw - 140
  ctx.textAlign = right ? 'left' : 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`atap: ${Number.isFinite(now) ? now.toFixed(2) : '∞'} × ug₀`, X(r) + (right ? 8 : -8), Math.max(T + 30, Y(now) - 6))
  // legenda
  ctx.font = FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillStyle = C.navy
  ctx.fillText('— atap', L + pw - 8, T + 20)
  ctx.fillStyle = C.greenSoft
  if (n > 1) ctx.fillText('— lantai bawah', L + pw - 8, T + 36)
  return { L, pw, rMax }
}

export const rAt = (l: FreqLayout, x: number) => Math.min(l.rMax, Math.max(0.02, ((x - l.L) / l.pw) * l.rMax))
