// Panggung Room Influence Line: struktur + beban berjalan (atas) dan garis pengaruh sejajar sumbu x (bawah),
// teori (garis) vs titik terukur dari solver kekakuan, bentuk Müller–Breslau, potongan Ritter, + hit test.
import { arrow, hatchH } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import { fmt } from '../../lab/chart'
import { respLabel, respUnit, supLabel, supportsX, trackLength, trussGeom, type Axle, type Params, type Setup, type Vehicle } from './model'
import type { IlStats, Ritter } from './theory'

type Ctx = CanvasRenderingContext2D

export interface View {
  s: number // px per m
  ox: number // layar x untuk x = 0
  yS: number // layar y sumbu balok / batang bawah rangka
  yIL: number // garis dasar garis pengaruh
  k: number // px per satuan ordinat
}

export interface Layout {
  view: View
  load: { x0: number; x1: number; y0: number; y1: number } | null
  section: { x: number; y: number } | null
  segs: { m: number; x1: number; y1: number; x2: number; y2: number }[]
}

export interface DrawOpts {
  setup: Setup
  p: Params
  resp: string
  curve: [number, number][]
  stats: IlStats
  trace: [number, number][]
  veh: Vehicle
  pos: number
  axles: Axle[]
  lajurSign: 1 | -1
  mb: boolean
  ritter: Ritter | null
  hoverMember: number | null
  eta: (x: number) => number
}

const POS = C.navy
const NEG = C.red
const HI = C.orange

const XS = (v: View, x: number) => v.ox + x * v.s

function label(ctx: Ctx, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'center', bold = false) {
  ctx.font = bold ? FONT_B : FONT
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  const wpx = ctx.measureText(text).width
  const x0 = align === 'center' ? x - wpx / 2 : align === 'right' ? x - wpx : x
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(x0 - 2, y - 8, wpx + 4, 16)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

export function computeView(setup: Setup, p: Params, w: number, h: number, st: IlStats): View {
  const Lt = trackLength(setup, p)
  const side = Math.min(60, Math.max(22, w * 0.06))
  let s = (w - 2 * side) / Lt
  const truss = setup === 'truss'
  if (truss) s = Math.min(s, (h * 0.26) / p.h)
  const ox = (w - Lt * s) / 2
  const yS = truss ? 44 + Math.max(84, p.h * s + 26) : 118
  const y0 = yS + 104
  const y1 = h - 26
  const max = Math.max(st.max, 0)
  const min = Math.min(st.min, 0)
  const span = Math.max(max - min, 1e-9)
  const k = Math.min((y1 - y0) / span, 150 / Math.max(max, -min, 1e-9))
  const used = span * k
  const yIL = y0 + ((y1 - y0) - used) / 2 + max * k
  return { s, ox, yS, yIL, k }
}

// ---------- tumpuan ----------

function drawPin(ctx: Ctx, x: number, y: number, roller: boolean, color: string) {
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - 10, y + 15)
  ctx.lineTo(x + 10, y + 15)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  let base = y + 15
  if (roller) {
    for (const dx of [-5, 5]) {
      ctx.beginPath()
      ctx.arc(x + dx, base + 4, 3.3, 0, Math.PI * 2)
      ctx.stroke()
    }
    base += 8
  }
  hatchH(ctx, x - 17, x + 17, base, 1)
}

// ---------- beban ----------

