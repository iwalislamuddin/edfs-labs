// Gambar stage Room Spring untuk keempat setup + konversi pointer -> q.
import { arrow, dashpot, dimH, dimV, hatchH, hatchV, refLineH, refLineV, roundRect, spring } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import { L0, type Params, type Setup } from './model'

type Ctx = CanvasRenderingContext2D

export interface Layout {
  setup: Setup
  s: number // px per meter
  anchor: number // tarik: y plafon; tekan: y lantai; horizontal: x dinding
  cx: number
  cy: number
  R: number // rotasi: jari-jari piringan (px)
  hit: { x: number; y: number; w: number; h: number } | { cx: number; cy: number; r: number }
}

const MARGIN = 40
export const blockSize = (m: number) => 0.08 + 0.04 * Math.cbrt(m)

/** Skala px/m yang diinginkan untuk ukuran canvas & parameter sekarang. */
export function targetScale(setup: Setup, w: number, h: number, p: Params, qeq: number, q: number) {
  const b = blockSize(p.m)
  switch (setup) {
    case 'tarik': {
      const need = L0 + Math.max(qeq + 0.25, q + 0.05, 0.25) + b + 0.06
      return Math.min((h - 2 * MARGIN) / need, (w * 0.9) / 0.9)
    }
    case 'tekan': {
      const need = L0 + Math.max(0.25, -q + 0.05) + b + 0.12
      return (h - 2 * MARGIN) / need
    }
    case 'horizontal': {
      const need = L0 + Math.max(0.3, q + 0.05) + b + 0.05
      return Math.min((w - 2 * MARGIN - 60) / need, (h - 2 * MARGIN) / (b * 3.2))
    }
    case 'rotasi':
      return 1
  }
}

export interface DrawOpts {
  forces: boolean
  qeq: number
}

const cm = (m: number) => `${(m * 100).toFixed(1)} cm`

export function drawStage(ctx: Ctx, w: number, h: number, setup: Setup, p: Params, q: number, s: number, o: DrawOpts): Layout {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  if (setup === 'rotasi') return drawRotasi(ctx, w, h, p, q)
  if (setup === 'horizontal') return drawHorizontal(ctx, w, h, p, q, s, o)
  return drawVertical(ctx, w, h, setup, p, q, s, o)
}

function drawBlock(ctx: Ctx, x: number, y: number, size: number, m: number) {
  roundRect(ctx, x, y, size, size, 4)
  ctx.fillStyle = C.block
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = FONT_B
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (size > 34) ctx.fillText(`${m.toFixed(1)} kg`, x + size / 2, y + size / 2)
}

function drawVertical(ctx: Ctx, w: number, _h: number, setup: Setup, p: Params, q: number, s: number, o: DrawOpts): Layout {
  const hang = setup === 'tarik'
  const cx = Math.round(w * 0.42)
  const b = blockSize(p.m) * s
  const hasD = p.c > 0
  const xs = hasD ? cx - b * 0.22 : cx
  const xd = cx + b * 0.22
  const amp = Math.max(7, Math.min(14, b * 0.16))
  const anchor = hang ? MARGIN : _h - MARGIN
  const dir = hang ? 1 : -1
  // ujung pegas yang bergerak (sisi benda)
  const yEnd = anchor + dir * (L0 + (hang ? q : -q)) * s
  const yNat = anchor + dir * L0 * s
  const yEq = anchor + dir * (L0 + (hang ? o.qeq : -o.qeq)) * s

  hatchH(ctx, cx - b * 1.1, cx + b * 1.1, anchor, hang ? -1 : 1)
  const xr1 = cx + b * 0.75
  const xr2 = Math.min(w - 12, cx + b * 0.75 + 190)
  refLineH(ctx, xr1, xr2, yNat, 'panjang bebas', C.mute, [2, 3])
  if (p.g > 0) refLineH(ctx, xr1, xr2, yEq, 'kesetimbangan', C.green, [6, 4])

  // pegas & peredam
  spring(ctx, xs, anchor, xs, yEnd, 11, amp)
  if (hasD) dashpot(ctx, xd, anchor, xd, yEnd, L0 * s, Math.max(10, b * 0.14))
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(xs - amp - 2, yEnd)
  ctx.lineTo((hasD ? xd : xs) + amp + 2, yEnd)
  ctx.stroke()

  const by = hang ? yEnd : yEnd - b
  drawBlock(ctx, cx - b / 2, by, b, p.m)

  // ukuran: lendutan statis (kiri) & simpangan (kanan)
  const xl = cx - b / 2 - 16
  if (p.g > 0) dimV(ctx, xl, yNat, yEq, `δst = ${cm(o.qeq)}`, C.green, -1)
  const u = q - o.qeq
  if (Math.abs(u) > 0.002) dimV(ctx, xl, yEq, yEnd, `u = ${cm(u)}`, C.navy, -1)

  // panah gaya (di samping kanan benda supaya tidak menutupi balok)
  if (o.forces && p.g > 0) {
    const W = p.m * p.g
    const Fs = p.k * q // gaya pegas pada benda, positif = ke atas (tarik: memanjang; tekan: memendek)
    const sc = 60 / W
    const cyb = by + b / 2
    const xf = cx + b / 2 + 14
    arrow(ctx, xf, cyb, xf, cyb + W * sc, C.red)
    const fl = Math.max(-170, Math.min(170, Fs * sc))
    arrow(ctx, xf + 8, cyb, xf + 8, cyb - fl, C.orange)
    ctx.font = FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = C.red
    ctx.fillText(`W = m·g = ${W.toFixed(1)} N`, xf + 16, cyb + W * sc - 6)
    ctx.fillStyle = C.orange
    ctx.fillText(`Fk = k·x = ${Math.abs(Fs).toFixed(1)} N ${Fs >= 0 ? '↑' : '↓'}`, xf + 16, cyb - fl + (fl >= 0 ? 6 : -6))
  }

  if (!hang && q > 0.85 * L0) {
    ctx.fillStyle = C.red
    ctx.font = FONT_B
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('Pegas hampir mampat penuh — model linear tidak berlaku lagi', w / 2, 10)
  }
  return { setup, s, anchor, cx, cy: 0, R: 0, hit: { x: cx - b / 2, y: by, w: b, h: b } }
}

