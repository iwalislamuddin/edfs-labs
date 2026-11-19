// Panggung Room Element: elemen (diputar / terdeformasi / kubus 3D) di kiri, lingkaran Mohr di kanan; grafik σ(θ) terpisah.
import { arrow } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import { hooke, principal, principal3, transform, transformStrain, type Stress } from './mohr'
import type { Params, Setup } from './model'

type Ctx = CanvasRenderingContext2D
const RAD = Math.PI / 180

export const COL = {
  tension: C.navy,
  compression: C.red,
  shear: C.green,
  rot: C.orange,
  zone: '#661465',
}

export function fmt(v: number, d = 1) {
  if (Math.abs(v) < 0.5 * 10 ** -d) return '0'
  const s = Math.abs(v).toFixed(d)
  return v < 0 ? `−${s}` : s
}

/** Skala Mohr yang dihaluskan: pusat σ dan setengah lebar (dalam satuan tampilan). */
export interface MohrView {
  c: number
  ext: number
}

export interface Layout {
  el: { cx: number; cy: number; r: number }
  mohr: { x0: number; y0: number; x1: number; y1: number; px: (v: number) => number; py: (t: number) => number; C: number; R: number; phi0: number }
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface StageState {
  setup: Setup
  p: Params
  /** Lingkaran Mohr dari keadaan tak terputar (tegangan MPa, atau regangan µε dengan "τ" = γ/2). */
  base: Stress
  view: MohrView
}

/** Keadaan yang digambar di Mohr (satuan tampilan). */
export function mohrState(setup: Setup, p: Params): Stress {
  if (setup !== 'regangan') return { sx: p.sx, sy: p.sy, txy: p.txy }
  const e = hooke({ sx: p.sx, sy: p.sy, txy: p.txy }, p.E, p.nu)
  return { sx: e.ex * 1e6, sy: e.ey * 1e6, txy: (e.gxy / 2) * 1e6 }
}

/** Rentang σ yang harus muat di panggung Mohr. */
export function mohrTarget(setup: Setup, p: Params): MohrView {
  const s = mohrState(setup, p)
  const pr = principal(s)
  let lo = Math.min(0, pr.s2)
  let hi = Math.max(0, pr.s1)
  if (setup === 'tiga') {
    lo = Math.min(lo, p.sz)
    hi = Math.max(hi, p.sz)
  }
  const ext = Math.max((hi - lo) / 2, setup === 'regangan' ? 50 : 10)
  return { c: (lo + hi) / 2, ext }
}

export function stepView(v: MohrView | null, t: MohrView): MohrView {
  if (!v) return t
  // membesar seketika, mengecil perlahan → lingkaran tampak tumbuh saat nilai naik
  const ext = t.ext > v.ext ? t.ext : v.ext + (t.ext - v.ext) * 0.03
  return { c: v.c + (t.c - v.c) * 0.25, ext }
}

export function drawStage(ctx: Ctx, w: number, h: number, st: StageState): Layout {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const stacked = w < 560
  const elBox: Box = stacked ? { x0: 0, y0: 0, x1: w, y1: h * 0.48 } : { x0: 0, y0: 0, x1: w * 0.44, y1: h }
  const moBox: Box = stacked ? { x0: 0, y0: h * 0.48, x1: w, y1: h } : { x0: w * 0.44, y0: 0, x1: w, y1: h }

  // garis pemisah
  ctx.strokeStyle = C.line
  ctx.lineWidth = 1
  ctx.beginPath()
  if (stacked) {
    ctx.moveTo(12, moBox.y0)
    ctx.lineTo(w - 12, moBox.y0)
  } else {
    ctx.moveTo(moBox.x0, 12)
    ctx.lineTo(moBox.x0, h - 12)
  }
  ctx.stroke()

  const cx = (elBox.x0 + elBox.x1) / 2
  const cy = (elBox.y0 + elBox.y1) / 2 + (stacked ? 4 : 0)
  const size = Math.min(elBox.x1 - elBox.x0, elBox.y1 - elBox.y0)
  if (st.setup === 'tiga') drawCube(ctx, cx, cy, size * 0.3, st.p)
  else if (st.setup === 'regangan') drawStrainElement(ctx, cx, cy, size * 0.36, st.p)
  else drawStressElement(ctx, cx, cy, size * 0.32, st.p)

  const mohr = drawMohr(ctx, moBox, st)
  return { el: { cx, cy, r: size * 0.5 }, mohr }
}

// ---------- utilitas geometri (koordinat matematis: y ke atas) ----------

type V2 = [number, number]
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]]
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k]