function drawTruck(ctx: Ctx, v: View, X: number, axles: Axle[], yDeck: number) {
  const xs = axles.map((a) => XS(v, X + a.off))
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  const dirRight = axles[1].off < 0
  const r = Math.max(4, Math.min(8, v.s * 0.45))
  const bodyH = Math.max(16, Math.min(34, v.s * 1.8))
  const yWheel = yDeck - r
  const yBody = yWheel - r * 0.6
  // bak muatan + kabin
  const cab = Math.max(10, Math.min(30, v.s * 1.6))
  const front = dirRight ? hi + r * 1.4 : lo - r * 1.4
  const back = dirRight ? lo - r * 1.6 : hi + r * 1.6
  ctx.fillStyle = 'rgba(86,100,73,0.16)'
  ctx.strokeStyle = C.green
  ctx.lineWidth = 1.5
  const bx0 = Math.min(back, front - (dirRight ? cab : -cab))
  const bx1 = Math.max(back, front - (dirRight ? cab : -cab))
  ctx.fillRect(bx0, yBody - bodyH, bx1 - bx0 - (dirRight ? 3 : 0), bodyH)
  ctx.strokeRect(bx0, yBody - bodyH, bx1 - bx0 - (dirRight ? 3 : 0), bodyH)
  const cx0 = dirRight ? front - cab : front
  ctx.fillStyle = 'rgba(86,100,73,0.32)'
  ctx.fillRect(cx0, yBody - bodyH * 0.78, cab, bodyH * 0.78)
  ctx.strokeRect(cx0, yBody - bodyH * 0.78, cab, bodyH * 0.78)
  for (let i = 0; i < axles.length; i++) {
    ctx.fillStyle = C.ink
    ctx.beginPath()
    ctx.arc(xs[i], yWheel, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(xs[i], yWheel, r * 0.35, 0, Math.PI * 2)
    ctx.fill()
    label(ctx, `${axles[i].P}`, xs[i], yBody - bodyH - 10, HI, 'center', true)
  }
  return { x0: Math.min(bx0, cx0) - 4, x1: Math.max(bx1, cx0 + cab) + 4, y0: yBody - bodyH - 18, y1: yDeck + 2 }
}

/** Interval x di mana ordinat bertanda `sign` (untuk pola beban lajur). */
function signIntervals(curve: [number, number][], sign: 1 | -1): [number, number][] {
  const out: [number, number][] = []
  let start: number | null = null
  for (let k = 0; k < curve.length; k++) {
    const [x, y] = curve[k]
    const on = y * sign > 1e-9
    if (on && start === null) {
      if (k > 0) {
        const [x0, y0] = curve[k - 1]
        start = y !== y0 ? x0 + ((0 - y0) / (y - y0)) * (x - x0) : x0
      } else start = x
    }
    if (!on && start !== null) {
      const [x0, y0] = curve[k - 1]
      const xe = y !== y0 ? x0 + ((0 - y0) / (y - y0)) * (x - x0) : x
      if (xe - start > 1e-6) out.push([start, xe])
      start = null
    }
  }
  if (start !== null) out.push([start, curve[curve.length - 1][0]])
  return out
}

function drawLajur(ctx: Ctx, v: View, o: DrawOpts, yDeck: number) {
  const iv = signIntervals(o.curve, o.lajurSign)
  const top = yDeck - 34
  ctx.fillStyle = 'rgba(237,141,59,0.12)'
  for (const [a, b] of iv) {
    const x0 = XS(v, a)
    const x1 = XS(v, b)
    ctx.fillRect(x0, top, x1 - x0, 26)
    ctx.strokeStyle = HI
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x0, top)
    ctx.lineTo(x1, top)
    ctx.stroke()
    const n = Math.max(1, Math.round((x1 - x0) / 16))
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n
      arrow(ctx, x, top, x, yDeck - 2, HI, 1.2)
    }
  }
  if (iv.length) label(ctx, `q = ${fmt(o.p.q)} kN/m`, XS(v, iv[0][0]) + 4, top - 10, HI, 'left', true)
  const xp = o.lajurSign > 0 ? o.stats.xMax : o.stats.xMin
  const ep = o.lajurSign > 0 ? o.stats.max : o.stats.min
  if (o.p.pk > 0 && Math.abs(ep) > 1e-9) {
    const x = XS(v, xp)
    arrow(ctx, x, top - 36, x, yDeck - 2, C.red, 2.5)
    label(ctx, `p = ${fmt(o.p.pk, 0)} kN`, x + 6, top - 40, C.red, 'left', true)
  }
}

// ---------- gambar utama ----------

