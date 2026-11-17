// Gambar panggung Room Pendulum (sederhana, ganda, fisik) + hit test drag.
import { hatchH } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import { DEG, reach, type Params, type Setup } from './model'
import { rodLeq } from './physics'

type Ctx = CanvasRenderingContext2D

export interface View {
  s: number // px per meter
  py: number // y sendi (px)
}

export interface Bob {
  x: number
  y: number
  r: number
}

export interface Layout {
  setup: Setup
  px: number
  py: number
  s: number
  bobs: Bob[] // sederhana: [bob] · ganda: [bob1, bob2]
  rod?: { x1: number; y1: number; x2: number; y2: number }
}

export const bobRadius = (m: number) => 9 + 7 * Math.cbrt(m)

/** Skala & posisi sendi yang diinginkan. Ayunan besar (> 80°) atau bandul ganda → sendi di tengah agar lingkaran penuh muat. */
export function targetView(setup: Setup, w: number, h: number, p: Params, y: number[]): View {
  const R = reach(setup, p) + 0.06
  w = Math.max(w, 200)
  h = Math.max(h, 200)
  const big = setup === 'ganda' || Math.abs(y[0]) > 80 * DEG || Math.abs(p.a) > 80
  if (big) {
    const pad = 34
    return { py: h / 2, s: Math.min((h / 2 - pad) / R, (w / 2 - pad) / R) }
  }
  // bandul fisik: bagian batang di atas sendi sepanjang L/2 − d harus ikut muat
  const over = setup === 'fisik' ? Math.max(0, p.L / 2 - p.d) + 0.03 : 0
  const s = Math.min((h - 90) / (R + over), (w / 2 - 30) / R)
  return { py: 44 + over * s, s }
}

export interface DrawOpts {
  ghost: number[] | null // keadaan model pembanding (linear / kembar)
  trail: { x: number; y: number }[] // ganda: jejak massa 2 (m, relatif sendi)
  showAngles: boolean
}

const dir = (t: number) => [Math.sin(t), Math.cos(t)] as const

function support(ctx: Ctx, px: number, py: number) {
  hatchH(ctx, px - 46, px + 46, py - 8, -1)
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(px - 8, py - 8)
  ctx.lineTo(px, py)
  ctx.lineTo(px + 8, py - 8)
  ctx.stroke()
}