function label(ctx: Ctx, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'center', bold = false) {
  ctx.font = bold ? FONT_B : FONT
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  const m = ctx.measureText(text).width
  const x0 = align === 'center' ? x - m / 2 : align === 'right' ? x - m : x
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(x0 - 2, y - 8, m + 4, 16)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function axes(ctx: Ctx, cx: number, cy: number, len: number, th: number) {
  const S = (p: V2): V2 => [cx + p[0], cy - p[1]]
  ctx.save()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = C.mute
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - len, cy)
  ctx.lineTo(cx + len, cy)
  ctx.moveTo(cx, cy + len)
  ctx.lineTo(cx, cy - len)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('x', cx + len + 4, cy)
  ctx.textAlign = 'center'
  ctx.fillText('y', cx, cy - len - 8)
  if (Math.abs(th) < 1e-9) return
  const e1: V2 = [Math.cos(th * RAD), Math.sin(th * RAD)]
  const e2: V2 = [-e1[1], e1[0]]
  ctx.strokeStyle = COL.rot
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(...S(mul(e1, -len)))
  ctx.lineTo(...S(mul(e1, len)))
  ctx.moveTo(...S(mul(e2, -len)))
  ctx.lineTo(...S(mul(e2, len)))
  ctx.stroke()
  ctx.fillStyle = COL.rot
  const tx = S(mul(e1, len + 10))
  const ty = S(mul(e2, len + 10))
  ctx.fillText('x′', tx[0], tx[1])
  ctx.fillText('y′', ty[0], ty[1])
  // busur θ
  const r = len * 0.55
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, -th * RAD, th > 0)
  ctx.stroke()
  const mid = S(mul([Math.cos((th / 2) * RAD), Math.sin((th / 2) * RAD)], r + 12))
  label(ctx, `θ = ${fmt(th)}°`, mid[0] + 14, mid[1], COL.rot)
}

// ---------- elemen tegangan diputar ----------

function drawStressElement(ctx: Ctx, cx: number, cy: number, a: number, p: Params) {
  const th = p.th
  const s = transform({ sx: p.sx, sy: p.sy, txy: p.txy }, th)
  const pr = principal({ sx: p.sx, sy: p.sy, txy: p.txy })
  const vmax = Math.max(Math.abs(pr.s1), Math.abs(pr.s2), pr.R, 1)
  const S = (q: V2): V2 => [cx + q[0], cy - q[1]]
  const e1: V2 = [Math.cos(th * RAD), Math.sin(th * RAD)]
  const e2: V2 = [-e1[1], e1[0]]

  axes(ctx, cx, cy, a * 1.45, th)

  // elemen asal (bayangan) dan elemen diputar
  ctx.strokeStyle = C.line
  ctx.lineWidth = 1
  ctx.strokeRect(cx - a / 2, cy - a / 2, a, a)
  const corners = [
    add(mul(e1, a / 2), mul(e2, a / 2)),
    add(mul(e1, -a / 2), mul(e2, a / 2)),
    add(mul(e1, -a / 2), mul(e2, -a / 2)),
    add(mul(e1, a / 2), mul(e2, -a / 2)),
  ].map(S)
  ctx.beginPath()
  corners.forEach((c, i) => (i ? ctx.lineTo(...c) : ctx.moveTo(...c)))
  ctx.closePath()
  ctx.fillStyle = 'rgba(102, 20, 101, 0.07)'
  ctx.fill()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.stroke()

  const len = (v: number) => 12 + 0.55 * a * (Math.abs(v) / vmax)
  const gap = 6
  // tegangan normal pada keempat muka
  const normal = (n: V2, v: number, tag: string | null) => {
    if (Math.abs(v) < 0.05) return
    const L = len(v)
    const f = mul(n, a / 2 + gap)
    const tip = add(f, mul(n, L))
    const [p0, p1] = v > 0 ? [f, tip] : [tip, add(f, mul(n, 2))]
    const col = v > 0 ? COL.tension : COL.compression
    arrow(ctx, ...S(p0), ...S(p1), col, 2.5)
    if (tag) {
      const lp = S(add(tip, mul(n, 16)))
      label(ctx, `${tag} = ${fmt(v)}`, lp[0], lp[1], col, 'center', true)
    }
  }
  normal(e1, s.sx, 'σx′')
  normal(mul(e1, -1), s.sx, null)
  normal(e2, s.sy, 'σy′')
  normal(mul(e2, -1), s.sy, null)

  // tegangan geser: muka +x′ arah +y′, muka +y′ arah +x′ (dan kebalikannya di muka seberang)
  if (Math.abs(s.txy) >= 0.05) {
    const half = Math.min(a * 0.42, 8 + 0.4 * a * (Math.abs(s.txy) / vmax))
    const sg = Math.sign(s.txy)
    const shear = (n: V2, t: V2) => {
      const c = mul(n, a / 2 + 5)
      arrow(ctx, ...S(add(c, mul(t, -half * sg))), ...S(add(c, mul(t, half * sg))), COL.shear, 2)
    }
    shear(e1, e2)
    shear(mul(e1, -1), mul(e2, -1))
    shear(e2, e1)
    shear(mul(e2, -1), mul(e1, -1))
    const lp = S(add(mul(e1, a / 2 + 18), mul(e2, (half + 12) * sg)))
    label(ctx, `τ = ${fmt(s.txy)}`, lp[0], lp[1], COL.shear, 'left', true)
  }
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('MPa · tarik +', 12, 10)
}