export function drawStage(ctx: Ctx, w: number, h: number, o: DrawOpts): Layout {
  const { setup, p } = o
  const v = computeView(setup, p, w, h, o.stats)
  const Lt = trackLength(setup, p)
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const truss = setup === 'truss'
  const sx = supportsX(setup, p)
  const out: Layout = { view: v, load: null, section: null, segs: [] }
  const maxAbs = Math.max(o.stats.max, -o.stats.min, 1e-9)
  const mbOn = o.mb && !truss
  const kMB = 46 / maxAbs

  // ---- struktur ----
  if (truss) {
    const g = trussGeom(p)
    const Y = (y: number) => v.yS - y * v.s
    // potongan Ritter: batang terpotong diberi arsir tipis, garis potong melalui titik tengahnya
    const cutSet = new Set(o.ritter?.cut ?? [])
    g.frame.members.forEach((m, mi) => {
      const A = g.frame.nodes[m.i]
      const B = g.frame.nodes[m.j]
      const x1 = XS(v, A.x)
      const y1 = Y(A.y)
      const x2 = XS(v, B.x)
      const y2 = Y(B.y)
      out.segs.push({ m: mi, x1, y1, x2, y2 })
      const sel = mi === p.mem && o.resp === 'N'
      ctx.strokeStyle = sel ? HI : mi === o.hoverMember ? C.green : cutSet.has(mi) && o.resp === 'N' ? C.navy : C.ink
      ctx.lineWidth = sel ? 5 : mi === o.hoverMember ? 3.5 : 2.2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    })
    for (const nd of g.frame.nodes) {
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = C.ink
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(XS(v, nd.x), Y(nd.y), 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    const sel = g.frame.members[p.mem]
    if (sel && o.resp === 'N') {
      const A = g.frame.nodes[sel.i]
      const B = g.frame.nodes[sel.j]
      label(ctx, g.names[p.mem], (XS(v, A.x) + XS(v, B.x)) / 2, (Y(A.y) + Y(B.y)) / 2 - (A.y === B.y ? 12 : 0), HI, 'center', true)
      // garis potong
      if (o.ritter) {
        const mids = o.ritter.cut.map((mi) => {
          const m = g.frame.members[mi]
          const a = g.frame.nodes[m.i]
          const b = g.frame.nodes[m.j]
          return { x: XS(v, (a.x + b.x) / 2), y: Y((a.y + b.y) / 2) }
        })
        mids.sort((a, b) => a.y - b.y)
        ctx.save()
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = C.navy
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(mids[0].x, mids[0].y - 18)
        for (const m of mids) ctx.lineTo(m.x, m.y)
        ctx.lineTo(mids[mids.length - 1].x, mids[mids.length - 1].y + 18)
        ctx.stroke()
        ctx.restore()
        if (o.ritter.O) {
          const ox = XS(v, o.ritter.O.x)
          const oy = Y(o.ritter.O.y)
          ctx.fillStyle = C.navy
          ctx.beginPath()
          ctx.arc(ox, oy, 5, 0, Math.PI * 2)
          ctx.fill()
          label(ctx, 'O', ox - 12, oy - 10, C.navy, 'center', true)
        }
      }
    }
  } else {
    // balok (asli: putus-putus bila Müller–Breslau aktif)
    ctx.save()
    if (mbOn) {
      ctx.setLineDash([6, 5])
      ctx.strokeStyle = '#b9b6aa'
      ctx.lineWidth = 2
    } else {
      ctx.strokeStyle = C.ink
      ctx.lineWidth = 4
    }
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(XS(v, 0), v.yS)
    ctx.lineTo(XS(v, Lt), v.yS)
    ctx.stroke()
    ctx.restore()
  }

  // tumpuan + label reaksi
  sx.forEach((x, i) => {
    const sel = o.resp === `R${i}`
    const lift = mbOn && sel ? -kMB * 1 : 0
    drawPin(ctx, XS(v, x), v.yS + lift, i > 0, sel ? HI : C.ink)
    label(ctx, `${supLabel(i)}`, XS(v, x), v.yS + 46, sel ? HI : C.mute, 'center', sel)
  })

  // Müller–Breslau: balok dideformasi mengikuti garis pengaruh
  if (mbOn) {
    ctx.strokeStyle = HI
    ctx.lineWidth = 3.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let prevX = NaN
    for (const [x, y] of o.curve) {
      const X = XS(v, x)
      const Y = v.yS - y * kMB
      // loncatan geser: jangan sambung garis vertikal
      if (o.resp === 'V' && Math.abs(x - p.xs) < 1e-9 && X === prevX) ctx.moveTo(X, Y)
      else if (Number.isNaN(prevX)) ctx.moveTo(X, Y)
      else ctx.lineTo(X, Y)
      prevX = X
    }
    ctx.stroke()
    const xs = XS(v, p.xs)
    if (o.resp === 'M') {
      const y = v.yS - o.eta(p.xs) * kMB
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = HI
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(xs, y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      label(ctx, 'Müller–Breslau: sendi di potongan + rotasi relatif 1', 10, 16, HI, 'left', true)
    } else if (o.resp === 'V') {
      const yl = v.yS - o.eta(p.xs) * kMB
      const yr = v.yS - o.eta(p.xs + Lt * 1e-6) * kMB
      ctx.strokeStyle = HI
      ctx.lineWidth = 2
      for (const dx of [-3, 3]) {
        ctx.beginPath()
        ctx.moveTo(xs + dx, Math.min(yl, yr) - 6)
        ctx.lineTo(xs + dx, Math.max(yl, yr) + 6)
        ctx.stroke()
      }
      label(ctx, 'Müller–Breslau: potongan digeser relatif 1 (sudut kedua sisi sama)', 10, 16, HI, 'left', true)
    } else {
      const i = Number(o.resp.slice(1))
      label(ctx, `Müller–Breslau: tumpuan ${supLabel(i)} dilepas dan diangkat 1`, 10, 16, HI, 'left', true)
    }
  }

  // potongan V/M
  if (!truss && (o.resp === 'V' || o.resp === 'M')) {
    const x = XS(v, p.xs)
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = HI
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, v.yS - 22)
    ctx.lineTo(x, v.yS + 24)
    ctx.stroke()
    ctx.restore()
    const hy = v.yS + 30
    ctx.fillStyle = HI
    ctx.beginPath()
    ctx.moveTo(x, hy - 7)
    ctx.lineTo(x - 7, hy + 5)
    ctx.lineTo(x + 7, hy + 5)
    ctx.closePath()
    ctx.fill()
    out.section = { x, y: hy }
    label(ctx, `potongan x = ${fmt(p.xs, 2)} m`, x + 10, hy + 2, HI, 'left')
  }

  // ---- beban berjalan ----
  if (o.veh === 'satuan') {
    const x = XS(v, o.pos)
    const y0 = v.yS - 54
    arrow(ctx, x, y0, x, v.yS - 3, HI, 3)
    label(ctx, '1 kN', x, y0 - 10, HI, 'center', true)
    out.load = { x0: x - 16, x1: x + 16, y0: y0 - 20, y1: v.yS + 4 }
  } else if (o.veh === 'truk') {
    out.load = drawTruck(ctx, v, o.pos, o.axles, v.yS - (truss ? 0 : 2))
  } else drawLajur(ctx, v, o, v.yS - (truss ? 0 : 2))

  // dimensi bentang
  ctx.font = FONT
  ctx.fillStyle = C.mute
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const dimY = v.yS + 60
  const pts = truss ? [0, Lt] : [...new Set([0, ...sx, Lt])].sort((a, b) => a - b)
  ctx.strokeStyle = '#c9c6ba'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(XS(v, pts[0]), dimY)
  ctx.lineTo(XS(v, pts[pts.length - 1]), dimY)
  for (const x of pts) {
    ctx.moveTo(XS(v, x), dimY - 4)
    ctx.lineTo(XS(v, x), dimY + 4)
  }
  ctx.stroke()
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k]
    const b = pts[k + 1]
    if ((b - a) * v.s > 34) label(ctx, `${fmt(b - a, 1)} m`, XS(v, (a + b) / 2), dimY, C.mute)
  }

  drawIL(ctx, v, w, o)
  return out
}

