// Panel mode getar: gedung mini per mode, beranimasi (diperlambat, rasio frekuensi antar mode dipertahankan).
import { shapeRoof, type Modes } from '../../lab/mdof'
import { C, FONT, FONT_B } from '../../lab/theme'

/** Periode animasi mode 1 (detik nyata). */
const T1_VIS = 1.6

export function drawModes(ctx: CanvasRenderingContext2D, w: number, h: number, md: Modes, t: number, active: number) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const n = md.n
  const cw = w / n
  const gy = h - 58
  const sh = Math.min(30, (gy - 14) / n)
  const bw = Math.min(46, cw * 0.32)
  const mTot = md.ms.reduce((a, b) => a + b, 0)
  for (let k = 0; k < n; k++) {
    const cx = cw * (k + 0.5)
    if (k === active) {
      ctx.fillStyle = 'rgba(237,141,59,0.08)'
      ctx.fillRect(cw * k + 3, 3, cw - 6, h - 6)
    }
    const shp = shapeRoof(md, k)
    const amp = Math.min(cw * 0.3, 34)
    const ph = Math.sin((2 * Math.PI * t * (md.w[k] / md.w[0])) / T1_VIS)
    const xs = shp.map((v) => cx + v * amp * ph)
    // bentuk mode statis (abu-abu)
    ctx.strokeStyle = C.line
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(cx, gy)
    shp.forEach((v, j) => ctx.lineTo(cx + v * amp, gy - (j + 1) * sh))
    ctx.moveTo(cx, gy)
    shp.forEach((v, j) => ctx.lineTo(cx - v * amp, gy - (j + 1) * sh))
    ctx.stroke()
    ctx.setLineDash([])
    // tanah
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx - bw, gy)
    ctx.lineTo(cx + bw, gy)
    ctx.stroke()
    // kolom & pelat
    ctx.strokeStyle = C.steel
    ctx.lineWidth = 1.6
    for (let j = 0; j < n; j++) {
      const xa = j === 0 ? cx : xs[j - 1]
      const ya = gy - j * sh
      const yb = gy - (j + 1) * sh
      for (const sd of [-1, 1]) {
        ctx.beginPath()
        for (let i = 0; i <= 8; i++) {
          const s = i / 8
          const f = 3 * s * s - 2 * s * s * s
          const x = xa + (xs[j] - xa) * f + (sd * bw) / 2
          const y = ya + (yb - ya) * s
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    }
    ctx.fillStyle = k === active ? C.orange : C.block
    for (let j = 0; j < n; j++) ctx.fillRect(xs[j] - bw / 2 - 4, gy - (j + 1) * sh - 3, bw + 8, 6)
    // label
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = C.ink
    ctx.font = FONT_B
    ctx.fillText(`Mode ${k + 1}`, cx, gy + 6)
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.fillText(`T = ${md.T[k].toFixed(3)} s`, cx, gy + 22)
    ctx.fillText(`Mₑ = ${((md.meff[k] / mTot) * 100).toFixed(1)}%`, cx, gy + 37)
  }
}

/** Indeks mode dari posisi x klik. */
export const modeAt = (w: number, n: number, x: number) => Math.min(n - 1, Math.max(0, Math.floor((x / w) * n)))