function pin(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function bob(ctx: Ctx, x: number, y: number, r: number, m: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  if (r > 17) {
    ctx.fillStyle = '#fff'
    ctx.font = FONT_B
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${m.toFixed(m < 10 ? 1 : 0)} kg`, x, y)
  }
}

function string(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color = C.steel) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

/** Garis vertikal acuan + busur sudut θ dari (x,y). */
function angleMark(ctx: Ctx, x: number, y: number, theta: number, len: number, label: string) {
  ctx.save()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = C.mute
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x, y + len)
  ctx.stroke()
  ctx.restore()
  const r = Math.max(4, Math.min(46, len * 0.6))
  const a0 = Math.PI / 2
  const a1 = Math.PI / 2 - theta
  if (Math.abs(theta) > 0.5 * DEG) {
    ctx.strokeStyle = C.orange
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(x, y, r, a0, a1, theta > 0)
    ctx.stroke()
  }
  const am = Math.PI / 2 - theta / 2
  const rr = r + 14
  ctx.fillStyle = C.orange
  ctx.font = FONT_B
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lx = x + Math.cos(am) * rr + (Math.abs(theta) < 12 * DEG ? (theta >= 0 ? 26 : -26) : 0)
  ctx.fillText(label, lx, y + Math.sin(am) * rr)
}

const degLabel = (name: string, t: number) => `${name} = ${(t / DEG).toFixed(1)}°`

export function drawStage(ctx: Ctx, w: number, h: number, setup: Setup, p: Params, y: number[], v: View, o: DrawOpts): Layout {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const px = Math.round(w / 2)
  const py = v.py
  const s = v.s
  if (setup === 'ganda') return drawDouble(ctx, px, py, s, p, y, o)
  if (setup === 'fisik') return drawRod(ctx, px, py, s, p, y, o)
  return drawSimple(ctx, px, py, s, p, y, o)
}

function drawSimple(ctx: Ctx, px: number, py: number, s: number, p: Params, y: number[], o: DrawOpts): Layout {
  const Lp = p.L * s
  const r = bobRadius(p.m)
  support(ctx, px, py)
  if (o.showAngles) angleMark(ctx, px, py, y[0], Lp * 0.9, degLabel('θ', y[0]))
  if (o.ghost) {
    const [gx, gy] = dir(o.ghost[0])
    ctx.globalAlpha = 0.4
    string(ctx, px, py, px + gx * Lp, py + gy * Lp, C.orange)
    bob(ctx, px + gx * Lp, py + gy * Lp, r, p.m, C.orange)
    ctx.globalAlpha = 1
  }
  const [dx, dy] = dir(y[0])
  const bx = px + dx * Lp
  const by = py + dy * Lp
  string(ctx, px, py, bx, by)
  // label panjang tali
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = dx >= 0 ? 'right' : 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`L = ${p.L.toFixed(2)} m`, (px + bx) / 2 + (dx >= 0 ? -10 : 10) * dy, (py + by) / 2)
  bob(ctx, bx, by, r, p.m, C.block)
  pin(ctx, px, py)
  return { setup: 'sederhana', px, py, s, bobs: [{ x: bx, y: by, r }] }
}

function drawDouble(ctx: Ctx, px: number, py: number, s: number, p: Params, y: number[], o: DrawOpts): Layout {
  const r1 = bobRadius(p.m)
  const r2 = bobRadius(p.m2)
  support(ctx, px, py)
  // jejak massa 2
  const tr = o.trail
  if (tr.length > 1) {
    ctx.lineWidth = 1.5
    for (let i = 1; i < tr.length; i++) {
      ctx.strokeStyle = `rgba(13, 48, 75, ${(0.5 * i) / tr.length})`
      ctx.beginPath()
      ctx.moveTo(px + tr[i - 1].x * s, py + tr[i - 1].y * s)
      ctx.lineTo(px + tr[i].x * s, py + tr[i].y * s)
      ctx.stroke()
    }
  }
  const pos = (st: number[]) => {
    const [d1x, d1y] = dir(st[0])
    const [d2x, d2y] = dir(st[1])
    const x1 = px + d1x * p.L * s
    const y1 = py + d1y * p.L * s
    return { x1, y1, x2: x1 + d2x * p.L2 * s, y2: y1 + d2y * p.L2 * s }
  }
  if (o.ghost) {
    const g = pos(o.ghost)
    ctx.globalAlpha = 0.45
    string(ctx, px, py, g.x1, g.y1, C.orange)
    string(ctx, g.x1, g.y1, g.x2, g.y2, C.orange)
    bob(ctx, g.x1, g.y1, r1, p.m, C.orange)
    bob(ctx, g.x2, g.y2, r2, p.m2, C.orange)
    ctx.globalAlpha = 1
  }
  const q = pos(y)
  if (o.showAngles) {
    angleMark(ctx, px, py, y[0], Math.min(p.L * s * 0.8, 90), degLabel('θ₁', y[0]))
    angleMark(ctx, q.x1, q.y1, y[1], Math.min(p.L2 * s * 0.8, 90), degLabel('θ₂', y[1]))
  }
  string(ctx, px, py, q.x1, q.y1)
  string(ctx, q.x1, q.y1, q.x2, q.y2)
  bob(ctx, q.x1, q.y1, r1, p.m, C.block)
  bob(ctx, q.x2, q.y2, r2, p.m2, C.navy)
  pin(ctx, px, py)
  return {
    setup: 'ganda',
    px,
    py,
    s,
    bobs: [
      { x: q.x1, y: q.y1, r: r1 },
      { x: q.x2, y: q.y2, r: r2 },
    ],
  }
}

function drawRod(ctx: Ctx, px: number, py: number, s: number, p: Params, y: number[], o: DrawOpts): Layout {
  const d = Math.min(p.d, p.L / 2)
  const top = -(p.L / 2 - d) // ujung atas (di atas sendi) dalam m sepanjang batang
  const bot = p.L / 2 + d
  const thick = Math.max(10, Math.min(20, 8 + 4 * Math.cbrt(p.m)))
  const seg = (t: number) => {
    const [dx, dy] = dir(t)
    return { x1: px + dx * top * s, y1: py + dy * top * s, x2: px + dx * bot * s, y2: py + dy * bot * s, dx, dy }
  }
  const rodLine = (g: ReturnType<typeof seg>, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = thick
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(g.x1, g.y1)
    ctx.lineTo(g.x2, g.y2)
    ctx.stroke()
    ctx.lineCap = 'butt'
  }
  support(ctx, px, py)
  if (o.showAngles) angleMark(ctx, px, py, y[0], bot * s * 0.9, degLabel('θ', y[0]))
  if (o.ghost) {
    ctx.globalAlpha = 0.4
    rodLine(seg(o.ghost[0]), C.orange)
    ctx.globalAlpha = 1
  }
  const g = seg(y[0])
  rodLine(g, C.block)
  // titik berat
  const cx = px + g.dx * d * s
  const cy = py + g.dy * d * s
  const rc = thick * 0.36
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(cx, cy, rc, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = C.ink
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, rc, -Math.PI / 2 - y[0], -y[0])
  ctx.closePath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, rc, Math.PI / 2 - y[0], Math.PI - y[0])
  ctx.closePath()
  ctx.fill()
  // pusat osilasi (panjang bandul sederhana ekivalen)
  const leq = rodLeq(p.L, d)
  const ox = px + g.dx * leq * s
  const oy = py + g.dy * leq * s
  ctx.fillStyle = C.orange
  ctx.beginPath()
  ctx.arc(ox, oy, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = FONT
  ctx.textAlign = g.dx >= 0 ? 'left' : 'right'
  ctx.textBaseline = 'middle'
  const side = g.dx >= 0 ? 1 : -1
  ctx.fillText(`pusat osilasi, Leq = ${leq.toFixed(3)} m`, ox + side * (thick / 2 + 8), oy)
  ctx.fillStyle = C.ink
  ctx.fillText(`G (d = ${d.toFixed(3)} m)`, cx + side * (thick / 2 + 8), cy)
  pin(ctx, px, py)
  return { setup: 'fisik', px, py, s, bobs: [], rod: { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 } }
}

/** Indeks benda yang kena pointer: 0/1 = massa (ganda: 1 diprioritaskan), 0 = batang. −1 bila tidak kena. */
export function hitTest(l: Layout, x: number, y: number): number {
  if (l.rod) {
    const { x1, y1, x2, y2 } = l.rod
    const vx = x2 - x1
    const vy = y2 - y1
    const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy || 1)))
    return Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)) < 16 ? 0 : -1
  }
  for (let i = l.bobs.length - 1; i >= 0; i--) {
    const b = l.bobs[i]
    if (Math.hypot(x - b.x, y - b.y) < b.r + 8) return i
  }
  return -1
}

/** Sudut (dari vertikal bawah) titik pointer relatif terhadap (ox, oy). */
export const angleFrom = (ox: number, oy: number, x: number, y: number) => Math.atan2(x - ox, y - oy)
