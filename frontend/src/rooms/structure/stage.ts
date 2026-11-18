// Gambar panggung Room Structure: struktur, tumpuan, beban, reaksi, diagram N/V/M, bentuk lendutan, + hit test.
import { arrow, hatchH, hatchV } from '../../lab/draw'
import type { FrameResult, MemberResult, Station } from '../../lab/frame2d'
import { sampleAt } from '../../lab/frame2d'
import { C, FONT, FONT_B } from '../../lab/theme'
import { bounds, type Built, type Params, type Setup } from './model'

type Ctx = CanvasRenderingContext2D

export type Diagram = 'def' | 'N' | 'V' | 'M'

export interface View {
  s: number // px per meter
  ox: number // layar x untuk x = 0
  oy: number // layar y untuk y = 0
}

export interface Hover {
  member: number
  s: number
}

export interface Layout {
  view: View
  handle: { x: number; y0: number; y1: number } | null // panah P yang bisa digeser
}

export interface DrawOpts {
  setup: Setup
  p: Params
  built: Built
  res: FrameResult
  diagram: Diagram
  reactions: boolean
  values: boolean
  loads: boolean
  hover: Hover | null
}

const POS = C.navy
const NEG = C.red
const LOAD = C.red

export function fmt(v: number) {
  const a = Math.abs(v)
  if (a < 1e-9) return '0'
  return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2)
}

export function targetView(setup: Setup, p: Params, w: number, h: number): View {
  const b = bounds(setup, p)
  const bw = Math.max(b.x1 - b.x0, 0.5)
  const bh = b.y1 - b.y0
  const frame = setup === 'portal' || setup === 'gable'
  // ruang beban & diagram di atas, tumpuan + reaksi + teks bantuan di bawah, diagram kolom di samping
  const top = frame ? 116 : 92
  const bot = setup === 'truss' ? 122 : frame ? 118 : 86
  const side = Math.min(frame || setup === 'kantilever' ? 120 : 84, Math.max(24, w * 0.13)) // layar sempit: margin samping mengecil
  let s = (w - 2 * side) / bw
  if (bh > 0) s = Math.min(s, (h - top - bot) / bh)
  else s = Math.min(s, 260)
  const ox = (w - bw * s) / 2 - b.x0 * s
  const oy = bh > 0 ? top + bh * s + (h - top - bot - bh * s) / 2 : Math.round(h * 0.4)
  return { s, ox, oy }
}

const X = (v: View, x: number) => v.ox + x * v.s
const Y = (v: View, y: number) => v.oy - y * v.s

