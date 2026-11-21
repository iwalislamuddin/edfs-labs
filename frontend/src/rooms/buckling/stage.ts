// Panggung Room Buckling: kolom tegak dengan tumpuan, beban P, bentuk mode / lendutan / elastica, diagram momen,
// dan sisipan penampang dengan sumbu tekuk.
import { arrow, dimH, dimV, hatchH } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import { inflections, modeShape, shapeAt, support, type Imperfect, type Support } from './buckling'
import type { Column, Setup } from './model'

type Ctx = CanvasRenderingContext2D

export function fmt(v: number, d = 1) {
  if (!Number.isFinite(v)) return '∞'
  if (Math.abs(v) < 0.5 * 10 ** -d) return '0'
  const s = Math.abs(v).toFixed(d).replace('.', ',')
  return v < 0 ? `−${s}` : s
}

export interface StageState {
  setup: Setup
  sup: Support
  n: number
  L: number // mm
  col: Column
  P: number // N
  Pcr: number // N, mode 1 sumbu tekuk
  /** Euler: amplitude lateral nyata (mm) bila P > Pcr (dianimasikan) */
  amp: number
  /** vektor eigen FE mode n di simpul (titik) */
  feMode: number[] | null
  imp: Imperfect | null
  e0: number
  e: number
  fy: number
  ela: { pts: [number, number][]; d: number; short: number } | null
  label: string
}

export interface Layout {
  topY: number
  baseY: number
  pxPerN: number
}

const STEEL = '#5b6470'
const BUCK = C.red

function baseSupport(ctx: Ctx, x: number, y: number, kind: 'fix' | 'pin') {
  if (kind === 'fix') {
    ctx.fillStyle = '#d9dccf'
    ctx.fillRect(x - 34, y, 68, 8)
    hatchH(ctx, x - 40, x + 40, y + 8, 1)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x - 40, y)
    ctx.lineTo(x + 40, y)
    ctx.stroke()
    return
  }
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - 13, y + 20)
  ctx.lineTo(x + 13, y + 20)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 4, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
  hatchH(ctx, x - 26, x + 26, y + 20, 1)
}

function topSupport(ctx: Ctx, x: number, y: number, kind: 'fix' | 'pin' | 'free') {
  if (kind === 'free') return
  // pemandu vertikal: ujung atas bebas turun (beban P lewat pelat)
  ctx.strokeStyle = C.mute
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  for (const dx of [-22, 22]) {
    ctx.beginPath()
    ctx.moveTo(x + dx, y - 34)
    ctx.lineTo(x + dx, y + 12)
    ctx.stroke()
  }
  ctx.setLineDash([])
  if (kind === 'fix') {
    ctx.fillStyle = '#d9dccf'
    ctx.fillRect(x - 18, y - 8, 36, 8)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 2
    ctx.strokeRect(x - 18, y - 8, 36, 8)
    for (const dx of [-22, 22]) {
      ctx.beginPath()
      ctx.arc(x + dx + (dx < 0 ? 3 : -3), y - 4, 3, 0, 2 * Math.PI)
      ctx.stroke()
    }
    return
  }
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - 11, y - 17)
  ctx.lineTo(x + 11, y - 17)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 4, 0, 2 * Math.PI)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#d9dccf'
  ctx.fillRect(x - 18, y - 23, 36, 6)
  ctx.strokeRect(x - 18, y - 23, 36, 6)
}

function loadArrow(ctx: Ctx, x: number, y: number, ratio: number, label: string) {
  const len = 22 + 34 * Math.min(1.6, Math.max(0, ratio))
  if (ratio <= 0) return
  arrow(ctx, x, y - len, x, y - 2, C.orange, 3)
  ctx.fillStyle = C.orange
  ctx.font = FONT_B
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + 8, y - len + 6)
}

function polyline(ctx: Ctx, pts: [number, number][], color: string, width: number, dash: number[] = []) {
  ctx.save()
  ctx.setLineDash(dash)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.stroke()
  ctx.restore()
}