function drawHorizontal(ctx: Ctx, w: number, h: number, p: Params, q: number, s: number, o: DrawOpts): Layout {
  const b = blockSize(p.m) * s
  const anchor = MARGIN + 10
  const cy = Math.round(h * 0.5)
  const floor = cy + b / 2 + 8
  const hasD = p.c > 0
  const ys = hasD ? cy - b * 0.22 : cy
  const yd = cy + b * 0.22
  const amp = Math.max(7, Math.min(14, b * 0.16))
  const xEnd = anchor + (L0 + q) * s
  const xNat = anchor + L0 * s

  hatchV(ctx, anchor, cy - b * 1.2, floor, -1)
  hatchH(ctx, anchor, w - MARGIN / 2, floor, 1)
  refLineV(ctx, xNat, cy - b * 1.1, floor - 2, 'kesetimbangan = panjang bebas', C.green, [6, 4])

  spring(ctx, anchor, ys, xEnd, ys, 11, amp)
  if (hasD) dashpot(ctx, anchor, yd, xEnd, yd, L0 * s, Math.max(10, b * 0.14))
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(xEnd, ys - amp - 2)
  ctx.lineTo(xEnd, (hasD ? yd : ys) + amp + 2)
  ctx.stroke()

  drawBlock(ctx, xEnd, cy - b / 2, b, p.m)
  // roda
  ctx.fillStyle = C.steel
  for (const fx of [0.25, 0.75]) {
    ctx.beginPath()
    ctx.arc(xEnd + b * fx, floor - 4, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  const u = q
  if (Math.abs(u) > 0.002) dimH(ctx, xNat, xEnd, floor + 16, `u = ${cm(u)}`, C.navy)
  if (o.forces) {
    const Fs = -p.k * q
    const sc = 0.6
    const fl = Math.max(-160, Math.min(160, Fs * sc))
    arrow(ctx, xEnd + b / 2, cy - b / 2 - 16, xEnd + b / 2 + fl, cy - b / 2 - 16, C.orange)
    ctx.fillStyle = C.orange
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    if (Math.abs(fl) > 2) ctx.fillText(`Fk = ${Math.abs(Fs).toFixed(1)} N`, xEnd + b / 2 + fl / 2, cy - b / 2 - 22)
  }
  return { setup: 'horizontal', s, anchor, cx: 0, cy, R: 0, hit: { x: xEnd, y: cy - b / 2, w: b, h: b } }
}

function drawRotasi(ctx: Ctx, w: number, h: number, p: Params, theta: number): Layout {
  const cx = w * 0.45
  const cy = h * 0.5
  const R = Math.min(w * 0.7, h - 2 * MARGIN) * 0.42
  const P = (a: number, r: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)]

  // busur derajat tetap
  ctx.strokeStyle = C.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, R + 14, 0, Math.PI * 2)
  ctx.stroke()
  ctx.font = FONT
  ctx.fillStyle = C.mute
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let d = -180; d < 180; d += 15) {
    const a = (d * Math.PI) / 180
    const major = d % 45 === 0
    ctx.strokeStyle = major ? C.mute : C.line
    ctx.beginPath()
    ctx.moveTo(...P(a, R + 14))
    ctx.lineTo(...P(a, R + (major ? 24 : 19)))
    ctx.stroke()
    if (major) ctx.fillText(`${d}°`, ...P(a, R + 36))
  }

  // piringan
  const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R)
  g.addColorStop(0, '#5f6d52')
  g.addColorStop(1, C.block)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
  // jari-jari & penanda
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 2
  for (let i = 0; i < 6; i++) {
    const a = theta + (i * Math.PI) / 3
    ctx.beginPath()
    ctx.moveTo(...P(a, R * 0.62))
    ctx.lineTo(...P(a, R * 0.95))
    ctx.stroke()
  }
  ctx.strokeStyle = C.orange
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(...P(theta, R * 0.62))
  ctx.lineTo(...P(theta, R + 10))
  ctx.stroke()

  // garis kesetimbangan & busur sudut
  ctx.save()
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = C.green
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(...P(0, R + 14))
  ctx.stroke()
  ctx.restore()
  if (Math.abs(theta) > 0.01) {
    ctx.strokeStyle = C.navy
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.52, -Math.PI / 2, -Math.PI / 2 + theta, theta < 0)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = FONT_B
    ctx.fillText(`θ = ${((theta * 180) / Math.PI).toFixed(1)}°`, ...P(theta / 2, R * 0.38))
  }

  // pegas spiral: ujung dalam ikut poros (θ), ujung luar dijepit braket tetap
  const r0 = R * 0.08
  const r1 = R * 0.3
  const turns = 3.5
  const N = 220
  ctx.strokeStyle = '#d9dcd2'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 0; i <= N; i++) {
    const f = i / N
    const a = Math.PI + 2 * Math.PI * turns * (f - 1) + theta * (1 - f)
    const [x, y] = P(a, r0 + (r1 - r0) * f)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  // braket tetap ke ujung luar spiral (di bawah poros)
  const [bx, by] = P(Math.PI, r1)
  ctx.fillStyle = C.ink
  ctx.beginPath()
  ctx.arc(bx, by, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.lineTo(cx, cy + R + 50)
  ctx.stroke()
  hatchH(ctx, cx - 40, cx + 40, cy + R + 50, 1)
  // poros
  ctx.fillStyle = C.ink
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.07, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`J = ½·m·r² = ${(0.5 * p.m * 0.04).toFixed(3)} kg·m²   (r = 20 cm)`, 12, 10)
  if (p.c > 0) ctx.fillText('peredam rotasi pada poros', 12, 26)
  return { setup: 'rotasi', s: 1, anchor: 0, cx, cy, R, hit: { cx, cy, r: R } }
}