// ---------- elemen regangan (terdeformasi) ----------

function drawStrainElement(ctx: Ctx, cx: number, cy: number, a: number, p: Params) {
  const th = p.th
  const e = hooke({ sx: p.sx, sy: p.sy, txy: p.txy }, p.E, p.nu)
  const S = (q: V2): V2 => [cx + q[0], cy - q[1]]
  const e1: V2 = [Math.cos(th * RAD), Math.sin(th * RAD)]
  const e2: V2 = [-e1[1], e1[0]]
  const k = p.k
  // u = ε·x (tanpa rotasi kaku)
  const def = (q: V2): V2 => [q[0] + k * (e.ex * q[0] + (e.gxy / 2) * q[1]), q[1] + k * ((e.gxy / 2) * q[0] + e.ey * q[1])]

  axes(ctx, cx, cy, a * 1.3, th)

  // arah utama
  const pr = principal({ sx: p.sx, sy: p.sy, txy: p.txy })
  if (pr.R > 1e-6) {
    ctx.save()
    ctx.setLineDash([2, 4])
    ctx.strokeStyle = COL.zone
    ctx.lineWidth = 1
    for (const ang of [pr.thetaP, pr.thetaP + 90]) {
      const u: V2 = [Math.cos(ang * RAD), Math.sin(ang * RAD)]
      ctx.beginPath()
      ctx.moveTo(...S(mul(u, -a * 1.1)))
      ctx.lineTo(...S(mul(u, a * 1.1)))
      ctx.stroke()
    }
    ctx.restore()
    const u = S(mul([Math.cos(pr.thetaP * RAD), Math.sin(pr.thetaP * RAD)], a * 1.1 + 10))
    label(ctx, '1', u[0], u[1], COL.zone, 'center', true)
  }

  const sq = (f: (q: V2) => V2) =>
    [
      add(mul(e1, a / 2), mul(e2, a / 2)),
      add(mul(e1, -a / 2), mul(e2, a / 2)),
      add(mul(e1, -a / 2), mul(e2, -a / 2)),
      add(mul(e1, a / 2), mul(e2, -a / 2)),
    ].map((q) => S(f(q)))
  const path = (pts: V2[]) => {
    ctx.beginPath()
    pts.forEach((c, i) => (i ? ctx.lineTo(...c) : ctx.moveTo(...c)))
    ctx.closePath()
  }
  // asal (putus-putus) lalu terdeformasi
  ctx.save()
  ctx.setLineDash([5, 4])
  path(sq((q) => q))
  ctx.strokeStyle = C.mute
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.restore()
  path(sq(def))
  ctx.fillStyle = 'rgba(102, 20, 101, 0.08)'
  ctx.fill()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.stroke()

  // strain gauge sepanjang x′
  const g0 = def(mul(e1, -a * 0.28))
  const g1 = def(mul(e1, a * 0.28))
  const gl = Math.hypot(g1[0] - g0[0], g1[1] - g0[1])
  const gu: V2 = [(g1[0] - g0[0]) / gl, (g1[1] - g0[1]) / gl]
  const gn: V2 = [-gu[1], gu[0]]
  ctx.strokeStyle = COL.rot
  ctx.lineWidth = 1.5
  ctx.beginPath()
  const n = 9
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const base = add(g0, mul(gu, gl * t))
    const side = i % 2 ? 7 : -7
    const q = S(add(base, mul(gn, side)))
    if (i) ctx.lineTo(...q)
    else ctx.moveTo(...q)
  }
  ctx.stroke()
  const eth = transformStrain(e, th).ex
  const lp = S(add(g1, add(mul(gu, 8), mul(gn, 18))))
  label(ctx, `εx′ = ${fmt(eth * 1e6, 0)} µε`, lp[0], lp[1], COL.rot, 'left', true)

  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`deformasi diperbesar ${p.k}×`, 12, 10)
}