function sectionInset(ctx: Ctx, x0: number, y0: number, size: number, col: Column) {
  const { pr, parts } = col
  const bw = pr.xmax - pr.xmin
  const bh = pr.ymax - pr.ymin
  const s = (size * 0.62) / Math.max(bw, bh)
  const cx = x0 + size / 2
  const cy = y0 + size / 2 + 6
  const X = (x: number) => cx + (x - pr.xc) * s
  const Y = (y: number) => cy - (y - pr.yc) * s
  ctx.fillStyle = C.mute
  ctx.font = FONT_B
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('Penampang', cx, y0 - 2)
  for (const sign of [1, -1]) {
    for (const q of parts) {
      if (q.sign !== sign) continue
      ctx.fillStyle = sign > 0 ? '#e3e7da' : '#ffffff'
      ctx.strokeStyle = C.green
      ctx.lineWidth = 1.5
      ctx.beginPath()
      if (q.kind === 'rect') ctx.rect(X(q.x - q.w / 2), Y(q.y + q.h / 2), q.w * s, q.h * s)
      else ctx.arc(X(q.x), Y(q.y), q.r * s, 0, 2 * Math.PI)
      ctx.fill()
      if (sign > 0 || q.kind === 'circ') ctx.stroke()
    }
  }
  const ph = (col.angle * Math.PI) / 180
  const R = size * 0.46
  ctx.save()
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = C.navy
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(cx - R * Math.cos(ph), cy + R * Math.sin(ph))
  ctx.lineTo(cx + R * Math.cos(ph), cy - R * Math.sin(ph))
  ctx.stroke()
  ctx.restore()
  // arah tekuk tegak lurus sumbu lentur
  const nx = -Math.sin(ph)
  const ny = Math.cos(ph)
  const r2 = size * 0.36
  arrow(ctx, cx, cy, cx + nx * r2, cy - ny * r2, C.red, 2)
  arrow(ctx, cx, cy, cx - nx * r2, cy + ny * r2, C.red, 2)
  ctx.fillStyle = C.navy
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`I = ${fmt(col.I / 1e6, 3)}·10⁶ mm⁴`, x0, y0 + size + 10)
  ctx.fillText(`r = ${fmt(col.r, 1)} mm · A = ${fmt(col.A, 0)} mm²`, x0, y0 + size + 26)
  ctx.fillStyle = C.red
  ctx.fillText('↔ arah tekuk', x0, y0 + size + 42)
}

