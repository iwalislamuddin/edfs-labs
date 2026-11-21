// Panggung Room Hydrostatic: bejana berlapis + piezometer + diagram tekanan (Tekanan), pintu bidang miring dengan prisma
// tekanan & tampak depan (Pintu Bidang), permukaan lengkung dengan badan tekanan & proyeksi tegak (Permukaan Lengkung).
import { fmt } from '../../lab/chart'
import { arrow, dimV } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import {
  arcPoint,
  curvedForce,
  gateCentroid,
  gateSolve,
  gateWidth,
  pressure,
  rhoAt,
  surfaceS,
  vesselWidth,
  wetEnd,
} from './hydro'
import { arcOf, gammaOf, gateOf, gateSystem, layers, VB, VH, type Params, type Setup } from './model'

type Ctx = CanvasRenderingContext2D

export const COL = {
  water: '#cfe5ef',
  waterEdge: '#1f6f8b',
  oil: '#f3e4b0',
  oilEdge: '#a5822a',
  merc: '#d3d6db',
  mercEdge: '#6f7680',
  gas: '#f4f2ec',
  p: '#1f6f8b',
  force: C.red,
  solid: '#dedbd1',
  solidEdge: '#9b978a',
  gate: C.navy,
  body: 'rgba(237,141,59,0.20)',
  bodyEdge: C.orange,
  cp: C.orange,
  meas: C.green,
}

export function fluidColor(rho: number): [string, string] {
  if (rho >= 5000) return [COL.merc, COL.mercEdge]
  if (rho < 960) return [COL.oil, COL.oilEdge]
  return [COL.water, COL.waterEdge]
}

export interface View {
  ox: number
  oy: number
  s: number
}
export const X = (v: View, x: number) => v.ox + x * v.s
export const Y = (v: View, z: number) => v.oy - z * v.s
export const toWorld = (v: View, px: number, py: number): [number, number] => [(px - v.ox) / v.s, (v.oy - py) / v.s]

function fit(x0: number, x1: number, z0: number, z1: number, rx: number, ry: number, w: number, h: number): View {
  const s = Math.min(w / (x1 - x0), h / (z1 - z0))
  return { s, ox: rx + (w - (x1 - x0) * s) / 2 - x0 * s, oy: ry + (h + (z1 - z0) * s) / 2 + z0 * s }
}

export interface Handle {
  id: 'probe' | 'surf' | 'iface' | 'hu' | 'hd' | 'piv' | 'H'
  x: number
  y: number
}
export interface Layout {
  view: View
  handles: Handle[]
}

function label(ctx: Ctx, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left', bold = false) {
  ctx.font = bold ? FONT_B : FONT
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  const w = ctx.measureText(text).width
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(x0 - 2, y - 8, w + 4, 16)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function handleDot(ctx: Ctx, x: number, y: number, color = C.orange) {
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, 6.5, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, 2.5, 0, 2 * Math.PI)
  ctx.fill()
}

/** Garis muka air dengan segitiga ▽. */
function surfaceMark(ctx: Ctx, x1: number, x2: number, y: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  const xm = x1 + (x2 - x1) * 0.3
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(xm - 6, y - 10)
  ctx.lineTo(xm + 6, y - 10)
  ctx.lineTo(xm, y - 1)
  ctx.closePath()
  ctx.fill()
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(xm - 4, y + 4)
  ctx.lineTo(xm + 4, y + 4)
  ctx.moveTo(xm - 2, y + 7)
  ctx.lineTo(xm + 2, y + 7)
  ctx.stroke()
}

function ground(ctx: Ctx, v: View, x1: number, x2: number, depth = 0.35) {
  ctx.fillStyle = COL.solid
  ctx.fillRect(X(v, x1), Y(v, 0), (x2 - x1) * v.s, depth * v.s)
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(X(v, x1), Y(v, 0))
  ctx.lineTo(X(v, x2), Y(v, 0))
  ctx.stroke()
  ctx.strokeStyle = COL.solidEdge
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = X(v, x1) + 6; x < X(v, x2); x += 11) {
    ctx.moveTo(x, Y(v, 0))
    ctx.lineTo(x - 8, Y(v, 0) + 9)
  }
  ctx.stroke()
}

function poly(ctx: Ctx, v: View, pts: [number, number][]) {
  ctx.beginPath()
  pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(v, x), Y(v, z)) : ctx.moveTo(X(v, x), Y(v, z))))
  ctx.closePath()
}

export interface StageState {
  setup: Setup
  p: Params
  /** waktu (s) untuk animasi kecil */
  t: number
}

export function drawStage(ctx: Ctx, w: number, h: number, S: StageState): Layout {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  if (S.setup === 'tekanan') return drawPressure(ctx, w, h, S.p)
  if (S.setup === 'pintu') return drawGate(ctx, w, h, S.p, S.t)
  return drawCurved(ctx, w, h, S.p)
}

// ======================================================================================
// Tekanan
// ======================================================================================