// ---------- kubus 3D sederhana ----------

function drawCube(ctx: Ctx, cx: number, cy: number, a: number, p: Params) {
  const d: V2 = [a * 0.5, -a * 0.38] // arah kedalaman di layar (ke belakang = kanan atas)
  const x0 = cx - a / 2 - d[0] / 2
  const y0 = cy + a / 2 - d[1] / 2
  const F = (x: number, y: number, z: number): V2 => [x0 + x * a + (1 - z) * d[0], y0 - y * a + (1 - z) * d[1]]
  // z = 1 adalah muka depan (menghadap pembaca), z = 0 belakang
  const poly = (pts: V2[], fill: string) => {
    ctx.beginPath()
    pts.forEach((c, i) => (i ? ctx.lineTo(...c) : ctx.moveTo(...c)))
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.8
    ctx.stroke()
  }
  poly([F(1, 0, 1), F(1, 0, 0), F(1, 1, 0), F(1, 1, 1)], 'rgba(102, 20, 101, 0.10)') // muka +x
  poly([F(0, 1, 1), F(1, 1, 1), F(1, 1, 0), F(0, 1, 0)], 'rgba(102, 20, 101, 0.05)') // muka +y
  poly([F(0, 0, 1), F(1, 0, 1), F(1, 1, 1), F(0, 1, 1)], 'rgba(102, 20, 101, 0.03)') // muka +z (depan)

  const vmax = Math.max(Math.abs(p.sx), Math.abs(p.sy), Math.abs(p.sz), Math.abs(p.txy), 1)
  const L = (v: number) => 12 + 0.5 * a * (Math.abs(v) / vmax)
  const normal = (c: V2, u: V2, v: number, tag: string) => {
    if (Math.abs(v) < 0.05) return
    const f = add(c, mul(u, 6))
    const tip = add(f, mul(u, L(v)))
    const col = v > 0 ? COL.tension : COL.compression
    if (v > 0) arrow(ctx, ...f, ...tip, col)
    else arrow(ctx, ...tip, ...add(f, mul(u, 2)), col)
    const lp = add(tip, mul(u, 18))
    label(ctx, `${tag} = ${fmt(v)}`, lp[0], lp[1], col, 'center', true)
  }
  const dz = Math.hypot(...d)
  normal(F(1, 0.5, 0.5), [1, 0], p.sx, 'σx')
  normal(F(0.5, 1, 0.5), [0, -1], p.sy, 'σy')
  normal(F(0.5, 0.5, 1), [-d[0] / dz, -d[1] / dz], p.sz, 'σz')
  if (Math.abs(p.txy) >= 0.05) {
    const sg = Math.sign(p.txy)
    const half = Math.min(a * 0.38, 8 + 0.35 * a * (Math.abs(p.txy) / vmax))
    const c1 = add(F(1, 0.5, 0.5), [4, 0]) // muka +x, arah +y (layar ke atas)
    arrow(ctx, c1[0], c1[1] + half * sg, c1[0], c1[1] - half * sg, COL.shear, 2)
    const c2 = add(F(0.5, 1, 0.5), [0, -4]) // muka +y, arah +x
    arrow(ctx, c2[0] - half * sg, c2[1], c2[0] + half * sg, c2[1], COL.shear, 2)
    label(ctx, `τxy = ${fmt(p.txy)}`, c1[0] + 10, c1[1] + (half + 12) * sg, COL.shear, 'left', true)
  }
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('MPa · τxz = τyz = 0 → σz tegangan utama', 12, 10)
}