function label(ctx: Ctx, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'center', base: CanvasTextBaseline = 'middle', bold = false) {
  ctx.font = bold ? FONT_B : FONT
  ctx.textAlign = align
  ctx.textBaseline = base
  const m = ctx.measureText(text)
  const wpx = m.width
  let x0 = x
  if (align === 'center') x0 = x - wpx / 2
  else if (align === 'right') x0 = x - wpx
  let y0 = y - 7
  if (base === 'top') y0 = y - 1
  else if (base === 'bottom') y0 = y - 14
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(x0 - 2, y0, wpx + 4, 15)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

// ---------- tumpuan ----------

function drawPin(ctx: Ctx, x: number, y: number, roller: boolean) {
  const hgt = 16
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - 11, y + hgt)
  ctx.lineTo(x + 11, y + hgt)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  let base = y + hgt
  if (roller) {
    for (const dx of [-6, 6]) {
      ctx.beginPath()
      ctx.arc(x + dx, base + 4, 3.5, 0, Math.PI * 2)
      ctx.stroke()
    }
    base += 8
  }
  hatchH(ctx, x - 18, x + 18, base, 1)
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = C.ink
  ctx.beginPath()
  ctx.arc(x, y, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function drawFixed(ctx: Ctx, x: number, y: number, wall: -1 | 0 | 1) {
  if (wall) {
    hatchV(ctx, x, y - 26, y + 26, wall)
    return
  }
  hatchH(ctx, x - 22, x + 22, y, 1)
}

const supportDepth = (sp: { ux?: boolean; uy?: boolean; rz?: boolean }) => (sp.rz ? 6 : sp.ux ? 26 : 34)

// ---------- gambar utama ----------

export function drawStage(ctx: Ctx, w: number, h: number, v: View, o: DrawOpts): Layout {
  const { built, res, setup } = o
  const fr = built.frame
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)

  // skala diagram
  const big = Math.min(w, h)
  let dMax = 0
  const key = o.diagram === 'def' ? null : o.diagram
  if (key) for (const m of res.members) for (const st of m.stations) dMax = Math.max(dMax, Math.abs(st[key]))
  const dScale = dMax > 1e-9 ? Math.min(78, big * 0.17) / dMax : 0
  const defScale = res.maxDisp > 1e-12 ? Math.min(64, big * 0.13) / res.maxDisp : 0 // px per m perpindahan
  const isTruss = setup === 'truss'

  // wall arah untuk tumpuan jepit di ujung balok horizontal (kantilever)
  const wallOf = (node: number): -1 | 0 | 1 => {
    const m = fr.members.find((mm) => mm.i === node || mm.j === node)
    if (!m) return 0
    const other = fr.nodes[m.i === node ? m.j : m.i]
    const me = fr.nodes[node]
    if (Math.abs(other.y - me.y) > 1e-9) return 0
    return other.x > me.x ? -1 : 1
  }

  // struktur asli (garis putus bila lendutan ditampilkan)
  const showDef = o.diagram === 'def'
  for (let mi = 0; mi < fr.members.length; mi++) {
    const m = fr.members[mi]
    const A = fr.nodes[m.i]
    const B = fr.nodes[m.j]
    ctx.save()
    if (showDef) {
      ctx.setLineDash([6, 5])
      ctx.strokeStyle = '#b9b6aa'
      ctx.lineWidth = 2
    } else if (isTruss && o.diagram === 'N') {
      const N = res.members[mi].stations[0]?.N ?? 0
      const t = dMax > 1e-9 ? Math.abs(N) / dMax : 0
      ctx.strokeStyle = Math.abs(N) < 1e-6 * Math.max(1, dMax) ? '#b9b6aa' : N > 0 ? POS : NEG
      ctx.lineWidth = 1.5 + 5.5 * t
    } else {
      ctx.strokeStyle = C.ink
      ctx.lineWidth = isTruss ? 2.5 : 4
    }
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(X(v, A.x), Y(v, A.y))
    ctx.lineTo(X(v, B.x), Y(v, B.y))
    ctx.stroke()
    ctx.restore()
  }

  // diagram gaya dalam
  if (key && !(isTruss && key === 'N')) {
    if (dScale > 0)
      {
        const placed: [number, number][] = [] // dipakai bersama agar label di simpul sambungan tidak dobel
        res.members.forEach((mr) => drawDiagram(ctx, v, mr, key, dScale, o.values, placed))
      }
    else if (isTruss) label(ctx, 'Rangka ideal (sendi di tiap simpul): V = 0 dan M = 0, hanya gaya aksial N.', w / 2, 24, C.mute)
  }
  if (isTruss && key === 'N' && o.values) {
    res.members.forEach((mr) => {
      const st = mr.stations[0]
      if (!st) return
      const a = mr.stations[0]
      const b = mr.stations[mr.stations.length - 1]
      if (Math.hypot(b.x - a.x, b.y - a.y) * v.s < 46) return // batang terlalu pendek di layar → lewati label
      const mx = X(v, (a.x + b.x) / 2)
      const my = Y(v, (a.y + b.y) / 2)
      const N = st.N
      label(ctx, Math.abs(N) < 1e-6 * Math.max(1, dMax) ? '0' : `${N > 0 ? '+' : '−'}${fmt(Math.abs(N))}`, mx, my, Math.abs(N) < 1e-6 * Math.max(1, dMax) ? C.mute : N > 0 ? POS : NEG)
    })
  }

  // simpul
  for (let ni = 0; ni < fr.nodes.length; ni++) {
    const n = fr.nodes[ni]
    if (!isTruss) continue
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(X(v, n.x), Y(v, n.y), 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  // tumpuan
  for (const sp of fr.supports) {
    const n = fr.nodes[sp.node]
    const x = X(v, n.x)
    const y = Y(v, n.y)
    if (sp.rz) drawFixed(ctx, x, y + (wallOf(sp.node) ? 0 : 2), wallOf(sp.node))
    else drawPin(ctx, x, y, !sp.ux)
  }

  // lendutan
  if (showDef && defScale > 0) drawDeflection(ctx, v, res, defScale, o.values, isTruss)

  // beban
  let handle: Layout['handle'] = null
  if (o.loads) handle = drawLoads(ctx, v, o)

  // reaksi
  if (o.reactions && res.ok) {
    res.reactions.forEach((r, k) => {
      const sp = fr.supports[k]
      const n = fr.nodes[r.node]
      const x = X(v, n.x)
      const y = Y(v, n.y)
      const wall = sp.rz ? wallOf(sp.node) : 0
      const dep = wall ? 0 : supportDepth(sp)
      const g = C.green
      if (Math.abs(r.ry) > 1e-6) {
        const y1 = y + dep + 6
        const y2 = y + dep + 44
        if (r.ry > 0) arrow(ctx, x, y2, x, y1, g, 2.5)
        else arrow(ctx, x, y1, x, y2, g, 2.5)
        label(ctx, `${fmt(Math.abs(r.ry))} kN`, x, y2 + 4, g, 'center', 'top', true)
      }
      if (Math.abs(r.rx) > 1e-6) {
        const side = n.x <= (fr.nodes.reduce((a, b) => a + b.x, 0) / fr.nodes.length) ? -1 : 1
        const yy = y + Math.min(dep, 14)
        const xa = x + side * 58
        const xb = x + side * 14
        if ((r.rx > 0) === (side < 0)) arrow(ctx, xa, yy, xb, yy, g, 2.5)
        else arrow(ctx, xb, yy, xa, yy, g, 2.5)
        label(ctx, `${fmt(Math.abs(r.rx))} kN`, xa + side * 4, yy - 10, g, side < 0 ? 'right' : 'left', 'middle', true)
      }
      if (Math.abs(r.mz) > 1e-6) {
        const R = 24
        const ccw = r.mz > 0
        const a0 = wall ? (wall < 0 ? 0.6 * Math.PI : -0.4 * Math.PI) : 0.15 * Math.PI
        const a1 = a0 + 1.1 * Math.PI
        // layar: y ke bawah, jadi "berlawanan jarum jam" = sudut layar berkurang
        const cx = wall ? x + wall * 4 : x
        const cy = wall ? y : y + 4
        ctx.strokeStyle = g
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.arc(cx, cy, R, a0, a1)
        ctx.stroke()
        const end = ccw ? a0 : a1
        const tx = cx + R * Math.cos(end)
        const ty = cy + R * Math.sin(end)
        const dir = ccw ? -1 : 1
        const tang = [-Math.sin(end) * dir, Math.cos(end) * dir]
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(tx + tang[0] * 8, ty + tang[1] * 8)
        ctx.lineTo(tx - tang[1] * 5, ty + tang[0] * 5)
        ctx.lineTo(tx + tang[1] * 5, ty - tang[0] * 5)
        ctx.closePath()
        ctx.fill()
        const lx = wall ? x + wall * 34 : x + (n.x < 1e-9 ? -30 : 30)
        const ly = wall ? y + 34 : y + 30
        label(ctx, `${fmt(Math.abs(r.mz))} kN·m`, lx, ly, g, wall ? (wall < 0 ? 'right' : 'left') : n.x < 1e-9 ? 'right' : 'left', 'top', true)
      }
    })
  }

  if (!res.ok) label(ctx, 'Struktur labil — matriks kekakuan singular', w / 2, 24, C.red, 'center', 'middle', true)

  // penanda hover
  if (o.hover) {
    const mr = res.members[o.hover.member]
    const st = sampleAt(mr, o.hover.s)
    const bx = X(v, st.x)
    const by = Y(v, st.y)
    ctx.strokeStyle = C.orange
    ctx.fillStyle = C.orange
    ctx.lineWidth = 1.5
    if (key && dScale > 0 && !(isTruss && key === 'N')) {
      const [px, py] = diagPoint(v, mr, st, key, dScale)
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(px, py)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(px, py, 3.5, 0, Math.PI * 2)
      ctx.fill()
    } else if (showDef && defScale > 0) {
      const px = bx + st.ux * defScale
      const py = by - st.uy * defScale
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(px, py)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(px, py, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(bx, by, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  // keterangan skala lendutan
  if (showDef && defScale > 0) {
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`Lendutan diperbesar ×${fmtScale(defScale / v.s)}`, 14, 12)
  } else if (key && w >= 560) {
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const t =
      key === 'M'
        ? 'Momen M (kN·m) digambar di sisi serat tertarik · biru = positif (sagging), merah = negatif'
        : key === 'V'
          ? 'Gaya geser V (kN) · biru = positif, merah = negatif'
          : 'Gaya aksial N (kN) · biru = tarik (+), merah = tekan (−)'
    ctx.fillText(t, 14, 12)
  }

  return { view: v, handle }
}

function fmtScale(k: number) {
  if (k >= 100) return String(Math.round(k / 10) * 10)
  if (k >= 10) return String(Math.round(k))
  return k.toFixed(1)
}

/** Titik layar diagram untuk stasiun st. */
function diagPoint(v: View, mr: MemberResult, st: Station, key: 'N' | 'V' | 'M', k: number): [number, number] {
  const bx = X(v, st.x)
  const by = Y(v, st.y)
  // arah lokal y di layar = (−s, −c); M digambar ke sisi −y lokal (serat tertarik)
  const val = key === 'M' ? -st.M : st[key]
  return [bx + val * k * -mr.s, by + val * k * -mr.c]
}

function drawDiagram(ctx: Ctx, v: View, mr: MemberResult, key: 'N' | 'V' | 'M', k: number, values: boolean, placed: [number, number][]) {
  const st = mr.stations
  if (st.length < 2) return
  const pts = st.map((s) => diagPoint(v, mr, s, key, k))
  const base = st.map((s) => [X(v, s.x), Y(v, s.y)] as [number, number])
  // isian per segmen, warna menurut tanda
  for (let i = 0; i < st.length - 1; i++) {
    const avg = (st[i][key] + st[i + 1][key]) / 2
    if (Math.abs(avg) < 1e-12) continue
    ctx.fillStyle = avg > 0 ? 'rgba(13,48,75,0.13)' : 'rgba(181,69,47,0.14)'
    ctx.beginPath()
    ctx.moveTo(...base[i])
    ctx.lineTo(...pts[i])
    ctx.lineTo(...pts[i + 1])
    ctx.lineTo(...base[i + 1])
    ctx.closePath()
    ctx.fill()
  }
  ctx.lineWidth = 1.8
  for (let i = 0; i < st.length - 1; i++) {
    const avg = (st[i][key] + st[i + 1][key]) / 2
    ctx.strokeStyle = avg >= 0 ? POS : NEG
    ctx.beginPath()
    ctx.moveTo(...pts[i])
    ctx.lineTo(...pts[i + 1])
    ctx.stroke()
  }
  // garis penutup di ujung & loncatan
  ctx.strokeStyle = C.mute
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(...base[0])
  ctx.lineTo(...pts[0])
  ctx.moveTo(...base[st.length - 1])
  ctx.lineTo(...pts[st.length - 1])
  ctx.stroke()

  if (!values) return
  // label: ujung + ekstrem
  let iMax = 0
  let iMin = 0
  st.forEach((s, i) => {
    if (s[key] > st[iMax][key]) iMax = i
    if (s[key] < st[iMin][key]) iMin = i
  })
  const peak = Math.max(...st.map((s) => Math.abs(s[key])))
  const cand = [iMax, iMin, 0, st.length - 1]
  for (const i of cand) {
    const val = st[i][key]
    if (Math.abs(val) < Math.max(1e-6, peak * 0.04)) continue
    const [px, py] = pts[i]
    if (placed.some(([x, y]) => Math.hypot(x - px, y - py) < 34)) continue
    placed.push([px, py])
    // dorong label sedikit keluar dari garis dasar
    const dx = px - base[i][0]
    const dy = py - base[i][1]
    const d = Math.hypot(dx, dy) || 1
    label(ctx, fmt(val), px + (dx / d) * 12, py + (dy / d) * 10, val > 0 ? POS : NEG, 'center', 'middle', true)
  }
}

function drawDeflection(ctx: Ctx, v: View, res: FrameResult, k: number, values: boolean, truss: boolean) {
  let best: { x: number; y: number; d: number } | null = null
  ctx.strokeStyle = C.navy
  ctx.lineWidth = truss ? 2.5 : 3.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const mr of res.members) {
    ctx.beginPath()
    mr.stations.forEach((st, i) => {
      const x = X(v, st.x) + st.ux * k
      const y = Y(v, st.y) - st.uy * k
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
      const d = Math.hypot(st.ux, st.uy)
      if (!best || d > best.d) best = { x, y, d }
    })
    ctx.stroke()
  }
  const b = best as { x: number; y: number; d: number } | null
  if (b && values) {
    ctx.fillStyle = C.orange
    ctx.beginPath()
    ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2)
    ctx.fill()
    label(ctx, `δmaks = ${fmt(b.d * 1000)} mm`, b.x + 8, b.y + 14, C.navy, 'left', 'top', true)
  }
}

function drawLoads(ctx: Ctx, v: View, o: DrawOpts): Layout['handle'] {
  const { built, p, setup } = o
  const fr = built.frame
  // beban merata (gravitasi) di atas batang
  let qLabelDone = false
  fr.members.forEach((m) => {
    if (!m.qy) return
    const A = fr.nodes[m.i]
    const B = fr.nodes[m.j]
    const x1 = X(v, A.x)
    const y1 = Y(v, A.y)
    const x2 = X(v, B.x)
    const y2 = Y(v, B.y)
    const off = 30
    const len = Math.hypot(x2 - x1, y2 - y1)
    const count = Math.max(2, Math.round(len / 28))
    ctx.strokeStyle = LOAD
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x1, y1 - off)
    ctx.lineTo(x2, y2 - off)
    ctx.stroke()
    for (let i = 0; i <= count; i++) {
      const t = i / count
      const x = x1 + (x2 - x1) * t
      const y = y1 + (y2 - y1) * t
      arrow(ctx, x, y - off, x, y - 4, LOAD, 1.4)
    }
    if (!qLabelDone) {
      qLabelDone = true
      const txt = setup === 'gable' ? `q = ${fmt(p.q)} kN/m (per proyeksi horizontal)` : `q = ${fmt(p.q)} kN/m`
      // hindari label P: pilih seperempat batang yang jauh dari P
      let t = 0.5
      if (built.track && p.P && setup !== 'truss') {
        const px = X(v, built.track.x0 + p.a)
        // label P ada di kanan panah → condongkan pilihan ke kiri
        t = Math.abs(x1 + (x2 - x1) * 0.25 - px) + 60 > Math.abs(x1 + (x2 - x1) * 0.75 - px) ? 0.25 : 0.75
      }
      const lx = setup === 'gable' ? X(v, p.L / 2) : x1 + (x2 - x1) * t
      const ly = setup === 'gable' ? Y(v, p.h + p.f) - off - 12 : Math.min(y1, y2) - off - 10
      label(ctx, txt, lx, ly, LOAD)
    }
  })

  // beban simpul
  for (const l of fr.nodeLoads ?? []) {
    const n = fr.nodes[l.node]
    const x = X(v, n.x)
    const y = Y(v, n.y)
    if (l.fx) {
      const dir = Math.sign(l.fx)
      arrow(ctx, x - dir * 62, y, x - dir * 5, y, LOAD, 2.5)
      label(ctx, `W = ${fmt(Math.abs(l.fx))} kN`, x - dir * 64, y - 12, LOAD, dir > 0 ? 'left' : 'right', 'middle', true)
    }
    if (l.fy && setup === 'truss' && Math.abs(-l.fy - p.w) < 1e-9 && p.w) {
      arrow(ctx, x, y + 6, x, y + 34, LOAD, 1.6)
    }
  }
  if (setup === 'truss' && p.w) {
    const x = X(v, p.L / (Math.round(p.n / 2) * 2))
    label(ctx, `w = ${fmt(p.w)} kN tiap simpul`, x, Y(v, 0) + 46, LOAD, 'left', 'top')
  }

  // beban terpusat P (bisa digeser)
  const tr = built.track
  if (!tr || !p.P) return tr ? { x: X(v, tr.x0 + p.a), y0: 0, y1: 0 } : null
  const x = X(v, tr.x0 + p.a)
  const yb = Y(v, tr.y)
  const truss = setup === 'truss'
  const y0 = truss ? yb + 6 : yb - 74
  const y1 = truss ? yb + 66 : yb - 4
  arrow(ctx, x, y0, x, y1, C.orange, 3)
  const hy = truss ? y1 + 9 : y0 // pegangan: ujung bebas panah
  ctx.fillStyle = C.orange
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, hy, 6.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  const ty = truss ? hy - 6 : y0 + 4
  label(ctx, `P = ${fmt(p.P)} kN`, x + 11, ty, C.orange, 'left', 'top', true)
  label(ctx, `a = ${fmt(p.a)} m`, x + 11, ty + 16, C.mute, 'left', 'top')
  return { x, y0: Math.min(y0, hy) - 9, y1: Math.max(y1, hy) + 9 }
}

// ---------- hit test ----------

export function hitHandle(l: Layout, x: number, y: number) {
  const hd = l.handle
  return !!hd && hd.y1 > hd.y0 && Math.abs(x - hd.x) < 14 && y > hd.y0 && y < hd.y1
}

/** Titik terdekat pada batang (≤ 14 px) → indeks batang + jarak s dari simpul i. */
export function hitMember(l: Layout, built: Built, res: FrameResult, x: number, y: number): Hover | null {
  const v = l.view
  let best: Hover | null = null
  let bestD = 14
  built.frame.members.forEach((m, mi) => {
    const A = built.frame.nodes[m.i]
    const mr = res.members[mi]
    const ax = X(v, A.x)
    const ay = Y(v, A.y)
    const dx = mr.c * v.s
    const dy = -mr.s * v.s
    const t = Math.max(0, Math.min(mr.L, ((x - ax) * dx + (y - ay) * dy) / (v.s * v.s)))
    const px = ax + dx * t
    const py = ay + dy * t
    const d = Math.hypot(x - px, y - py)
    if (d < bestD) {
      bestD = d
      best = { member: mi, s: t }
    }
  })
  return best
}
