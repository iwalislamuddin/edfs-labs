// Panggung Room Section: penampang + sumbu (Properti), peta tegangan normal + garis netral + inti (Tegangan Normal),
// potongan Q dan diagram τ(y) (Tegangan Geser).
import { arrow, dimH, dimV } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import type { Params, Setup } from './model'
import { extremes, hull, kern, Q, resultantPoint, shearProfile, stressPlane, tauAt, width, type Part, type Props } from './section'

type Ctx = CanvasRenderingContext2D
const RAD = Math.PI / 180

export const COL = {
  mat: '#e3e7da',
  edge: C.green,
  axis: C.navy,
  principal: C.orange,
  u: '#661465',
  tension: C.navy,
  compression: C.red,
  shear: C.green,
  cut: C.orange,
  plastic: C.mute,
}
const TINTS = ['#dbe4cf', '#ecdfc8', '#d4e0e8', '#e8d6e4']

export function fmt(v: number, d = 1) {
  if (!Number.isFinite(v)) return '∞'
  if (Math.abs(v) < 0.5 * 10 ** -d) return '0'
  const s = Math.abs(v).toFixed(d)
  return v < 0 ? `−${s}` : s
}

export interface View {
  ox: number
  oy: number
  s: number
}
const X = (v: View, x: number) => v.ox + x * v.s
const Y = (v: View, y: number) => v.oy - y * v.s

export interface Layout {
  view: View
  w: number
  h: number
  /** pegangan sumbu u (Properti) dan titik tangkap N (Tegangan Normal), px */
  handle: [number, number] | null
  centroid: [number, number]
}

export interface StageState {
  setup: Setup
  p: Params
  parts: Part[]
  pr: Props
  yp: number // garis netral plastis
}

function fitView(pr: Props, x0: number, y0: number, w: number, h: number): View {
  const bw = pr.xmax - pr.xmin
  const bh = pr.ymax - pr.ymin
  const s = Math.min(w / bw, h / bh)
  return { s, ox: x0 + (w - bw * s) / 2 - pr.xmin * s, oy: y0 + (h + bh * s) / 2 + pr.ymin * s }
}

function partPath(ctx: Ctx, v: View, p: Part) {
  ctx.beginPath()
  if (p.kind === 'rect') ctx.rect(X(v, p.x - p.w / 2), Y(v, p.y + p.h / 2), p.w * v.s, p.h * v.s)
  else ctx.arc(X(v, p.x), Y(v, p.y), p.r * v.s, 0, 2 * Math.PI)
}

/** Path seluruh material (lubang dengan aturan evenodd). */
function sectionPath(v: View, parts: Part[]) {
  const path = new Path2D()
  for (const p of parts) {
    if (p.kind === 'rect') path.rect(X(v, p.x - p.w / 2), Y(v, p.y + p.h / 2), p.w * v.s, p.h * v.s)
    else {
      path.moveTo(X(v, p.x) + p.r * v.s, Y(v, p.y))
      path.arc(X(v, p.x), Y(v, p.y), p.r * v.s, 0, 2 * Math.PI, p.sign < 0)
    }
  }
  return path
}

