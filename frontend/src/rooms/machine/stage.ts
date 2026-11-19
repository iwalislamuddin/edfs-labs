// Panggung Room Machine Foundation: mesin (rotasi / torak) di atas blok tanah (geser + vertikal + rocking) atau
// meja beton (vertikal), orbit titik bantalan, dan takometer dengan pita resonansi.
import { dashpot, hatchH, spring } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import type { FndKind, Setup } from './model'
import { crank } from './physics'

type Ctx = CanvasRenderingContext2D

export interface Band {
  rpm: number
  color: string
}

export interface StageInput {
  setup: Setup
  fd: FndKind
  /** Gerak benda kaku di CG: x (kanan), z (atas) dalam m, ψ (rad, berlawanan jarum jam). */
  x: number
  z: number
  psi: number
  th: number
  rpm: number
  rpmTarget: number
  rpmMax: number
  /** Putaran resonansi tiap mode (rpm) beserta warna pita. */
  bands: Band[]
  /** Pita harmonik kedua (torak): putaran saat 2ω = ωn. */
  bands2: Band[]
  /** Gaya saat ini / gaya maksimum (−1..1): [horizontal, vertikal]. */
  fRel: [number, number]
  r: number // m
  l: number // m
  /** Geometri blok (m) — pondasi tanah. */
  L: number
  Hb: number
  hs: number
  ex: number
  zc: number
  scale: number // px per m untuk simpangan
  /** Orbit bantalan satu putaran terakhir: pasangan (horizontal, vertikal) dalam m. */
  orbit: [number, number][]
  level: number
}

export const targetScale = (amp: number) => Math.min(5e6, 22 / Math.max(amp, 1e-9))

