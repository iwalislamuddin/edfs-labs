// Panggung Room Machine Foundation: mesin (rotasi / torak) di atas blok tanah atau meja beton + takometer.
import { dashpot, hatchH, spring } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import type { FndKind, Setup } from './model'
import { crank } from './physics'

type Ctx = CanvasRenderingContext2D

export interface StageInput {
  setup: Setup
  fd: FndKind
  /** Simpangan vertikal pondasi (m, + ke atas). */
  u: number
  th: number
  rpm: number
  rpmTarget: number
  rpmMax: number
  /** Putaran resonansi (rpm) mode vertikal. */
  rpmN: number
  /** Gaya saat ini / gaya maksimum pada putaran target (−1..1). */
  fRel: number
  r: number // m
  l: number // m
  scale: number // px per m untuk simpangan
  /** Tingkat getaran relatif 0..1 untuk gelombang radiasi. */
  level: number
}

export const targetScale = (amp: number) => Math.min(5e6, 22 / Math.max(amp, 1e-9))

export function drawStage(ctx: Ctx, w: number, h: number, o: StageInput) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const narrow = w < 560
  const cx = narrow ? w * 0.4 : w * 0.38
  const dy = -o.u * o.scale
  const bw = Math.min(230, w * (narrow ? 0.5 : 0.34))
  let topY: number // permukaan atas pondasi (bergerak)

  if (o.fd === 'tanah') {
    const gy = Math.round(h * 0.56)
    // tanah
    ctx.fillStyle = '#efe7d6'
    ctx.fillRect(0, gy, w, h - gy)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, gy)
    ctx.lineTo(w, gy)
    ctx.stroke()
    // gelombang radiasi (redaman geometris)
    const bh = 64
    const by = gy + 34 + dy
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, gy, w, h - gy)
    ctx.clip()
    const R = Math.max(w, h) * 0.6
    for (let i = 0; i < 5; i++) {
      const f = ((o.th / (2 * Math.PI)) * 0.5 + i / 5) % 1
      const rr = 30 + f * R
      ctx.strokeStyle = `rgba(150,120,80,${(0.55 * o.level * (1 - f)).toFixed(3)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, gy + 4, rr, 0, Math.PI)
      ctx.stroke()
    }
    // pegas & peredam analog Lysmer di bawah blok
    const yb = by + bh / 2
    spring(ctx, cx - 40, yb, cx - 40, h - 14, 6, 7)
    dashpot(ctx, cx + 40, h - 14, cx + 40, yb, h - 14 - (gy + 34 + bh / 2), 10)
    hatchH(ctx, cx - 70, cx + 70, h - 14, 1)
    ctx.restore()
    ctx.fillStyle = C.mute
    ctx.font = FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('kz, cz (analog Lysmer)', cx + 58, h - 40)
    // blok beton
    ctx.fillStyle = '#b9b6ad'
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.fillRect(cx - bw / 2, by - bh / 2, bw, bh)
    ctx.strokeRect(cx - bw / 2, by - bh / 2, bw, bh)
    ctx.fillStyle = C.ink
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.fillText('blok pondasi beton', cx, by + 8)
    topY = by - bh / 2
  } else {
    const gy = h - 30
    hatchH(ctx, cx - bw / 2 - 40, cx + bw / 2 + 40, gy, 1)
    const deckY = gy - Math.min(170, h * 0.42) + dy
    const dh = 22
    // kolom (memendek/memanjang mengikuti simpangan)
    ctx.fillStyle = '#c9c6bd'
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.2
    for (const sd of [-1, 1]) {
      const x = cx + sd * (bw / 2 - 18)
      ctx.fillRect(x - 10, deckY + dh, 20, gy - deckY - dh)
      ctx.strokeRect(x - 10, deckY + dh, 20, gy - deckY - dh)
    }
    ctx.fillStyle = '#b9b6ad'
    ctx.fillRect(cx - bw / 2 - 10, deckY, bw + 20, dh)
    ctx.strokeRect(cx - bw / 2 - 10, deckY, bw + 20, dh)
    ctx.fillStyle = C.mute
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('meja beton (table-top) — k, ζ', cx, gy - 40)
    topY = deckY
  }

  // ---- mesin ----
  const mx = cx
  if (o.setup === 'rotasi') {
    const ch = 70
    const cy = topY - ch / 2 - 8
    // pedestal bantalan
    ctx.fillStyle = C.steel
    for (const sd of [-1, 1]) ctx.fillRect(mx + sd * 46 - 8, cy, 16, topY - cy)
    // motor
    ctx.fillStyle = C.block
    ctx.fillRect(mx - 120, topY - 46, 52, 46)
    ctx.fillStyle = '#fff'
    ctx.font = FONT_B
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('M', mx - 94, topY - 23)
    ctx.strokeStyle = C.steel
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(mx - 68, cy)
    ctx.lineTo(mx + 60, cy)
    ctx.stroke()
    // rotor
    const R = 30
    ctx.fillStyle = '#dcd9cf'
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(mx, cy, R, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    const ex = mx + (R - 7) * Math.sin(o.th)
    const ey = cy - (R - 7) * Math.cos(o.th)
    ctx.strokeStyle = C.mute
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(mx, cy)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    ctx.fillStyle = C.red
    ctx.beginPath()
    ctx.arc(ex, ey, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = C.mute
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText('rotor + massa tak seimbang', mx, cy - R - 6)
  } else {
    const cbH = 52
    const cbW = 120
    const cy = topY - cbH / 2
    const rp = 14 + ((o.r - 0.03) / 0.27) * 22 // px
    const k = rp / o.r // px per m mekanisme
    ctx.fillStyle = '#d8d4c9'
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.fillRect(mx - cbW / 2, topY - cbH, cbW, cbH)
    ctx.strokeRect(mx - cbW / 2, topY - cbH, cbW, cbH)
    // silinder
    const { x } = crank(o.r, o.l, o.th)
    const yTopDead = cy - (o.r + o.l) * k
    const cylTop = yTopDead - 34
    ctx.fillStyle = '#ebe8df'
    ctx.fillRect(mx - 22, cylTop, 44, topY - cbH - cylTop)
    ctx.strokeRect(mx - 22, cylTop, 44, topY - cbH - cylTop)
    // engkol
    const px = mx + rp * Math.sin(o.th)
    const py = cy - rp * Math.cos(o.th)
    ctx.strokeStyle = C.mute
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(mx, cy, rp, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = C.steel
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(mx, cy)
    ctx.lineTo(px, py)
    ctx.stroke()
    // torak & batang
    const yp = cy - x * k
    ctx.lineWidth = 4
    ctx.strokeStyle = C.ink
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(mx, yp)
    ctx.stroke()
    ctx.fillStyle = C.block
    ctx.fillRect(mx - 19, yp - 30, 38, 34)
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(mx, yp, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = C.red
    ctx.beginPath()
    ctx.arc(px, py, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = C.mute
    ctx.font = FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('torak', mx + 26, yp - 12)
    ctx.fillText('engkol', mx + cbW / 2 + 6, cy)
  }

  // panah gaya getar ke pondasi
  const fx = cx + bw / 2 + 30
  const fy = topY - 40
  const len = -o.fRel * 60
  if (Math.abs(len) > 3) {
    ctx.strokeStyle = C.red
    ctx.fillStyle = C.red
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(fx, fy)
    ctx.lineTo(fx, fy + len)
    ctx.stroke()
    const d = Math.sign(len)
    ctx.beginPath()
    ctx.moveTo(fx, fy + len + d * 9)
    ctx.lineTo(fx - 6, fy + len)
    ctx.lineTo(fx + 6, fy + len)
    ctx.fill()
  }
  ctx.fillStyle = C.red
  ctx.font = FONT_B
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('F(t)', fx + 10, fy)

  // skala
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`simpangan vertikal diperbesar ×${fmtBig(o.scale / 1000)}`, 12, 10)

  drawTacho(ctx, narrow ? w - 64 : w * 0.82, narrow ? 76 : h * 0.36, narrow ? 50 : Math.min(80, w * 0.1), o)
}

const fmtBig = (v: number) => (v >= 1e4 ? `${Math.round(v / 1000)} rb` : v >= 10 ? Math.round(v).toString() : v.toFixed(1))

/** Takometer: busur 240° untuk 0..rpmMax, pita resonansi ±20%. */
function drawTacho(ctx: Ctx, cx: number, cy: number, R: number, o: StageInput) {
  const a0 = (210 * Math.PI) / 180
  const sweep = (240 * Math.PI) / 180
  const ang = (rpm: number) => a0 - (Math.min(rpm, o.rpmMax) / o.rpmMax) * sweep
  const arc = (r1: number, r2: number, color: string, width: number) => {
    if (r2 <= 0 || r1 >= o.rpmMax) return
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.arc(cx, cy, R, -ang(Math.max(0, r1)), -ang(Math.min(o.rpmMax, r2)))
    ctx.stroke()
  }
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(cx, cy, R + 10, 0, Math.PI * 2)
  ctx.fill()
  arc(0, o.rpmMax, C.line, 8)
  arc(0.8 * o.rpmN, 1.25 * o.rpmN, 'rgba(181,69,47,0.75)', 8)
  if (o.setup === 'torak') arc(0.4 * o.rpmN, 0.625 * o.rpmN, 'rgba(237,141,59,0.75)', 8)
  // tik
  ctx.strokeStyle = C.mute
  ctx.lineWidth = 1
  ctx.font = FONT
  ctx.fillStyle = C.mute
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const step = o.rpmMax > 2000 ? 600 : 200
  for (let r = 0; r <= o.rpmMax + 1e-9; r += step) {
    const a = ang(r)
    ctx.beginPath()
    ctx.moveTo(cx + (R - 6) * Math.cos(a), cy - (R - 6) * Math.sin(a))
    ctx.lineTo(cx + (R + 4) * Math.cos(a), cy - (R + 4) * Math.sin(a))
    ctx.stroke()
    if (R > 60) ctx.fillText(String(r), cx + (R - 20) * Math.cos(a), cy - (R - 20) * Math.sin(a))
  }
  // target
  const at = ang(o.rpmTarget)
  ctx.fillStyle = C.green
  ctx.beginPath()
  ctx.arc(cx + (R + 9) * Math.cos(at), cy - (R + 9) * Math.sin(at), 4, 0, Math.PI * 2)
  ctx.fill()
  // jarum
  const a = ang(o.rpm)
  ctx.strokeStyle = C.navy
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + (R - 10) * Math.cos(a), cy - (R - 10) * Math.sin(a))
  ctx.stroke()
  ctx.fillStyle = C.navy
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = FONT_B
  ctx.fillText(`${Math.round(o.rpm)} rpm`, cx, cy + R * 0.45)
  ctx.font = FONT
  ctx.fillStyle = C.red
  ctx.fillText('resonansi', cx, cy + R * 0.45 + 15)
}