function fillSection(ctx: Ctx, v: View, parts: Part[], fill: string | CanvasGradient, perPart = false) {
  const path = sectionPath(v, parts)
  ctx.save()
  if (perPart) {
    let k = 0
    for (const p of parts) {
      if (p.sign < 0) continue
      partPath(ctx, v, p)
      ctx.fillStyle = TINTS[k++ % TINTS.length]
      ctx.fill()
    }
    for (const p of parts) {
      if (p.sign > 0) continue
      partPath(ctx, v, p)
      ctx.fillStyle = C.bg
      ctx.fill()
    }
  } else {
    ctx.fillStyle = fill
    ctx.fill(path, 'evenodd')
  }
  ctx.strokeStyle = COL.edge
  ctx.lineWidth = 1.5
  // garis luar tiap bagian (garis sambung antar bagian ikut terlihat — sesuai pembagian tabel Steiner)
  ctx.stroke(path)
  ctx.restore()
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

function centroidMark(ctx: Ctx, x: number, y: number) {
  const r = 6
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(x, y, r, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = C.ink
  for (const a of [0, Math.PI]) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.arc(x, y, r, a - Math.PI / 2, a)
    ctx.closePath()
    ctx.fill()
  }
}

/** Garis melalui (x, y) px dengan arah sudut a (rad, layar), dipotong panjang L ke dua arah. */
function axisLine(ctx: Ctx, x: number, y: number, a: number, L: number, color: string, dash: number[], text?: string, width = 1.2) {
  const dx = Math.cos(a) * L
  const dy = Math.sin(a) * L
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.moveTo(x - dx, y - dy)
  ctx.lineTo(x + dx, y + dy)
  ctx.stroke()
  ctx.restore()
  if (text) label(ctx, text, x + dx + Math.cos(a) * 4, y + dy + Math.sin(a) * 4 - 10, color, dx < -1 ? 'right' : 'left', true)
}

// ---------- Properti ----------

function drawProps(ctx: Ctx, w: number, h: number, st: StageState): Layout {
  const { pr, parts, p } = st
  const v = fitView(pr, 70, 36, w - 160, h - 96)
  fillSection(ctx, v, parts, COL.mat, true)
  const cx = X(v, pr.xc)
  const cy = Y(v, pr.yc)
  const ext = Math.max(pr.xmax - pr.xmin, pr.ymax - pr.ymin) * v.s * 0.62 + 24

  // titik berat tiap bagian (yang dipakai tabel Steiner)
  ctx.fillStyle = C.mute
  parts.forEach((q, k) => {
    ctx.beginPath()
    ctx.arc(X(v, q.x), Y(v, q.y), 2.5, 0, 2 * Math.PI)
    ctx.fill()
    if (parts.length > 1 && (q.kind === 'rect' ? Math.min(q.w, q.h) : q.r) * v.s > 14)
      label(ctx, String(k + 1), X(v, q.x) + 5, Y(v, q.y) - 8, C.mute)
  })

  // sumbu berat x̄, ȳ
  axisLine(ctx, cx, cy, 0, ext, COL.axis, [6, 4], 'x')
  axisLine(ctx, cx, cy, -Math.PI / 2, ext * 0.85, COL.axis, [6, 4], 'y')

  // garis netral plastis
  const ypS = Y(v, st.yp)
  if (Math.abs(ypS - cy) > 2) {
    ctx.save()
    ctx.strokeStyle = COL.plastic
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(X(v, pr.xmin) - 14, ypS)
    ctx.lineTo(X(v, pr.xmax) + 14, ypS)
    ctx.stroke()
    ctx.restore()
    label(ctx, 'GN plastis', X(v, pr.xmin) - 16, ypS, COL.plastic, 'right')
  }

  // elips inersia (Culmann): setengah sumbu searah sumbu 1 = √(I2/A), searah sumbu 2 = √(I1/A)
  const a1 = -pr.thP * RAD
  ctx.save()
  ctx.strokeStyle = C.greenSoft
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.ellipse(cx, cy, Math.sqrt(pr.I2 / pr.A) * v.s, Math.sqrt(pr.I1 / pr.A) * v.s, a1, 0, 2 * Math.PI)
  ctx.stroke()
  ctx.restore()

  // sumbu utama bila berbeda dari x–y
  if (Math.abs(pr.thP) > 0.05 && Math.abs(Math.abs(pr.thP) - 90) > 0.05) {
    axisLine(ctx, cx, cy, a1, ext * 0.92, COL.principal, [], '1', 1.6)
    axisLine(ctx, cx, cy, a1 - Math.PI / 2, ext * 0.75, COL.principal, [], '2', 1.6)
  }

  // sumbu u yang bisa diputar
  const au = -p.th * RAD
  const L = ext * 0.8
  axisLine(ctx, cx, cy, au, L, COL.u, [], undefined, 2)
  axisLine(ctx, cx, cy, au - Math.PI / 2, L * 0.55, COL.u, [1, 3])
  const hx = cx + Math.cos(au) * L
  const hy = cy + Math.sin(au) * L
  ctx.fillStyle = COL.u
  ctx.beginPath()
  ctx.arc(hx, hy, 7, 0, 2 * Math.PI)
  ctx.fill()
  label(ctx, 'u', hx + 10, hy - 10, COL.u, 'left', true)
  label(ctx, 'v', cx + Math.cos(au - Math.PI / 2) * L * 0.55 + 6, cy + Math.sin(au - Math.PI / 2) * L * 0.55 - 6, COL.u, 'left', true)

  centroidMark(ctx, cx, cy)

  // ukuran
  const bx0 = X(v, pr.xmin)
  const bx1 = X(v, pr.xmax)
  const by0 = Y(v, pr.ymin)
  const by1 = Y(v, pr.ymax)
  dimH(ctx, bx0, bx1, by0 + 14, `${fmt(pr.xmax - pr.xmin, 0)} mm`, C.mute)
  dimV(ctx, bx0 - 16, by1, by0, `${fmt(pr.ymax - pr.ymin, 0)}`, C.mute, -1)
  dimV(ctx, bx1 + 18, cy, by0, `ȳ = ${fmt(pr.yc - pr.ymin)}`, COL.axis, 1)
  if (Math.abs(pr.xc - (pr.xmin + pr.xmax) / 2) > 0.5) dimH(ctx, bx0, cx, by1 - 22, `x̄ = ${fmt(pr.xc - pr.xmin)}`, COL.axis)

  return { view: v, w, h, handle: [hx, hy], centroid: [cx, cy] }
}

// ---------- Tegangan normal ----------

const mix = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `rgb(${pa.map((x, i) => Math.round(x + (pb[i] - x) * t)).join(',')})`
}
/** Warna tegangan: tekan merah, tarik biru tua, nol putih. u ∈ [−1, 1]. */
export const stressColor = (u: number) => (u >= 0 ? mix('#ffffff', COL.tension, Math.min(1, u) * 0.85) : mix('#ffffff', COL.compression, Math.min(1, -u) * 0.85))