// ---------- lingkaran Mohr ----------

function drawMohr(ctx: Ctx, b: Box, st: StageState): Layout['mohr'] {
  const { setup, p, view } = st
  const strain = setup === 'regangan'
  const s = st.base
  const pr = principal(s)
  const pad = 34
  const bw = b.x1 - b.x0 - 2 * pad
  const bh = b.y1 - b.y0 - 2 * pad
  const sc = Math.min(bw / (2 * view.ext), bh / (2 * view.ext))
  const mx = (b.x0 + b.x1) / 2
  const my = (b.y0 + b.y1) / 2
  const px = (v: number) => mx + (v - view.c) * sc
  const py = (t: number) => my + t * sc // τ positif ke bawah
  const u = strain ? 'µε' : ''
  const dec = strain ? 0 : 1
  const sym = strain ? ['ε', 'γ/2'] : ['σ', 'τ']

  // sumbu
  ctx.strokeStyle = C.mute
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(b.x0 + 12, py(0))
  ctx.lineTo(b.x1 - 12, py(0))
  ctx.moveTo(px(0), b.y0 + 14)
  ctx.lineTo(px(0), b.y1 - 12)
  ctx.stroke()
  ctx.fillStyle = C.mute
  ctx.font = FONT_B
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`${sym[0]} ${u}`.trim(), b.x1 - 12, py(0) - 4)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`${sym[1]} (+ ke bawah)`, px(0) + 5, b.y1 - 26)
  ctx.font = FONT
  ctx.fillText(strain ? 'Lingkaran Mohr regangan' : 'Lingkaran Mohr', b.x0 + 12, b.y0 + 10)

  const circle = (c: number, r: number) => {
    ctx.beginPath()
    ctx.arc(px(c), py(0), Math.max(r * sc, 0.5), 0, Math.PI * 2)
  }

  if (setup === 'tiga') {
    const [a1, a2, a3] = principal3(s, p.sz)
    circle((a1 + a3) / 2, (a1 - a3) / 2)
    ctx.fillStyle = 'rgba(102, 20, 101, 0.12)'
    ctx.fill()
    for (const [c, r] of [
      [(a1 + a2) / 2, (a1 - a2) / 2],
      [(a2 + a3) / 2, (a2 - a3) / 2],
    ]) {
      circle(c, r)
      ctx.fillStyle = C.bg
      ctx.fill()
    }
    ctx.strokeStyle = COL.zone
    ctx.lineWidth = 1.5
    for (const [c, r] of [
      [(a1 + a3) / 2, (a1 - a3) / 2],
      [(a1 + a2) / 2, (a1 - a2) / 2],
      [(a2 + a3) / 2, (a2 - a3) / 2],
    ]) {
      circle(c, r)
      ctx.stroke()
    }
    // titik utama
    ;[a1, a2, a3].forEach((v, i) => {
      dot(ctx, px(v), py(0), COL.zone, 4)
      label(ctx, `σ${i + 1} = ${fmt(v)}`, px(v), py(0) + 16 + (i % 2) * 14, COL.zone, 'center', true)
    })
    const tm = (a1 - a3) / 2
    dot(ctx, px((a1 + a3) / 2), py(-tm), COL.zone, 4)
    label(ctx, `τmaks mutlak = ${fmt(tm)}`, px((a1 + a3) / 2), py(-tm) - 13, COL.zone, 'center', true)
    // titik X dan Y bidang xy
    markXY(ctx, s, px, py, '', 1, false)
    return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, px, py, C: pr.C, R: pr.R, phi0: Math.atan2(s.txy, (s.sx - s.sy) / 2) }
  }

  // lingkaran 2D
  circle(pr.C, pr.R)
  ctx.fillStyle = 'rgba(102, 20, 101, 0.06)'
  ctx.fill()
  ctx.strokeStyle = COL.zone
  ctx.lineWidth = 1.8
  ctx.stroke()
  dot(ctx, px(pr.C), py(0), C.mute, 3)
  label(ctx, `C = ${fmt(pr.C, dec)}`, px(pr.C), py(0) - 12, C.mute)

  // titik utama & geser maks
  if (pr.R > 1e-9) {
    dot(ctx, px(pr.s1), py(0), COL.zone, 4)
    dot(ctx, px(pr.s2), py(0), COL.zone, 4)
    label(ctx, `${sym[0]}1 = ${fmt(pr.s1, dec)}`, px(pr.s1) + 6, py(0) + 14, COL.zone, 'left', true)
    label(ctx, `${sym[0]}2 = ${fmt(pr.s2, dec)}`, px(pr.s2) - 6, py(0) + 14, COL.zone, 'right', true)
    dot(ctx, px(pr.C), py(-pr.R), COL.zone, 3)
    label(ctx, `R = ${fmt(pr.R, dec)}`, px(pr.C), py(-pr.R) - 12, COL.zone)
  }

  // titik X, Y asli lalu X′, Y′ diputar
  markXY(ctx, s, px, py, '', dec, false)
  const r = transform(s, p.th)
  if (Math.abs(p.th) > 1e-9 && pr.R > 1e-9) {
    // busur 2θ dari X ke X′
    const a0 = Math.atan2(py(s.txy) - py(0), px(s.sx) - px(pr.C))
    const a1 = a0 - 2 * p.th * RAD
    ctx.strokeStyle = COL.rot
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(px(pr.C), py(0), pr.R * sc * 0.35, a0, a1, p.th > 0)
    ctx.stroke()
    const am = (a0 + a1) / 2
    label(ctx, `2θ`, px(pr.C) + Math.cos(am) * (pr.R * sc * 0.35 + 14), py(0) + Math.sin(am) * (pr.R * sc * 0.35 + 14), COL.rot)
    markXY(ctx, r, px, py, '′', dec, true)
  }
  return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, px, py, C: pr.C, R: pr.R, phi0: Math.atan2(s.txy, (s.sx - s.sy) / 2) }
}