export function tapDepths(p: Params): number[] {
  const Ht = p.h1 + p.h2
  if (p.h1 > 1e-9) return [p.h1 * 0.5, p.h1 + p.h2 * 0.45, Ht * 0.97]
  return [Ht * 0.25, Ht * 0.6, Ht * 0.97]
}

function drawPressure(ctx: Ctx, w: number, h: number, p: Params): Layout {
  const Ls = layers(p)
  const Ht = p.h1 + p.h2
  const halfW = (z: number) => vesselWidth(p.ves, VB, VH, z) / 2
  let maxHW = 0
  for (let i = 0; i <= 60; i++) maxHW = Math.max(maxHW, halfW((VH * i) / 60))
  const p0 = p.p0 * 1e3
  const pb = pressure(p0, Ls, p.g, Ht)
  const pmax = Math.max(Math.abs(p0), Math.abs(pb), 1)
  const diagW = 2.2
  const xd = -maxHW - 0.7 // garis dasar diagram tekanan
  const xt0 = maxHW + 0.6 // tabung piezometer pertama
  const dxT = 0.6
  const v = fit(xd - diagW - 0.4, xt0 + 2 * dxT + 0.9, -0.55, VH + 1.3, 14, 30, w - 28, h - 56)

  ground(ctx, v, xd - diagW - 0.4, xt0 + 2 * dxT + 0.9)

  // isi bejana: gas (bila tertutup), lapisan fluida dari atas
  const outline = (z0: number, z1: number): [number, number][] => {
    const n = 40
    const R: [number, number][] = []
    const Lf: [number, number][] = []
    for (let i = 0; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n
      R.push([halfW(z), z])
      Lf.push([-halfW(z), z])
    }
    return [...R, ...Lf.reverse()]
  }
  const closed = Math.abs(p.p0) > 1e-6
  if (closed) {
    poly(ctx, v, outline(Ht, VH))
    ctx.fillStyle = COL.gas
    ctx.fill()
  }
  let top = Ht
  for (const L of Ls) {
    const [fill, edge] = fluidColor(L.rho)
    poly(ctx, v, outline(top - L.h, top))
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = edge
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(X(v, -halfW(top)), Y(v, top))
    ctx.lineTo(X(v, halfW(top)), Y(v, top))
    ctx.stroke()
    top -= L.h
  }
  // dinding bejana
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2.5
  for (const sgn of [-1, 1]) {
    ctx.beginPath()
    for (let i = 0; i <= 60; i++) {
      const z = (VH * i) / 60
      const x = X(v, sgn * halfW(z))
      i ? ctx.lineTo(x, Y(v, z)) : ctx.moveTo(x, Y(v, z))
    }
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(X(v, -halfW(0)), Y(v, 0))
  ctx.lineTo(X(v, halfW(0)), Y(v, 0))
  ctx.stroke()
  if (closed) {
    ctx.beginPath()
    ctx.moveTo(X(v, -halfW(VH)) - 4, Y(v, VH))
    ctx.lineTo(X(v, halfW(VH)) + 4, Y(v, VH))
    ctx.lineWidth = 4
    ctx.stroke()
    // manometer di tutup
    const gx = X(v, 0)
    const gy = Y(v, VH) - 20
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(gx, Y(v, VH))
    ctx.lineTo(gx, gy + 11)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(gx, gy, 11, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
    // jarum: −135° (p₀ = −60 kPa) … +135° (p₀ = 200 kPa) dari arah atas, searah jarum jam
    const ang = ((-135 + (270 * (p.p0 + 60)) / 260) * Math.PI) / 180
    ctx.strokeStyle = C.red
    ctx.beginPath()
    ctx.moveTo(gx, gy)
    ctx.lineTo(gx + 8 * Math.sin(ang), gy - 8 * Math.cos(ang))
    ctx.stroke()
    label(ctx, `p₀ = ${fmt(p.p0, 1)} kPa`, gx + 16, gy, C.ink, 'left', true)
  }
  surfaceMark(ctx, X(v, -halfW(Ht)) + 2, X(v, halfW(Ht)) - 2, Y(v, Ht), COL.waterEdge)

  // diagram tekanan (di kiri): panah ke kanan sepanjang tinggi, panjang ∝ p
  const k = diagW / pmax
  ctx.fillStyle = 'rgba(31,111,139,0.10)'
  ctx.beginPath()
  ctx.moveTo(X(v, xd), Y(v, Ht))
  const nD = 80
  for (let i = 0; i <= nD; i++) {
    const d = (Ht * i) / nD
    ctx.lineTo(X(v, xd - k * pressure(p0, Ls, p.g, d)), Y(v, Ht - d))
  }
  ctx.lineTo(X(v, xd), Y(v, 0))
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = COL.p
  ctx.lineWidth = 1.5
  ctx.stroke()
  for (let i = 0; i <= 8; i++) {
    const d = (Ht * i) / 8
    const pp = pressure(p0, Ls, p.g, d)
    if (Math.abs(pp) * k * v.s < 6) continue
    if (pp > 0) arrow(ctx, X(v, xd - k * pp), Y(v, Ht - d), X(v, xd), Y(v, Ht - d), COL.p, 1.3)
    else arrow(ctx, X(v, xd), Y(v, Ht - d), X(v, xd - k * pp), Y(v, Ht - d), COL.p, 1.3)
  }
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(X(v, xd), Y(v, Ht + 0.3))
  ctx.lineTo(X(v, xd), Y(v, 0))
  ctx.stroke()
  label(ctx, 'diagram p', X(v, xd - diagW / 2), Y(v, Ht + 0.55), COL.p, 'center', true)
  label(ctx, `${fmt(pb / 1e3, 1)} kPa`, X(v, xd - k * pb), Y(v, 0) - 10, COL.p, 'center')
  if (closed) label(ctx, `${fmt(p.p0, 1)}`, X(v, xd - k * p0), Y(v, Ht) - 10, COL.p, 'center')
  if (p.h1 > 1e-9) {
    const pi = pressure(p0, Ls, p.g, p.h1)
    label(ctx, `${fmt(pi / 1e3, 1)}`, X(v, xd - k * pi) - 4, Y(v, p.h2), COL.p, 'right')
  }

  // piezometer di dinding kanan
  const handles: Handle[] = []
  const zClip = VH + 1.15
  tapDepths(p).forEach((d, i) => {
    const z = Ht - d
    const rho = rhoAt(Ls, d)
    const pp = pressure(p0, Ls, p.g, d)
    const rise = pp / (rho * p.g)
    const xw = halfW(z)
    const xt = xt0 + i * dxT
    const [fill, edge] = fluidColor(rho)
    const tw = 0.13
    // pipa horizontal
    ctx.fillStyle = fill
    ctx.fillRect(X(v, xw), Y(v, z + tw / 2), (xt - xw) * v.s, tw * v.s)
    // kolom di tabung
    const zTop = Math.min(zClip, z + Math.max(0, rise))
    ctx.fillRect(X(v, xt - tw / 2), Y(v, zTop), tw * v.s, (zTop - z + tw / 2) * v.s)
    ctx.strokeStyle = C.mute
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(X(v, xw), Y(v, z + tw / 2))
    ctx.lineTo(X(v, xt - tw / 2), Y(v, z + tw / 2))
    ctx.lineTo(X(v, xt - tw / 2), Y(v, zClip))
    ctx.moveTo(X(v, xw), Y(v, z - tw / 2))
    ctx.lineTo(X(v, xt + tw / 2), Y(v, z - tw / 2))
    ctx.lineTo(X(v, xt + tw / 2), Y(v, zClip))
    ctx.stroke()
    ctx.strokeStyle = edge
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(X(v, xt - tw), Y(v, zTop))
    ctx.lineTo(X(v, xt + tw), Y(v, zTop))
    ctx.stroke()
    const txt = rise < 0 ? 'vakum' : z + rise > zClip ? `↑ ${fmt(rise, 2)} m` : `${fmt(rise, 2)} m`
    const clipped = rise > 0 && z + rise > zClip
    const ly = clipped ? Y(v, zClip) + 14 + 16 * i : Math.min(Y(v, zTop) - 12, Y(v, z) - 14) - 16 * i
    label(ctx, txt, X(v, xt) + 8, Math.max(30, ly), edge, 'left')
  })
  label(ctx, 'piezometer: naik p/(ρg)', X(v, xt0 + dxT), Y(v, zClip) - 12, C.mute, 'center')

  // probe
  const zp = Ht - p.pd
  const xp = p.px * halfW(zp) * 0.82
  const pp = pressure(p0, Ls, p.g, p.pd)
  const px = X(v, xp)
  const py = Y(v, zp)
  ctx.strokeStyle = C.orange
  ctx.setLineDash([3, 3])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(px, Y(v, Ht))
  ctx.lineTo(px, py)
  ctx.stroke()
  ctx.setLineDash([])
  handleDot(ctx, px, py)
  handles.push({ id: 'probe', x: px, y: py })
  label(ctx, 'p', px + 10, py - 8, C.ink, 'left', true)
  label(ctx, `Probe: p = ${fmt(pp / 1e3, 2)} kPa  ·  d = ${fmt(p.pd, 2)} m  ·  p/(ρg) = ${fmt(pp / (rhoAt(Ls, p.pd) * p.g), 2)} m`, 14, 16, C.ink, 'left', true)

  // pegangan muka & antarmuka
  const sx = X(v, -halfW(Ht)) + 10
  handleDot(ctx, sx, Y(v, Ht), COL.waterEdge)
  handles.push({ id: 'surf', x: sx, y: Y(v, Ht) })
  if (p.h1 > 1e-9) {
    const ix = X(v, -halfW(p.h2)) + 10
    handleDot(ctx, ix, Y(v, p.h2), COL.oilEdge)
    handles.push({ id: 'iface', x: ix, y: Y(v, p.h2) })
  }
  dimV(ctx, X(v, halfW(0)) + 14, Y(v, 0), Y(v, p.h2), `${fmt(p.h2, 2)} m`, C.mute, 1)
  if (p.h1 > 1e-9) dimV(ctx, X(v, halfW(p.h2)) + 14, Y(v, p.h2), Y(v, Ht), `${fmt(p.h1, 2)} m`, COL.oilEdge, 1)

  // gaya di dasar vs berat
  const Fb = pb * VB
  ctx.font = FONT_B
  label(ctx, `F dasar = p·A = ${fmt(Fb / 1e3, 1)} kN/m`, X(v, 0), Y(v, 0) + 22, C.ink, 'center', true)
  return { view: v, handles }
}

// ======================================================================================
// Pintu bidang
// ======================================================================================

function drawGate(ctx: Ctx, w: number, h: number, p: Params, t: number): Layout {
  const sys = gateSystem(p)
  const g = gateOf(p)
  const res = gateSolve(sys)
  const a = (p.al * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const n: [number, number] = [sa, -ca] // normal ke hilir
  const P = (s: number): [number, number] => [(g.L - s) * ca, (g.L - s) * sa]
  const zGate = g.L * sa
  const zTop = Math.max(p.hu, p.hd, zGate) + 0.9
  const Wt: [number, number] = [(zTop / sa) * ca, zTop]
  const span = Math.max(zTop, g.L)
  const xl = -Math.max(2.5, 0.45 * span)
  const xr = Math.max(Wt[0], g.L * ca) + Math.max(2.5, 0.45 * span)
  const inset = Math.min(150, w * 0.24)
  const v = fit(xl, xr, -0.9, zTop + 0.3, 14, 22, w - 28 - inset * 0.6, h - 52)
  const xlv = toWorld(v, 0, 0)[0]
  const xrv = toWorld(v, w, 0)[0]

  // air hulu & hilir
  const Q = (z: number): [number, number] => [(z / sa) * ca, z]
  ctx.fillStyle = COL.water
  if (p.hu > 0) {
    poly(ctx, v, [[xlv, 0], [0, 0], Q(p.hu), [xlv, p.hu]])
    ctx.fill()
  }
  if (p.hd > 0) {
    poly(ctx, v, [[0, 0], [xrv, 0], [xrv, p.hd], Q(p.hd)])
    ctx.fill()
  }
  ground(ctx, v, xlv, xrv)
  // dinding di atas pintu
  ctx.fillStyle = COL.solid
  const T = P(0)
  const th = 0.45
  poly(ctx, v, [T, Wt, [Wt[0] + n[0] * th, Wt[1] + n[1] * th], [T[0] + n[0] * th, T[1] + n[1] * th]])
  ctx.fill()
  ctx.strokeStyle = COL.solidEdge
  ctx.lineWidth = 1
  ctx.stroke()
  if (p.hu > 0) surfaceMark(ctx, X(v, xlv) + 8, X(v, Q(p.hu)[0]) - 2, Y(v, p.hu), COL.waterEdge)
  if (p.hd > 0) surfaceMark(ctx, X(v, Q(p.hd)[0]) + 2, X(v, xrv) - 8, Y(v, p.hd), COL.waterEdge)

  // pintu (diputar bila poros membuka)
  const sh = res.sh
  const H0 = P(sh)
  let rot = 0
  if (res.open) {
    const target = 0.16 + 0.02 * Math.sin(t * 2)
    // pilih arah: bagian atas bergerak ke hilir
    const d: [number, number] = [T[0] - H0[0], T[1] - H0[1]]
    const test = (r: number) => {
      const x = d[0] * Math.cos(r) - d[1] * Math.sin(r)
      const z = d[0] * Math.sin(r) + d[1] * Math.cos(r)
      return (x - d[0]) * n[0] + (z - d[1]) * n[1]
    }
    rot = test(target) > 0 ? target : -target
  }
  const R = (q: [number, number]): [number, number] => {
    const dx = q[0] - H0[0]
    const dz = q[1] - H0[1]
    return [H0[0] + dx * Math.cos(rot) - dz * Math.sin(rot), H0[1] + dx * Math.sin(rot) + dz * Math.cos(rot)]
  }
  const gp = (s: number) => R(P(s))

  // prisma tekanan
  const gamma = gammaOf(p)
  const pMaxUp = gamma * Math.max(0, p.hu)
  const kP = (0.28 * span) / Math.max(pMaxUp, gamma * p.hd, 1) // m per Pa
  const prism = (sw: number, side: -1 | 1, color: string) => {
    const s0 = Math.max(0, sw)
    if (s0 >= g.L) return
    const pts: [number, number][] = []
    const N = 40
    for (let i = 0; i <= N; i++) {
      const s = s0 + ((g.L - s0) * i) / N
      const pp = gamma * (s - sw) * sa
      const b = gp(s)
      pts.push([b[0] - side * n[0] * kP * pp, b[1] - side * n[1] * kP * pp])
    }
    ctx.fillStyle = side > 0 ? 'rgba(31,111,139,0.12)' : 'rgba(91,100,112,0.12)'
    poly(ctx, v, [gp(s0), ...pts, gp(g.L)])
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.2
    ctx.beginPath()
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(v, x), Y(v, z)) : ctx.moveTo(X(v, x), Y(v, z))))
    ctx.stroke()
    for (let i = 1; i <= 7; i++) {
      const s = s0 + ((g.L - s0) * i) / 7.5
      const pp = gamma * (s - sw) * sa
      if (pp * kP * v.s < 8) continue
      const b = gp(s)
      arrow(ctx, X(v, b[0] - side * n[0] * kP * pp), Y(v, b[1] - side * n[1] * kP * pp), X(v, b[0]), Y(v, b[1]), color, 1.1)
    }
  }
  const sw1 = surfaceS(g, p.hu)
  const sw2 = surfaceS(g, p.hd)
  if (p.hu > 0) prism(sw1, 1, COL.p)
  if (p.hd > 0) prism(sw2, -1, C.steel)

  // daun pintu
  const A0 = gp(0)
  const A1 = gp(g.L)
  ctx.strokeStyle = COL.gate
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(X(v, A0[0]), Y(v, A0[1]))
  ctx.lineTo(X(v, A1[0]), Y(v, A1[1]))
  ctx.stroke()
  ctx.lineCap = 'butt'

  // tumpuan penahan (stop) di sisi hilir
  const Sp = P(res.sP)
  ctx.fillStyle = C.block
  const st: [number, number][] = [
    [Sp[0] + n[0] * 0.08, Sp[1] + n[1] * 0.08],
    [Sp[0] + n[0] * 0.38 + ca * 0.18, Sp[1] + n[1] * 0.38 + sa * 0.18],
    [Sp[0] + n[0] * 0.38 - ca * 0.18, Sp[1] + n[1] * 0.38 - sa * 0.18],
  ]
  poly(ctx, v, st)
  ctx.fill()
  // engsel/poros
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(X(v, H0[0]), Y(v, H0[1]), 6, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = C.ink
  ctx.beginPath()
  ctx.arc(X(v, H0[0]), Y(v, H0[1]), 2, 0, 2 * Math.PI)
  ctx.fill()

  // gaya resultan
  const Fmax = Math.max(res.up.F, res.down.F, Math.abs(res.P), sys.W, 1)
  const len = (F: number) => 26 + 70 * (Math.abs(F) / Fmax)
  const forceArrow = (s: number, F: number, side: -1 | 1, color: string, text: string) => {
    if (Math.abs(F) < 1e-6) return
    const b = gp(s)
    const bx = X(v, b[0])
    const by = Y(v, b[1])
    const l = len(F)
    // dalam piksel: n_px = (n0, −n1)
    const ux = side * n[0]
    const uy = -side * n[1]
    arrow(ctx, bx - ux * l, by - uy * l, bx, by, color, 3)
    label(ctx, text, bx - ux * (l + 6), by - uy * (l + 6) - 10, color, ux > 0 ? 'right' : 'left', true)
  }
  if (res.up.F > 0) forceArrow(res.up.sp, res.up.F, 1, COL.force, `F = ${fmt(res.up.F / 1e3, 1)} kN`)
  if (res.down.F > 0) forceArrow(res.down.sp, res.down.F, -1, C.steel, `F₂ = ${fmt(res.down.F / 1e3, 1)} kN`)
  if (!res.open && Math.abs(res.P) > 1e-6) {
    const b = gp(res.sP)
    const bx = X(v, b[0])
    const by = Y(v, b[1])
    const l = len(res.P)
    const sgn = res.P > 0 ? -1 : 1 // P > 0: tumpuan mendorong ke hulu (−n)
    const ux = sgn * n[0]
    const uy = -sgn * n[1]
    arrow(ctx, bx - ux * l, by - uy * l, bx, by, C.green, 3)
    label(ctx, `P = ${fmt(res.P / 1e3, 1)} kN`, bx - ux * (l + 6), by - uy * (l + 6) + 10, C.green, ux > 0 ? 'right' : 'left', true)
  }
  if (sys.W > 0) {
    const sc = gateCentroid(g).s
    const b = gp(sc)
    const l = len(sys.W)
    arrow(ctx, X(v, b[0]), Y(v, b[1]), X(v, b[0]), Y(v, b[1]) + l, C.ink, 2.5)
    label(ctx, `W = ${fmt(p.W, 0)} kN`, X(v, b[0]) + 6, Y(v, b[1]) + l, C.ink, 'left')
  }
  // penanda CP pada pintu
  if (res.up.F > 0) {
    const b = gp(res.up.sp)
    ctx.fillStyle = COL.cp
    ctx.beginPath()
    ctx.arc(X(v, b[0]), Y(v, b[1]), 4, 0, 2 * Math.PI)
    ctx.fill()
  }

  if (res.open) {
    label(ctx, w < 560 ? 'PINTU TERBUKA' : 'PINTU TERBUKA — pusat tekanan di atas poros', 14, 16, C.red, 'left', true)
  }

  // ukuran muka air
  const handles: Handle[] = []
  const xhu = X(v, xlv) + 22
  if (p.hu > 0) dimV(ctx, xhu, Y(v, 0), Y(v, p.hu), `h₁ = ${fmt(p.hu, 2)} m`, COL.waterEdge, 1)
  handleDot(ctx, xhu, Y(v, p.hu), COL.waterEdge)
  handles.push({ id: 'hu', x: xhu, y: Y(v, p.hu) })
  const xhd = X(v, xrv) - 22 - inset * 0.6
  if (p.hd > 0) dimV(ctx, xhd, Y(v, 0), Y(v, p.hd), `h₂ = ${fmt(p.hd, 2)} m`, C.steel, -1)
  handleDot(ctx, xhd, Y(v, p.hd), C.steel)
  handles.push({ id: 'hd', x: xhd, y: Y(v, p.hd) })
  if (p.hinge === 'poros') handles.push({ id: 'piv', x: X(v, H0[0]), y: Y(v, H0[1]) })
  label(ctx, `α = ${fmt(p.al, 0)}°`, X(v, 0) + 30, Y(v, 0) - 12, C.mute, 'left')

  // tampak depan (kanan atas)
  const ix = w - inset - 12
  const iy = 12
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.strokeStyle = C.line
  ctx.lineWidth = 1
  ctx.fillRect(ix, iy, inset, inset + 22)
  ctx.strokeRect(ix, iy, inset, inset + 22)
  label(ctx, inset < 130 ? 'Tampak depan' : 'Tampak depan pintu', ix + 6, iy + 10, C.mute, 'left')
  const bmax = g.shape === 'lingkaran' ? g.L : g.b
  const sc2 = (inset - 30) / Math.max(g.L, bmax)
  const cx = ix + inset / 2
  const cy = iy + 24 + (inset - 30 - g.L * sc2) / 2
  const N = 60
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i <= N; i++) {
    const s = (g.L * i) / N
    const half = gateWidth(g, s) / 2
    right.push([cx + half * sc2, cy + s * sc2])
    left.push([cx - half * sc2, cy + s * sc2])
  }
  const shape = [...right, ...left.reverse()]
  ctx.beginPath()
  shape.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.fillStyle = '#e6e9ee'
  ctx.fill()
  if (res.up.A > 0) {
    ctx.save()
    ctx.clip()
    const yw = cy + Math.max(0, sw1) * sc2
    ctx.fillStyle = COL.water
    ctx.fillRect(ix, yw, inset, inset)
    ctx.restore()
  }
  ctx.beginPath()
  shape.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
  ctx.strokeStyle = COL.gate
  ctx.lineWidth = 1.5
  ctx.stroke()
  if (sw1 > 0 && sw1 < g.L) {
    ctx.strokeStyle = COL.waterEdge
    ctx.beginPath()
    ctx.moveTo(ix + 4, cy + sw1 * sc2)
    ctx.lineTo(ix + inset - 4, cy + sw1 * sc2)
    ctx.stroke()
  }
  if (res.up.A > 0) {
    const yG = cy + res.up.sc * sc2
    const yP = cy + res.up.sp * sc2
    ctx.fillStyle = C.ink
    ctx.beginPath()
    ctx.arc(cx, yG, 3.5, 0, 2 * Math.PI)
    ctx.fill()
    ctx.fillStyle = COL.cp
    ctx.beginPath()
    ctx.arc(cx, yP, 3.5, 0, 2 * Math.PI)
    ctx.fill()
    ctx.font = FONT
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = C.ink
    ctx.fillText('G', cx + 6, yG - 3)
    ctx.fillStyle = COL.cp
    ctx.fillText('CP', cx + 6, yP + 6)
  }
  if (p.hinge === 'poros') {
    const yv = cy + p.piv * g.L * sc2
    ctx.strokeStyle = C.ink
    ctx.setLineDash([3, 2])
    ctx.beginPath()
    ctx.moveTo(ix + 4, yv)
    ctx.lineTo(ix + inset - 4, yv)
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.font = FONT
  ctx.fillStyle = C.mute
  ctx.textAlign = 'left'
  ctx.fillText(`L = ${fmt(g.L, 2)} m${g.shape !== 'lingkaran' && inset >= 130 ? ` · b = ${fmt(g.b, 2)} m` : ''}`, ix + 6, iy + inset + 14)
  return { view: v, handles }
}

// ======================================================================================
// Permukaan lengkung
// ======================================================================================

export function curvedGeom(p: Params) {
  const { arc, wallX } = arcOf(p)
  const pts: [number, number][] = []
  const N = 90
  for (let i = 0; i <= N; i++) pts.push(arcPoint(arc, arc.p0 + ((arc.p1 - arc.p0) * i) / N))
  const top = pts[pts.length - 1][1]
  return { arc, wallX, pts, top }
}

function drawCurved(ctx: Ctx, w: number, h: number, p: Params): Layout {
  const { arc, wallX, pts } = curvedGeom(p)
  const gamma = gammaOf(p)
  const f = curvedForce(arc, gamma, p.bw, p.H)
  const xsA = pts.map((q) => q[0])
  const xminA = Math.min(...xsA, arc.cx)
  const xmaxA = Math.max(...xsA, arc.cx, wallX ?? -1e9)
  const zTop = Math.max(p.H, pts[pts.length - 1][1], arc.cz) + 1
  const span = Math.max(zTop, p.R)
  const pMax = gamma * p.H
  const kP = (0.26 * span) / Math.max(pMax, 1)
  const xProj = xmaxA + 0.6 + kP * pMax + 0.4
  const xl = xminA - Math.max(2.5, 0.55 * span)
  const xr = xProj + 1.2
  const v = fit(xl, xr, -0.5, zTop + 0.2, 14, 26, w - 28, h - 50)
  const xlv = toWorld(v, 0, 0)[0]
  const xrv = toWorld(v, w, 0)[0]

  // batas basah: lantai → busur → dinding; air di kiri, z ≤ H
  const boundary: [number, number][] = [...pts]
  if (wallX !== null) boundary.push([wallX, zTop])
  const water: [number, number][] = [[xlv, 0]]
  for (let i = 0; i < boundary.length; i++) {
    const q = boundary[i]
    if (q[1] <= p.H) {
      water.push(q)
      continue
    }
    const prev = boundary[i - 1]
    const tt = (p.H - prev[1]) / (q[1] - prev[1])
    water.push([prev[0] + (q[0] - prev[0]) * tt, p.H])
    break
  }
  water.push([xlv, p.H])
  ctx.fillStyle = COL.water
  poly(ctx, v, water)
  ctx.fill()
  ground(ctx, v, xlv, xrv)

  const pe = wetEnd(arc, p.H)
  // struktur
  if (wallX !== null) {
    const right = Math.max(xmaxA, 0) + 0.8
    const solid: [number, number][] = [...pts, [wallX, zTop], [right, zTop], [right, 0]]
    poly(ctx, v, solid)
    ctx.fillStyle = COL.solid
    ctx.fill()
    ctx.strokeStyle = COL.solidEdge
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(X(v, wallX), Y(v, pts[pts.length - 1][1]))
    ctx.lineTo(X(v, wallX), Y(v, zTop))
    ctx.stroke()
  } else {
    // pintu radial: lengan ke poros + tumpuan poros
    ctx.strokeStyle = C.steel
    ctx.lineWidth = 2.5
    ctx.beginPath()
    for (const q of [pts[0], pts[pts.length - 1]]) {
      ctx.moveTo(X(v, arc.cx), Y(v, arc.cz))
      ctx.lineTo(X(v, q[0]), Y(v, q[1]))
    }
    ctx.stroke()
    ctx.fillStyle = C.block
    ctx.beginPath()
    ctx.moveTo(X(v, arc.cx), Y(v, arc.cz))
    ctx.lineTo(X(v, arc.cx) + 12, Y(v, arc.cz) + 18)
    ctx.lineTo(X(v, arc.cx) - 12, Y(v, arc.cz) + 18)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = COL.solid
    ctx.fillRect(X(v, arc.cx) - 8, Y(v, arc.cz) + 18, 16, Math.max(0, Y(v, 0) - Y(v, arc.cz) - 18))
  }
  // badan tekanan
  if (f && pe !== null) {
    const body: [number, number][] = []
    const N = 60
    for (let i = 0; i <= N; i++) body.push(arcPoint(arc, arc.p0 + ((pe - arc.p0) * i) / N))
    const e = body[body.length - 1]
    const s0 = body[0]
    body.push([e[0], p.H], [s0[0], p.H])
    poly(ctx, v, body)
    ctx.fillStyle = COL.body
    ctx.fill()
    ctx.strokeStyle = COL.bodyEdge
    ctx.setLineDash([5, 3])
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.strokeStyle = COL.gate
  ctx.lineWidth = 5
  ctx.beginPath()
  pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(v, x), Y(v, z)) : ctx.moveTo(X(v, x), Y(v, z))))
  ctx.stroke()
  // pusat busur
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(X(v, arc.cx), Y(v, arc.cz), 4.5, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
  label(ctx, 'O', X(v, arc.cx) + 8, Y(v, arc.cz) - 8, C.ink, 'left', true)

  surfaceMark(ctx, X(v, xlv) + 8, X(v, water[water.length - 2][0]) - 2, Y(v, p.H), COL.waterEdge)
  const handles: Handle[] = []
  const xh = X(v, xlv) + 22
  dimV(ctx, xh, Y(v, 0), Y(v, p.H), `H = ${fmt(p.H, 2)} m`, COL.waterEdge, 1)
  handleDot(ctx, xh, Y(v, p.H), COL.waterEdge)
  handles.push({ id: 'H', x: xh, y: Y(v, p.H) })

  if (!f || pe === null) {
    label(ctx, 'Muka air di bawah permukaan lengkung', w / 2, 20, C.mute, 'center', true)
    return { view: v, handles }
  }
  const dir = Math.sign(arc.p1 - arc.p0)
  // panah tekanan normal
  for (let i = 0; i <= 12; i++) {
    const phi = arc.p0 + ((pe - arc.p0) * (i + 0.5)) / 13
    const [x, z] = arcPoint(arc, phi)
    const pp = gamma * (p.H - z)
    const fx = dir * Math.cos(phi)
    const fz = dir * Math.sin(phi)
    if (pp * kP * v.s < 7) continue
    arrow(ctx, X(v, x - fx * kP * pp), Y(v, z - fz * kP * pp), X(v, x), Y(v, z), COL.p, 1.1)
  }
  // proyeksi tegak untuk FH
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(X(v, xProj), Y(v, f.zLo))
  ctx.lineTo(X(v, xProj), Y(v, f.zHi))
  ctx.stroke()
  const sx = Math.sign(f.Fx) || 1
  ctx.fillStyle = 'rgba(31,111,139,0.12)'
  ctx.beginPath()
  ctx.moveTo(X(v, xProj), Y(v, f.zHi))
  ctx.lineTo(X(v, xProj - sx * kP * gamma * (p.H - f.zHi)), Y(v, f.zHi))
  ctx.lineTo(X(v, xProj - sx * kP * gamma * (p.H - f.zLo)), Y(v, f.zLo))
  ctx.lineTo(X(v, xProj), Y(v, f.zLo))
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = COL.p
  ctx.lineWidth = 1
  ctx.stroke()
  for (let i = 0; i <= 5; i++) {
    const z = f.zLo + ((f.zHi - f.zLo) * i) / 5
    const pp = gamma * (p.H - z)
    if (pp * kP * v.s < 7) continue
    arrow(ctx, X(v, xProj - sx * kP * pp), Y(v, z), X(v, xProj), Y(v, z), COL.p, 1)
  }
  label(ctx, 'proyeksi tegak', X(v, xProj), Y(v, f.zHi) - 12, C.mute, 'center')
  const Fh = Math.abs(f.Fx)
  const Fv = Math.abs(f.Fz)
  const Fm = Math.max(Fh, Fv, 1)
  const L = (F: number) => 24 + 64 * (F / Fm)
  const zFH = p.H - f.hFH
  arrow(ctx, X(v, xProj) - sx * (L(Fh) + 4), Y(v, zFH), X(v, xProj) - sx * 4, Y(v, zFH), COL.force, 3)
  label(ctx, `FH = ${fmt(Fh / 1e3, 1)} kN`, X(v, xProj) + 8, Y(v, zFH), COL.force, 'left', true)
  // FV pada garis kerja titik berat badan tekanan
  const up = f.Fz > 0
  const zMid = (p.H + (f.zLo + f.zHi) / 2) / 2
  const lv = L(Fv)
  const yv0 = Y(v, zMid) + (up ? lv / 2 : -lv / 2)
  arrow(ctx, X(v, f.xFV), yv0, X(v, f.xFV), yv0 + (up ? -lv : lv), COL.force, 3)
  label(ctx, `FV = ${fmt(Fv / 1e3, 1)} kN ${up ? '↑' : '↓'}`, X(v, f.xFV) + 8, yv0 + (up ? -lv : lv), COL.force, 'left', true)
  // resultan lewat pusat O
  const Fr = Math.hypot(f.Fx, f.Fz)
  if (Fr > 0) {
    const ux = f.Fx / Fr
    const uz = f.Fz / Fr
    const q: [number, number] = [arc.cx + dir * ux * arc.R, arc.cz + dir * uz * arc.R]
    ctx.strokeStyle = COL.force
    ctx.setLineDash([6, 4])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(X(v, q[0] - ux * 0.25 * span), Y(v, q[1] - uz * 0.25 * span))
    ctx.lineTo(X(v, arc.cx + ux * 0.15 * span), Y(v, arc.cz + uz * 0.15 * span))
    ctx.stroke()
    ctx.setLineDash([])
    const l = 80
    arrow(ctx, X(v, q[0]) - ux * l, Y(v, q[1]) + uz * l, X(v, q[0]), Y(v, q[1]), '#7a1f12', 3.5)
    label(ctx, `R = ${fmt(Fr / 1e3, 1)} kN`, X(v, q[0]) - ux * (l + 8), Y(v, q[1]) + uz * (l + 8) - 10, '#7a1f12', 'right', true)
  }
  label(ctx, up ? 'badan tekanan khayal (air di bawah permukaan)' : 'badan tekanan (air di atas permukaan)', X(v, xlv) + 40, Y(v, zTop) + 14, COL.bodyEdge, 'left')
  return { view: v, handles }
}