function drawNormal(ctx: Ctx, w: number, h: number, st: StageState): Layout {
  const { pr, parts, p } = st
  const v = fitView(pr, 60, 40, w - 190, h - 90)
  const pl = stressPlane(pr, p.N, p.Mx, p.My)
  const hl = hull(parts)
  const ex = extremes(pl, pr, hl)
  const S = Math.max(Math.abs(ex.max.s), Math.abs(ex.min.s), 1e-9)
  const cx = X(v, pr.xc)
  const cy = Y(v, pr.yc)

  // isi gradien linear: σ linear di bidang → gradien canvas tepat sama
  const ga = pl.a / v.s
  const gb = -pl.b / v.s // per px layar (y layar ke bawah)
  const g2 = ga * ga + gb * gb
  let fill: string | CanvasGradient
  if (g2 < 1e-18) fill = stressColor(pl.s0 / S)
  else {
    // titik layar di mana σ = −S dan +S
    const at = (s: number): [number, number] => [cx + ((s - pl.s0) * ga) / g2, cy + ((s - pl.s0) * gb) / g2]
    const [x0, y0] = at(-S)
    const [x1, y1] = at(S)
    const gr = ctx.createLinearGradient(x0, y0, x1, y1)
    for (let k = 0; k <= 10; k++) gr.addColorStop(k / 10, stressColor(-1 + k / 5))
    fill = gr
  }
  fillSection(ctx, v, parts, fill)

  const ext = Math.max(pr.xmax - pr.xmin, pr.ymax - pr.ymin) * v.s * 0.75 + 30
  axisLine(ctx, cx, cy, 0, ext * 0.8, COL.axis, [2, 4])
  axisLine(ctx, cx, cy, -Math.PI / 2, ext * 0.8, COL.axis, [2, 4])

  // garis netral σ = 0
  if (g2 > 1e-18) {
    const nx = cx - (pl.s0 * ga) / g2
    const ny = cy - (pl.s0 * gb) / g2
    const a = Math.atan2(ga, -gb)
    ctx.save()
    ctx.beginPath()
    ctx.rect(X(v, pr.xmin) - 40, Y(v, pr.ymax) - 30, (pr.xmax - pr.xmin) * v.s + 80, (pr.ymax - pr.ymin) * v.s + 60)
    ctx.clip()
    axisLine(ctx, nx, ny, a, 3 * ext, C.ink, [8, 4], undefined, 1.8)
    ctx.restore()
    // label di ujung yang terlihat
    const d = Math.hypot(nx - cx, ny - cy)
    if (d < ext * 1.4) {
      const lx = nx + Math.cos(a) * Math.min(ext * 0.55, 140)
      const ly = ny + Math.sin(a) * Math.min(ext * 0.55, 140)
      label(ctx, 'garis netral', lx + 6, ly - 12, C.ink, 'left', true)
    }
  }

  // inti penampang
  if (p.kern) {
    const k = kern(pr, hl)
    if (k.length > 2) {
      ctx.beginPath()
      k.forEach(([x, y], i) => (i ? ctx.lineTo(X(v, x), Y(v, y)) : ctx.moveTo(X(v, x), Y(v, y))))
      ctx.closePath()
      ctx.fillStyle = 'rgba(237,141,59,0.18)'
      ctx.fill()
      ctx.strokeStyle = C.orange
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }

  centroidMark(ctx, cx, cy)

  // titik ekstrem
  const ptLabel = (e: { s: number; x: number; y: number }, name: string) => {
    const px = X(v, e.x)
    const py = Y(v, e.y)
    ctx.fillStyle = e.s >= 0 ? COL.tension : COL.compression
    ctx.beginPath()
    ctx.arc(px, py, 4, 0, 2 * Math.PI)
    ctx.fill()
    const right = e.x > pr.xc
    const up = e.y > pr.yc
    label(ctx, `${name} ${fmt(e.s)} MPa`, px + (right ? 8 : -8), py + (up ? -12 : 12), ctx.fillStyle as string, right ? 'left' : 'right', true)
  }
  if (Math.abs(ex.max.s - ex.min.s) > 1e-6) {
    ptLabel(ex.max, 'σmaks')
    ptLabel(ex.min, 'σmin')
  } else label(ctx, `σ = ${fmt(pl.s0)} MPa (merata)`, cx, Y(v, pr.ymax) - 16, C.ink, 'center', true)

  // titik tangkap N
  let handle: [number, number] | null = null
  const rp = resultantPoint(pr, p.N, p.Mx, p.My)
  if (rp) {
    const px = X(v, rp.x)
    const py = Y(v, rp.y)
    const inView = px > 0 && px < w - 120 && py > 0 && py < h
    if (inView) {
      handle = [px, py]
      const col = p.N < 0 ? COL.compression : COL.tension
      ctx.strokeStyle = col
      ctx.lineWidth = 2
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(px, py, 8, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(px - 5, py - 5)
      ctx.lineTo(px + 5, py + 5)
      ctx.moveTo(px + 5, py - 5)
      ctx.lineTo(px - 5, py + 5)
      ctx.stroke()
      label(ctx, `N ${p.N < 0 ? 'tekan' : 'tarik'}`, px + 12, py + 12, col, 'left', true)
      if (Math.hypot(px - cx, py - cy) > 14) {
        ctx.save()
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = col
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(px, py)
        ctx.stroke()
        ctx.restore()
      }
    } else label(ctx, 'titik tangkap N di luar gambar (e besar)', 12, 16, C.mute)
  }

  colorBar(ctx, w - 70, 40, h - 110, S)
  return { view: v, w, h, handle, centroid: [cx, cy] }
}

function colorBar(ctx: Ctx, x: number, y: number, hh: number, S: number) {
  const gr = ctx.createLinearGradient(0, y, 0, y + hh)
  for (let k = 0; k <= 10; k++) gr.addColorStop(k / 10, stressColor(1 - k / 5))
  ctx.fillStyle = gr
  ctx.fillRect(x, y, 14, hh)
  ctx.strokeStyle = C.line
  ctx.strokeRect(x, y, 14, hh)
  ctx.font = FONT
  ctx.fillStyle = C.ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`+${fmt(S)}`, x + 18, y)
  ctx.fillText('0', x + 18, y + hh / 2)
  ctx.fillText(`−${fmt(S)}`, x + 18, y + hh)
  ctx.fillStyle = C.mute
  ctx.fillText('MPa', x + 18, y + hh + 16)
  ctx.save()
  ctx.translate(x - 8, y + hh / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillText('tekan  ←  σ  →  tarik', 0, 0)
  ctx.restore()
}

// ---------- Tegangan geser ----------

function drawShear(ctx: Ctx, w: number, h: number, st: StageState): Layout {
  const { pr, parts, p } = st
  const secW = w * 0.5
  const v = fitView(pr, 50, 40, secW - 70, h - 90)
  fillSection(ctx, v, parts, COL.mat)
  const cx = X(v, pr.xc)
  const cy = Y(v, pr.yc)
  const yCut = pr.ymin + p.cut * (pr.ymax - pr.ymin)
  const yc = Y(v, yCut)
  const top = Y(v, pr.ymax)
  const bot = Y(v, pr.ymin)

  // luas di atas potongan (yang dipakai Q)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, secW, yc)
  ctx.clip()
  ctx.fillStyle = 'rgba(237,141,59,0.35)'
  ctx.fill(sectionPath(v, parts), 'evenodd')
  ctx.restore()
  ctx.strokeStyle = COL.edge
  ctx.lineWidth = 1.5
  ctx.stroke(sectionPath(v, parts))

  // titik berat luas di atas potongan
  const q = Q(parts, pr, yCut)
  if (q.Aab > 1e-6) {
    const yb = pr.yc + q.Qx / q.Aab
    const xb = pr.xc + q.Qy / q.Aab
    ctx.fillStyle = C.orange
    ctx.beginPath()
    ctx.arc(X(v, xb), Y(v, yb), 4, 0, 2 * Math.PI)
    ctx.fill()
    if (Math.abs(Y(v, yb) - cy) > 18) dimV(ctx, X(v, pr.xmin) - 14, Y(v, yb), cy, 'ȳ′', C.orange, -1)
  }

  axisLine(ctx, cx, cy, 0, (pr.xmax - pr.xmin) * v.s * 0.5 + 24, COL.axis, [6, 4], 'GN')
  centroidMark(ctx, cx, cy)

  // diagram τ(y)
  const V = p.V * 1e3
  const prof = shearProfile(parts, pr, V)
  const tmax = Math.max(...prof.map((x) => Math.abs(x.tau)), 1e-12)
  const x0 = secW + 30
  const span = w - x0 - 120
  const ts = span / tmax
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x0, top - 10)
  ctx.lineTo(x0, bot + 10)
  ctx.stroke()
  const sgn = V >= 0 ? 1 : -1
  ctx.beginPath()
  ctx.moveTo(x0, Y(v, prof[0].y))
  for (const pt of prof) ctx.lineTo(x0 + sgn * pt.tau * ts, Y(v, pt.y))
  ctx.lineTo(x0, Y(v, prof[prof.length - 1].y))
  ctx.closePath()
  ctx.fillStyle = 'rgba(86,100,73,0.22)'
  ctx.fill()
  ctx.strokeStyle = COL.shear
  ctx.lineWidth = 2
  ctx.stroke()
  // garis bantu horizontal dari penampang ke diagram
  ctx.save()
  ctx.strokeStyle = C.line
  ctx.setLineDash([2, 3])
  ctx.beginPath()
  for (const yy of [top, bot, cy]) {
    ctx.moveTo(X(v, pr.xmax) + 4, yy)
    ctx.lineTo(x0, yy)
  }
  ctx.stroke()
  ctx.restore()

  // τ rata-rata V/A
  const tavg = Math.abs(V) / pr.A
  if (Math.abs(V) > 0) {
    const xa = x0 + tavg * ts
    ctx.save()
    ctx.strokeStyle = C.mute
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(xa, top - 10)
    ctx.lineTo(xa, bot + 10)
    ctx.stroke()
    ctx.restore()
    label(ctx, `V/A = ${fmt(tavg, 2)}`, xa + 4, bot + 22, C.mute)
    // τ maks
    const im = prof.reduce((bi, pt, i) => (Math.abs(pt.tau) > Math.abs(prof[bi].tau) ? i : bi), 0)
    const pm = prof[im]
    const tl = `τmaks = ${fmt(Math.abs(pm.tau), 2)} MPa`
    const xm = x0 + Math.abs(pm.tau) * ts
    ctx.font = FONT_B
    const fits = xm + 6 + ctx.measureText(tl).width < w - 4
    label(ctx, tl, fits ? xm + 6 : xm - 6, Y(v, pm.y) - 12, COL.shear, fits ? 'left' : 'right', true)
  }
  label(ctx, 'τ(y)', x0 + 4, top - 22, C.ink, 'left', true)

  // potongan
  const tc = tauAt(parts, pr, V, yCut)
  ctx.save()
  ctx.strokeStyle = COL.cut
  ctx.lineWidth = 2
  ctx.setLineDash([7, 4])
  ctx.beginPath()
  ctx.moveTo(X(v, pr.xmin) - 20, yc)
  ctx.lineTo(x0 + Math.abs(tc) * ts, yc)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = COL.cut
  ctx.beginPath()
  ctx.arc(x0 + Math.abs(tc) * ts, yc, 4.5, 0, 2 * Math.PI)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(X(v, pr.xmin) - 20, yc, 7, 0, 2 * Math.PI)
  ctx.fill()
  label(ctx, `b = ${fmt(width(parts, yCut))} mm · τ = ${fmt(Math.abs(tc), 2)} MPa`, X(v, pr.xmin) - 30, yc - 14, COL.cut, 'left', true)

  // panah V
  if (Math.abs(V) > 0) {
    const ax = X(v, pr.xmax) + 26
    arrow(ctx, ax, cy - sgn * 30, ax, cy + sgn * 30, C.ink, 2)
    label(ctx, `V = ${fmt(Math.abs(p.V), 0)} kN`, ax + 6, cy - sgn * 36, C.ink)
  }
  return { view: v, w, h, handle: [X(v, pr.xmin) - 20, yc], centroid: [cx, cy] }
}

export function drawStage(ctx: Ctx, w: number, h: number, st: StageState): Layout {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  if (st.setup === 'properti') return drawProps(ctx, w, h, st)
  if (st.setup === 'lentur') return drawNormal(ctx, w, h, st)
  return drawShear(ctx, w, h, st)
}

/** Koordinat penampang (mm) dari px. */
export function toWorld(l: Layout, x: number, y: number): [number, number] {
  return [(x - l.view.ox) / l.view.s, (l.view.oy - y) / l.view.s]
}