function dot(ctx: Ctx, x: number, y: number, col: string, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = col
  ctx.fill()
}

function markXY(ctx: Ctx, s: Stress, px: (v: number) => number, py: (t: number) => number, prime: string, dec: number, rot: boolean) {
  const X: V2 = [px(s.sx), py(s.txy)]
  const Y: V2 = [px(s.sy), py(-s.txy)]
  const col = rot ? COL.rot : C.ink
  ctx.strokeStyle = col
  ctx.lineWidth = rot ? 2 : 1
  if (!rot) ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(...X)
  ctx.lineTo(...Y)
  ctx.stroke()
  ctx.setLineDash([])
  dot(ctx, X[0], X[1], col, rot ? 6 : 4)
  dot(ctx, Y[0], Y[1], col, rot ? 4.5 : 3.5)
  if (rot) {
    ctx.beginPath()
    ctx.arc(X[0], X[1], 10, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(237, 141, 59, 0.45)'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  const side = (v: number) => (v >= 0 ? 1 : -1)
  label(ctx, `X${prime} (${fmt(s.sx, dec)}, ${fmt(s.txy, dec)})`, X[0], X[1] + side(X[1] - py(0)) * 18, col, 'center', rot)
  label(ctx, `Y${prime}`, Y[0], Y[1] + side(Y[1] - py(0)) * 16, col, 'center', rot)
}

// ---------- grafik terhadap θ ----------

export function drawCurves(ctx: Ctx, w: number, h: number, setup: Setup, p: Params) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const strain = setup === 'regangan'
  const s = mohrStateLocal(setup, p)
  const pr = principal(s)
  const L = 52
  const R = 14
  const T = 12
  const B = 28
  const pw = w - L - R
  const ph = h - T - B
  const ymax = Math.max(Math.abs(pr.s1), Math.abs(pr.s2), pr.R, strain ? 50 : 10) * 1.12
  const X = (th: number) => L + ((th + 90) / 180) * pw
  const Y = (v: number) => T + ph / 2 - (v / ymax) * (ph / 2)

  // grid
  ctx.strokeStyle = C.grid
  ctx.lineWidth = 1
  ctx.font = FONT
  ctx.fillStyle = C.mute
  for (let th = -90; th <= 90; th += 45) {
    ctx.beginPath()
    ctx.moveTo(X(th), T)
    ctx.lineTo(X(th), T + ph)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${th}°`, X(th), T + ph + 6)
  }
  const step = niceStep(ymax / 2)
  for (let v = -Math.floor(ymax / step) * step; v <= ymax; v += step) {
    ctx.strokeStyle = Math.abs(v) < 1e-9 ? C.mute : C.grid
    ctx.beginPath()
    ctx.moveTo(L, Y(v))
    ctx.lineTo(L + pw, Y(v))
    ctx.stroke()
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(fmt(v, step < 1 ? 1 : 0), L - 6, Y(v))
  }
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText('θ', L + pw, T + ph + 6)

  const series: [string, string, (th: number) => number, number[]][] = [
    [strain ? 'εx′' : 'σx′', COL.tension, (th) => transform(s, th).sx, []],
    [strain ? 'εy′' : 'σy′', C.steel, (th) => transform(s, th).sy, [6, 4]],
    [strain ? 'γx′y′/2' : 'τx′y′', COL.shear, (th) => transform(s, th).txy, []],
  ]
  for (const [, col, f, dash] of series) {
    ctx.save()
    ctx.setLineDash(dash)
    ctx.strokeStyle = col
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i <= 180; i++) {
      const th = -90 + i
      const x = X(th)
      const y = Y(f(th))
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
  }
  // penanda bidang utama dan geser maks
  if (pr.R > 1e-9) {
    for (const [th, v, tag] of [
      [pr.thetaP, pr.s1, 'θp'],
      [pr.thetaS, transform(s, pr.thetaS).txy, 'θs'],
    ] as [number, number, string][]) {
      ctx.save()
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = COL.zone
      ctx.beginPath()
      ctx.moveTo(X(th), T)
      ctx.lineTo(X(th), T + ph)
      ctx.stroke()
      ctx.restore()
      dot(ctx, X(th), Y(v), COL.zone, 3.5)
      label(ctx, `${tag} = ${fmt(th)}°`, X(th), T + 8, COL.zone)
    }
  }
  // θ sekarang
  if (setup !== 'tiga') {
    ctx.strokeStyle = COL.rot
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(X(p.th), T)
    ctx.lineTo(X(p.th), T + ph)
    ctx.stroke()
    for (const [, col, f] of series) dot(ctx, X(p.th), Y(f(p.th)), col, 4)
  }
  // legenda
  let lx = L + 8
  const ly = T + ph - 10
  ctx.font = FONT
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (const [name, col, , dash] of series) {
    ctx.save()
    ctx.setLineDash(dash)
    ctx.strokeStyle = col
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(lx, ly)
    ctx.lineTo(lx + 18, ly)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = C.ink
    ctx.fillText(name, lx + 22, ly)
    lx += 30 + ctx.measureText(name).width + 10
  }
  ctx.fillStyle = C.mute
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(strain ? 'µε' : 'MPa', 6, T)
}

const mohrStateLocal = mohrState

function niceStep(x: number) {
  const e = 10 ** Math.floor(Math.log10(Math.max(x, 1e-9)))
  const f = x / e
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e
}

// ---------- interaksi ----------

/** 'el' = di area elemen, 'mohr' = dekat lingkaran Mohr, null = lainnya. */
export function hitZone(l: Layout, x: number, y: number): 'el' | 'mohr' | null {
  if (Math.hypot(x - l.el.cx, y - l.el.cy) < l.el.r) return 'el'
  const m = l.mohr
  if (x > m.x0 && x < m.x1 && y > m.y0 && y < m.y1) {
    const d = Math.hypot(x - m.px(m.C), y - m.py(0))
    const rp = Math.abs(m.px(m.C + m.R) - m.px(m.C))
    if (rp > 8 && Math.abs(d - rp) < 22) return 'mohr'
  }
  return null
}

/** Sudut layar titik terhadap pusat elemen / pusat Mohr (radian, y layar ke bawah). */
export function screenAngle(l: Layout, zone: 'el' | 'mohr', x: number, y: number) {
  if (zone === 'el') return Math.atan2(y - l.el.cy, x - l.el.cx)
  return Math.atan2(y - l.mohr.py(0), x - l.mohr.px(l.mohr.C))
}