export function drawStage(ctx: Ctx, w: number, h: number, st: StageState): Layout {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const wide = w >= 560
  const inset = wide ? Math.min(170, w * 0.26) : 0
  const colW = w - (wide ? inset + 40 : 0)
  const sp = support(st.sup)
  const mirror = (st.setup === 'euler' || st.setup === 'kurva') && st.sup === 'jepit-bebas' && st.n === 1
  let baseY = h - 46
  const usable = h - 120
  let s = usable / (st.L * (mirror ? 2 : 1))
  let x0 = colW * 0.42
  if (st.setup === 'elastica' && st.ela) {
    // bentuk bisa turun di bawah dasar (α > 90°): skala & geser mengikuti batas bentuk
    const ymin = Math.min(0, ...st.ela.pts.map((q) => q[1]))
    const latMax = st.ela.d * st.L
    s = Math.min(usable / (st.L * (1 - ymin)), (colW * (st.sup === 'jepit-bebas' ? 0.55 : 0.5)) / Math.max(latMax, 1e-9))
    baseY += ymin * st.L * s
    x0 = colW * (st.sup === 'jepit-bebas' ? 0.25 : 0.32)
  }
  const Yx = (xi: number) => baseY - xi * st.L * s

  // tumpuan bawah
  baseSupport(ctx, x0, baseY, sp.base)

  ctx.font = FONT
  let topX = x0
  let topY = Yx(1)
  const ratio = st.P / st.Pcr

  if (st.setup === 'euler' || st.setup === 'kurva') {
    const m = modeShape(st.sup, st.n)
    const A = colW * 0.16
    const ghost: [number, number][] = []
    for (let i = 0; i <= 120; i++) ghost.push([x0 + A * shapeAt(m, i / 120), Yx(i / 120)])
    polyline(ctx, ghost, C.orange, 1.6, [6, 4])
    if (mirror) {
      const g2: [number, number][] = []
      for (let i = 0; i <= 120; i++) g2.push([x0 + A * shapeAt(m, 1 - i / 120), Yx(1 + i / 120)])
      polyline(ctx, g2, C.orange, 1.2, [2, 4])
      ctx.fillStyle = C.mute
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText('bayangan cermin: setengah gelombang sendi–sendi 2L', x0 + 8, Yx(1.8))
      ctx.strokeStyle = C.line
      ctx.beginPath()
      ctx.moveTo(x0, Yx(1))
      ctx.lineTo(x0, Yx(2))
      ctx.stroke()
    }
    if (st.feMode) {
      ctx.fillStyle = C.navy
      const nE = st.feMode.length - 1
      st.feMode.forEach((v, i) => {
        ctx.beginPath()
        ctx.arc(x0 + A * v, Yx(i / nE), 2.6, 0, 2 * Math.PI)
        ctx.fill()
      })
    }
    // titik belok + panjang efektif
    const inf = inflections(m)
    const zc = [...inf]
    if (sp.base === 'pin') zc.push(0)
    if (sp.top !== 'fix') zc.push(1)
    zc.sort((a, b) => a - b)
    for (const xi of inf) {
      ctx.strokeStyle = C.orange
      ctx.fillStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x0 + A * shapeAt(m, xi), Yx(xi), 5, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
    }
    if (inf.length) {
      const xi = inf[0]
      ctx.fillStyle = C.orange
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText('titik belok (M = 0)', x0 + A * shapeAt(m, xi) + 10, Yx(xi))
    }
    const dx = x0 - colW * 0.27
    const [a, b] = mirror ? [0, 2] : zc.length >= 2 ? [zc[0], zc[1]] : [0, 1]
    const K = (b - a) * (mirror ? 1 : 1)
    dimV(ctx, dx, Yx(a), Yx(b), `Le = ${fmt(K, 3)}·L`, C.navy, -1)
    ctx.fillStyle = C.navy
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(`= ${fmt((K * st.L) / 1000, 2)} m`, dx - 7, (Yx(a) + Yx(b)) / 2 + 10)

    // kolom nyata
    const buckled = st.setup === 'euler' && ratio >= 1 && st.amp > 0
    const m1 = modeShape(st.sup, 1)
    const pts: [number, number][] = []
    for (let i = 0; i <= 120; i++) pts.push([x0 + (buckled ? st.amp * s * shapeAt(m1, i / 120) : 0), Yx(i / 120)])
    polyline(ctx, pts, buckled ? BUCK : STEEL, 7)
    topX = pts[pts.length - 1][0]
    // panjang
    dimV(ctx, x0 + colW * 0.3, Yx(0), Yx(1), `L = ${fmt(st.L / 1000, 2)} m`, C.mute, 1)
  } else if (st.setup === 'imperfeksi' && st.imp) {
    const imp = st.imp
    const ref = Math.max(st.e0 + st.e, st.L / 2000)
    const mag = (colW * 0.028) / ref // px per mm lateral
    const nE = imp.w.length - 1
    const p0: [number, number][] = imp.w0.map((v, i) => [x0 + v * mag, Yx(i / nE)])
    const p1: [number, number][] = imp.w.map((v, i) => [x0 + Math.max(-colW * 0.4, Math.min(colW * 0.5, (v + imp.w0[i]) * mag)), Yx(i / nE)])
    ctx.strokeStyle = C.line
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x0, Yx(0))
    ctx.lineTo(x0, Yx(1))
    ctx.stroke()
    polyline(ctx, p0, C.mute, 1.5, [5, 4])
    const yRatio = Math.min(1, (st.P / st.col.A + imp.Mmax / st.col.S) / st.fy)
    polyline(ctx, p1, yRatio >= 1 ? BUCK : STEEL, 7)
    topX = p1[nE][0]
    // eksentrisitas pada ujung bebas berputar
    if (st.e > 0 && st.sup !== 'jepit') {
      const ex = -st.e * mag
      ctx.strokeStyle = C.orange
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(topX, Yx(1))
      ctx.lineTo(topX + ex, Yx(1))
      ctx.stroke()
      topX += ex
      ctx.fillStyle = C.orange
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`e = ${fmt(st.e)} mm`, topX - 4, Yx(1) - 4)
    }
    // diagram momen
    const mx = x0 + colW * 0.36
    const My = st.fy * st.col.S
    const sc = (colW * 0.16) / Math.max(My, 1)
    ctx.fillStyle = 'rgba(102,20,101,0.15)'
    ctx.strokeStyle = '#661465'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(mx, Yx(0))
    imp.M.forEach((v, i) => ctx.lineTo(mx + Math.min(colW * 0.3, v * sc), Yx(i / nE)))
    ctx.lineTo(mx, Yx(1))
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = C.mute
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(mx + My * sc, Yx(0))
    ctx.lineTo(mx + My * sc, Yx(1))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#661465'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`M maks = ${fmt(imp.Mmax / 1e6, 2)} kN·m`, mx, Yx(1) - 6)
    ctx.fillStyle = C.mute
    ctx.textBaseline = 'top'
    ctx.fillText('fy·S', mx + My * sc + 3, Yx(0) + 4)
    // pembesaran
    ctx.fillStyle = C.mute
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`lendutan lateral diperbesar ×${fmt(mag / s, 0)}`, 10, 30)
    ctx.fillText('putus-putus = lengkung awal e0', 10, 46)
    // bar tegangan
    const bw = Math.min(220, colW * 0.5)
    const bx = 10
    const by = h - 22
    ctx.fillStyle = C.grid
    ctx.fillRect(bx, by, bw, 10)
    ctx.fillStyle = yRatio >= 1 ? C.red : C.green
    ctx.fillRect(bx, by, bw * yRatio, 10)
    ctx.strokeStyle = C.mute
    ctx.strokeRect(bx, by, bw, 10)
    ctx.fillStyle = C.ink
    ctx.textBaseline = 'bottom'
    ctx.fillText(`σ maks = P/A + M/S = ${fmt(st.P / st.col.A + imp.Mmax / st.col.S, 0)} MPa  (fy ${fmt(st.fy, 0)})`, bx, by - 3)
    dimV(ctx, x0 - colW * 0.27, Yx(0), Yx(1), `L = ${fmt(st.L / 1000, 2)} m`, C.mute, -1)
  } else if (st.setup === 'elastica') {
    // kolom lurus semula (pembanding)
    ctx.strokeStyle = C.line
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(x0, Yx(0))
    ctx.lineTo(x0, Yx(1))
    ctx.stroke()
    const e = st.ela
    if (e && e.d > 0) {
      const pts: [number, number][] = e.pts.map(([x, y]) => [x0 + x * st.L * s, baseY - y * st.L * s])
      polyline(ctx, pts, BUCK, 6)
      topX = pts[pts.length - 1][0]
      topY = pts[pts.length - 1][1]
      // δ maks
      let im = 0
      e.pts.forEach(([x], i) => Math.abs(x) > Math.abs(e.pts[im][0]) && (im = i))
      const [px, py] = pts[im]
      dimH(ctx, x0, px, py + 12, `δ = ${fmt(e.d, 3)}·L`, C.navy)
      if (e.short > 0.002) dimV(ctx, x0 - 34, Yx(1), topY, `Δ = ${fmt(e.short, 3)}·L`, C.navy, -1)
    } else {
      polyline(
        ctx,
        [
          [x0, Yx(0)],
          [x0, Yx(1)],
        ],
        STEEL,
        6,
      )
    }
  }

  topSupport(ctx, topX, topY, sp.top)
  const arrowY = sp.top === 'free' ? topY - 4 : sp.top === 'pin' ? topY - 24 : topY - 9
  loadArrow(ctx, topX, arrowY, st.setup === 'elastica' ? (st.ela && st.ela.d > 0 ? Math.max(1, ratio) : ratio) : ratio, st.label)

  // judul status
  ctx.font = FONT_B
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = C.ink
  ctx.fillText(`${sp.label} · K = ${fmt(sp.K, 3)}`, 10, 10)

  if (wide) sectionInset(ctx, w - inset - 16, 30, inset, st.col)
  return { topY, baseY, pxPerN: 0 }
}