// ---- interaksi ----

export function hitTest(l: Layout, x: number, y: number): boolean {
  const pad = 10
  if ('r' in l.hit) return Math.hypot(x - l.hit.cx, y - l.hit.cy) <= l.hit.r + pad
  const r = l.hit
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad
}

/** Koordinat acuan pointer (dipakai untuk menyimpan offset saat mulai drag). */
export function pointerCoord(l: Layout, x: number, y: number): number {
  if (l.setup === 'rotasi') return Math.atan2(x - l.cx, -(y - l.cy))
  return l.setup === 'horizontal' ? x : y
}

/** q dari posisi tepi benda yang ditarik (px) — kebalikan dari rumus gambar. */
export function edgeOf(l: Layout, q: number): number {
  switch (l.setup) {
    case 'tarik':
      return l.anchor + (L0 + q) * l.s
    case 'tekan':
      return l.anchor - (L0 - q) * l.s
    case 'horizontal':
      return l.anchor + (L0 + q) * l.s
    case 'rotasi':
      return q
  }
}

export function qFromEdge(l: Layout, edge: number): number {
  switch (l.setup) {
    case 'tarik':
    case 'horizontal':
      return (edge - l.anchor) / l.s - L0
    case 'tekan':
      return L0 - (l.anchor - edge) / l.s
    case 'rotasi':
      return edge
  }
}