export function drawStage(ctx: Ctx, w: number, h: number, o: StageInput) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const narrow = w < 560
  const cx = narrow ? w * 0.4 : w * 0.38
  const s = o.scale
  let bearingPx: [number, number]

  if (o.fd === 'tanah') {
    const gy = Math.round(h * 0.68)
    const bwMax = Math.min(240, w * (narrow ? 0.5 : 0.34))
    const gs = Math.min(bwMax / o.L, (gy - 70) / (o.Hb + o.hs + 0.6)) // px per m geometri
    const bw = o.L * gs
    const bh = o.Hb * gs
    // tanah + gelombang radiasi
    ctx.fillStyle = '#efe7d6'
    ctx.fillRect(0, gy, w, h - gy)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, gy, w, h - gy)
    ctx.clip()
    const R = Math.max(w, h) * 0.6
    for (let i = 0; i < 5; i++) {
      const f = ((o.th / (2 * Math.PI)) * 0.5 + i / 5) % 1
      ctx.strokeStyle = `rgba(150,120,80,${(0.55 * o.level * (1 - f)).toFixed(3)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, gy, 30 + f * R, 0, Math.PI)
      ctx.stroke()
    }
    ctx.restore()
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, gy)
    ctx.lineTo(w, gy)
    ctx.stroke()
    // pegas & peredam analog (vertikal di kedua sisi menggambarkan kz & kψ; horizontal untuk kx)
    const ub = (dxm: number) => [cx + dxm * gs + (o.x + o.zc * o.psi) * s, gy - (o.z + dxm * o.psi) * s] as const
    const y1 = h - 12
    for (const sd of [-0.35, 0.35]) {
      const [px, py] = ub(sd * o.L)
      spring(ctx, px, py, px, y1, 5, 6)
    }
    const [dpx, dpy] = ub(0)
    dashpot(ctx, dpx, y1, dpx, dpy, y1 - gy, 9)
    hatchH(ctx, cx - bw / 2 - 20, cx + bw / 2 + 20, y1, 1)
    const [hx0, hy0] = ub(-0.5 * o.L)
    spring(ctx, hx0, hy0 + 14, cx - bw / 2 - 70, hy0 + 14, 5, 5)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx - bw / 2 - 70, hy0 + 4)
    ctx.lineTo(cx - bw / 2 - 70, hy0 + 24)
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.font = FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('kz, kψ, kx + peredam radiasi', cx + bw / 2 + 14, h - 30)

    // benda kaku: translasi CG + rotasi ψ (diperbesar konsisten: sudut gambar = ψ·s/gs)
    const cgX = cx
    const cgY = gy - o.zc * gs
    ctx.save()
    ctx.translate(cgX + o.x * s, cgY - o.z * s)
    ctx.rotate((-o.psi * s) / gs)
    ctx.translate(-cgX, -cgY)
    ctx.fillStyle = '#b9b6ad'
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.fillRect(cx - bw / 2, gy - bh, bw, bh)
    ctx.strokeRect(cx - bw / 2, gy - bh, bw, bh)
    ctx.fillStyle = C.ink
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    if (bh > 24) ctx.fillText('blok beton', cx - bw / 2 + 8, gy - bh / 2)
    const mx = cx + o.ex * gs
    const top = gy - bh
    const cy = top - Math.max(30, o.hs * gs)
    drawMachine(ctx, o, mx, top, cy)
    // CG
    ctx.fillStyle = C.navy
    ctx.beginPath()
    ctx.arc(cgX, cgY, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = C.navy
    ctx.textAlign = 'left'
    ctx.fillText('CG', cgX + 7, cgY)
    ctx.restore()
    // posisi bantalan di gambar (rest) untuk orbit
    bearingPx = [mx, cy]
  } else {
    const gy = h - 30
    const bw = Math.min(230, w * (narrow ? 0.5 : 0.34))
    hatchH(ctx, cx - bw / 2 - 40, cx + bw / 2 + 40, gy, 1)
    const dy = -o.z * s
    const deckY = gy - Math.min(170, h * 0.42) + dy
    const dh = 22
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
    ctx.fillText('meja beton (table-top) — hanya mode vertikal', cx, gy - 40)
    const cy = deckY - 43
    drawMachine(ctx, o, cx, deckY, cy)
    bearingPx = [cx, cy - dy]
  }

  // orbit bantalan (simpangan diperbesar)
  if (o.orbit.length > 2) {
    const [bx, by] = bearingPx
    ctx.strokeStyle = C.orange
    ctx.lineWidth = 1.6
    ctx.beginPath()
    o.orbit.forEach(([ox, oz], i) => {
      const px = bx + ox * s
      const py = by - oz * s
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.stroke()
    const [lx, lz] = o.orbit[o.orbit.length - 1]
    ctx.fillStyle = C.orange
    ctx.beginPath()
    ctx.arc(bx + lx * s, by - lz * s, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'right'
    ctx.fillText('orbit bantalan', bx - 36, by - 30)
  }

  // panah gaya (horizontal & vertikal) di sisi kanan
  const fx0 = cx + Math.min(230, w * 0.34) / 2 + 36
  const fy0 = Math.round(h * 0.18) + 40
  arrowF(ctx, fx0, fy0, 0, -o.fRel[1] * 50)
  if (o.fd === 'tanah') arrowF(ctx, fx0, fy0, o.fRel[0] * 50, 0)
  ctx.fillStyle = C.red
  ctx.font = FONT_B
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('F(t)', fx0 + 8, fy0 - 52)

  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`simpangan & rotasi diperbesar ×${fmtBig(o.scale / 1000)}`, 12, 10)

  drawTacho(ctx, narrow ? w - 64 : w * 0.82, narrow ? 76 : h * 0.34, narrow ? 50 : Math.min(80, w * 0.1), o)
}

function arrowF(ctx: Ctx, x: number, y: number, dx: number, dy: number) {
  const len = Math.hypot(dx, dy)
  if (len < 3) return
  ctx.strokeStyle = C.red
  ctx.fillStyle = C.red
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + dx, y + dy)
  ctx.stroke()
  const ux = dx / len
  const uy = dy / len
  ctx.beginPath()
  ctx.moveTo(x + dx + ux * 9, y + dy + uy * 9)
  ctx.lineTo(x + dx - uy * 6, y + dy + ux * 6)
  ctx.lineTo(x + dx + uy * 6, y + dy - ux * 6)
  ctx.fill()
}

/** Mesin di atas permukaan `top` dengan poros/engkol di (mx, cy). */
function drawMachine(ctx: Ctx, o: StageInput, mx: number, top: number, cy: number) {
  if (o.setup === 'rotasi') {
    ctx.fillStyle = C.steel
    for (const sd of [-1, 1]) ctx.fillRect(mx + sd * 46 - 8, cy, 16, top - cy)
    ctx.fillStyle = C.block
    ctx.fillRect(mx - 120, top - 46, 52, 46)
    ctx.fillStyle = '#fff'
    ctx.font = FONT_B
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('M', mx - 94, top - 23)
    ctx.strokeStyle = C.steel
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(mx - 68, Math.min(cy, top - 23))
    ctx.lineTo(mx - 68, cy)
    ctx.lineTo(mx + 60, cy)
    ctx.stroke()
    const R = 28
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
  } else {
    const cbW = 120
    const rp = 14 + ((o.r - 0.03) / 0.27) * 22
    const k = rp / o.r
    // rumah engkol dari muka pondasi sampai sedikit di atas poros
    const cbTop = Math.min(cy - rp - 8, top - 30)
    ctx.fillStyle = '#d8d4c9'
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.fillRect(mx - cbW / 2, cbTop, cbW, top - cbTop)
    ctx.strokeRect(mx - cbW / 2, cbTop, cbW, top - cbTop)
    const { x } = crank(o.r, o.l, o.th)
    const cylTop = cy - (o.r + o.l) * k - 34
    ctx.fillStyle = '#ebe8df'
    ctx.fillRect(mx - 22, cylTop, 44, cbTop - cylTop)
    ctx.strokeRect(mx - 22, cylTop, 44, cbTop - cylTop)
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
    const yp = cy - x * k
    ctx.lineWidth = 4
    ctx.strokeStyle = C.ink
    ctx.beginPath()
    ctx.moveTo(px, py)
    ctx.lineTo(mx, yp)
    ctx.stroke()
    ctx.fillStyle = C.block
    ctx.fillRect(mx - 19, yp - 30, 38, 34)
    ctx.fillStyle = C.red
    ctx.beginPath()
    ctx.arc(px, py, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  // tanda poros / bantalan
  ctx.strokeStyle = C.orange
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(mx - 6, cy)
  ctx.lineTo(mx + 6, cy)
  ctx.moveTo(mx, cy - 6)
  ctx.lineTo(mx, cy + 6)
  ctx.stroke()
}

const fmtBig = (v: number) => (v >= 1e4 ? `${Math.round(v / 1000)} rb` : v >= 10 ? Math.round(v).toString() : v.toFixed(1))

/** Takometer: busur 240° untuk 0..rpmMax, pita resonansi ±20% tiap mode. */
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
  for (const b of o.bands2) arc(0.8 * b.rpm, 1.25 * b.rpm, b.color, 5)
  for (const b of o.bands) arc(0.8 * b.rpm, 1.25 * b.rpm, b.color, 8)
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
  const at = ang(o.rpmTarget)
  ctx.fillStyle = C.green
  ctx.beginPath()
  ctx.arc(cx + (R + 9) * Math.cos(at), cy - (R + 9) * Math.sin(at), 4, 0, Math.PI * 2)
  ctx.fill()
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
  ctx.fillText('pita resonansi', cx, cy + R * 0.45 + 15)
}