// ---------- garis pengaruh ----------

function drawIL(ctx: Ctx, v: View, w: number, o: DrawOpts) {
  const { setup, p } = o
  const Lt = trackLength(setup, p)
  const X0 = XS(v, 0)
  const X1 = XS(v, Lt)
  const Y = (eta: number) => v.yIL - eta * v.k

  // isian luas + / −
  for (const sign of [1, -1] as const) {
    ctx.fillStyle = sign > 0 ? 'rgba(13,48,75,0.11)' : 'rgba(181,69,47,0.11)'
    ctx.beginPath()
    ctx.moveTo(X0, v.yIL)
    for (const [x, y] of o.curve) ctx.lineTo(XS(v, x), Y(sign > 0 ? Math.max(0, y) : Math.min(0, y)))
    ctx.lineTo(X1, v.yIL)
    ctx.closePath()
    ctx.fill()
  }
  // sumbu
  ctx.strokeStyle = C.mute
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(X0, v.yIL)
  ctx.lineTo(X1, v.yIL)
  ctx.stroke()
  // garis bantu vertikal di tumpuan
  ctx.save()
  ctx.setLineDash([2, 4])
  ctx.strokeStyle = '#d8d5cb'
  for (const x of supportsX(setup, p)) {
    ctx.beginPath()
    ctx.moveTo(XS(v, x), v.yS + 26)
    ctx.lineTo(XS(v, x), v.yIL + 4)
    ctx.stroke()
  }
  ctx.restore()

  // teori
  ctx.strokeStyle = C.green
  ctx.lineWidth = 2.2
  ctx.lineJoin = 'round'
  ctx.beginPath()
  o.curve.forEach(([x, y], i) => (i ? ctx.lineTo(XS(v, x), Y(y)) : ctx.moveTo(XS(v, x), Y(y))))
  ctx.stroke()

  // terukur (solver kekakuan)
  ctx.fillStyle = POS
  for (const [x, y] of o.trace) {
    ctx.beginPath()
    ctx.arc(XS(v, x), Y(y), 2.6, 0, Math.PI * 2)
    ctx.fill()
  }

  // label maks/min
  const st = o.stats
  if (st.max > 1e-9) label(ctx, `+${fmt(st.max, 3)}`, XS(v, st.xMax), Y(st.max) - 11, POS, 'center', true)
  if (st.min < -1e-9) label(ctx, fmt(st.min, 3), XS(v, st.xMin), Y(st.min) + 12, NEG, 'center', true)

  // judul sumbu
  const unit = respUnit(o.resp)
  label(ctx, `garis pengaruh ${respLabel(setup, p, o.resp)}${unit === 'm' ? ' (kN·m per kN = m)' : ' (per kN)'}`, 10, v.yS + 80, C.ink, 'left', true)

  // posisi beban saat ini
  const marks: { x: number; P?: number }[] = o.veh === 'satuan' ? [{ x: o.pos }] : o.veh === 'truk' ? o.axles.map((a) => ({ x: o.pos + a.off, P: a.P })) : []
  for (const m of marks) {
    if (m.x < -1e-9 || m.x > Lt + 1e-9) continue
    const e = o.eta(m.x)
    const x = XS(v, m.x)
    ctx.save()
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(237,141,59,0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, v.yS + 4)
    ctx.lineTo(x, Y(e))
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = HI
    ctx.beginPath()
    ctx.arc(x, Y(e), 5, 0, Math.PI * 2)
    ctx.fill()
    if (o.veh === 'satuan' || w > 520) label(ctx, `η = ${fmt(e, 3)}`, x + 8, Y(e) + (e >= 0 ? 14 : -14), HI, 'left')
  }
}

// ---------- hit test ----------

export function hitLoad(l: Layout, x: number, y: number) {
  const b = l.load
  return !!b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
}
export function hitSection(l: Layout, x: number, y: number) {
  const s = l.section
  return !!s && Math.hypot(x - s.x, y - s.y) < 13
}
export function hitMember(l: Layout, x: number, y: number): number | null {
  let best: number | null = null
  let bd = 9
  for (const s of l.segs) {
    const dx = s.x2 - s.x1
    const dy = s.y2 - s.y1
    const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy || 1)))
    const d = Math.hypot(x - (s.x1 + t * dx), y - (s.y1 + t * dy))
    if (d < bd) {
      bd = d
      best = s.m
    }
  }
  return best
}
export const xFromScreen = (l: Layout, sx: number) => (sx - l.view.ox) / l.view.s
