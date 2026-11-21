// Grafik bawah Room Buckling: Pcr–L (Euler), P–δ + Southwell (Imperfeksi), σcr–KL/r (Kurva Kolom), P/Pcr–δ (Elastica).
import { C, FONT, FONT_B } from '../../lab/theme'
import { elasticaRatio, elasticaTheory, fitLine, imperfectTheory, pcr, perry, sniFcr, sniLimit, SUPPORTS, type Support } from './buckling'
import { fmt } from './stage'

type Ctx = CanvasRenderingContext2D

interface Series {
  pts: [number, number][]
  color: string
  label?: string
  width?: number
  dash?: number[]
}
interface Mark {
  v: number
  color: string
  label?: string
}
interface Dot {
  x: number
  y: number
  color: string
  label?: string
  r?: number
}
interface ChartOpts {
  x: [number, number]
  y: [number, number]
  xlabel: string
  ylabel: string
  series: Series[]
  vmarks?: Mark[]
  hmarks?: Mark[]
  dots?: Dot[]
  title?: string
}

function niceStep(span: number, n: number) {
  const raw = span / n
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}
const dec = (step: number) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)))

function chart(ctx: Ctx, rx: number, ry: number, w: number, h: number, o: ChartOpts) {
  const L = 54
  const R = 12
  const T = o.title ? 38 : 24
  const B = 34
  const pw = w - L - R
  const ph = h - T - B
  const [x0, x1] = o.x
  const [y0, y1] = o.y
  const px = (x: number) => rx + L + ((x - x0) / (x1 - x0)) * pw
  const py = (y: number) => ry + T + ((y1 - y) / (y1 - y0)) * ph

  ctx.font = FONT
  ctx.lineWidth = 1
  const sx = niceStep(x1 - x0, Math.max(3, Math.floor(pw / 70)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(px(x), ry + T)
    ctx.lineTo(px(x), ry + T + ph)
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(fmt(x, dec(sx)), px(x), ry + T + ph + 4)
  }
  const sy = niceStep(y1 - y0, 5)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) {
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    ctx.moveTo(rx + L, py(y))
    ctx.lineTo(rx + L + pw, py(y))
    ctx.stroke()
    ctx.fillStyle = C.mute
    ctx.fillText(fmt(y, dec(sy)), rx + L - 6, py(y))
  }
  ctx.strokeStyle = C.mute
  ctx.strokeRect(rx + L, ry + T, pw, ph)
  ctx.fillStyle = C.mute
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(o.xlabel, rx + L + pw, ry + T + ph + 18)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(o.ylabel, rx + 4, ry + T - 4)
  if (o.title) {
    ctx.font = FONT_B
    ctx.fillStyle = C.ink
    ctx.textBaseline = 'top'
    ctx.fillText(o.title, rx + 4, ry + 2)
    ctx.font = FONT
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(rx + L, ry + T, pw, ph)
  ctx.clip()
  for (const m of o.vmarks ?? []) {
    ctx.strokeStyle = m.color
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(px(m.v), ry + T)
    ctx.lineTo(px(m.v), ry + T + ph)
    ctx.stroke()
  }
  for (const m of o.hmarks ?? []) {
    ctx.strokeStyle = m.color
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(rx + L, py(m.v))
    ctx.lineTo(rx + L + pw, py(m.v))
    ctx.stroke()
  }
  for (const s of o.series) {
    if (s.pts.length < 2) continue
    ctx.setLineDash(s.dash ?? [])
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width ?? 2
    ctx.beginPath()
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (const d of o.dots ?? []) {
    ctx.fillStyle = d.color
    ctx.beginPath()
    ctx.arc(px(d.x), py(d.y), d.r ?? 4, 0, 2 * Math.PI)
    ctx.fill()
  }
  ctx.restore()
  ctx.textBaseline = 'middle'
  for (const m of o.vmarks ?? []) {
    if (!m.label) continue
    ctx.fillStyle = m.color
    ctx.textAlign = 'left'
    ctx.fillText(m.label, px(m.v) + 4, ry + T + 9)
  }
  for (const m of o.hmarks ?? []) {
    if (!m.label || m.v > y1 || m.v < y0) continue
    ctx.fillStyle = m.color
    ctx.textAlign = 'right'
    ctx.fillText(m.label, rx + L + pw - 4, py(m.v) - 8)
  }
  for (const d of o.dots ?? []) {
    if (!d.label) continue
    ctx.fillStyle = d.color
    ctx.textAlign = 'left'
    ctx.fillText(d.label, px(d.x) + 7, py(d.y) - 9)
  }
  // legenda
  ctx.font = FONT_B
  const items = o.series.filter((s) => s.label)
  let lx = rx + L + pw
  ctx.textAlign = 'left'
  for (let i = items.length - 1; i >= 0; i--) {
    const s = items[i]
    const tw = ctx.measureText(s.label!).width + 30
    lx -= tw
    const yy = ry + T - 10 - (o.title ? 0 : 0)
    ctx.fillStyle = s.color
    ctx.fillRect(lx, yy - 1, 12, 3)
    ctx.fillText(s.label!, lx + 16, yy)
  }
}

export interface ChartState {
  setup: 'euler' | 'imperfeksi' | 'kurva' | 'elastica'
  sup: Support
  EI: number // N·mm²
  L: number // mm
  A: number
  S: number
  r: number
  c: number
  E: number // MPa
  fy: number
  P: number // N
  Pcr: number
  K: number // dipakai di Kurva Kolom
  e0: number
  e: number
  pts: { P: number; d: number }[]
  Py: number | null // leleh pertama teori
  ratio: number // elastica
  ela: { d: number; short: number } | null
}

export function drawChart(ctx: Ctx, w: number, h: number, st: ChartState) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  if (st.setup === 'euler') return eulerChart(ctx, w, h, st)
  if (st.setup === 'imperfeksi') return imperfChart(ctx, w, h, st)
  if (st.setup === 'kurva') return curveChart(ctx, w, h, st)
  return elasticaChart(ctx, w, h, st)
}

const SUP_COL: Record<Support, string> = { sendi: C.navy, 'jepit-bebas': C.red, 'jepit-sendi': C.green, jepit: '#661465' }

function eulerChart(ctx: Ctx, w: number, h: number, st: ChartState) {
  const Lm = st.L / 1000
  const xMax = Math.max(4, Math.ceil(Lm * 2))
  const squash = (st.A * st.fy) / 1e3
  const yMax = Math.max(squash, st.P / 1e3, (st.Pcr / 1e3) * 1.3) * 1.25
  const series: Series[] = SUPPORTS.map((s) => {
    const pts: [number, number][] = []
    for (let i = 1; i <= 200; i++) {
      const L = (xMax * i) / 200
      pts.push([L, pcr(s.id, st.EI, L * 1000) / 1e3])
    }
    return { pts, color: SUP_COL[s.id], label: s.label, width: s.id === st.sup ? 3 : 1.4 }
  })
  const dots: Dot[] = SUPPORTS.map((s) => ({ x: Lm, y: pcr(s.id, st.EI, st.L) / 1e3, color: SUP_COL[s.id], r: s.id === st.sup ? 5 : 3 }))
  dots.find((_, i) => SUPPORTS[i].id === st.sup)!.label = `Pcr = ${fmt(st.Pcr / 1e3, 1)} kN`
  chart(ctx, 0, 0, w, h, {
    x: [0, xMax],
    y: [0, yMax],
    xlabel: 'panjang kolom L (m)',
    ylabel: 'Pcr (kN)',
    series,
    vmarks: [{ v: Lm, color: C.mute }],
    hmarks: [
      { v: squash, color: C.mute, label: `A·fy = ${fmt(squash, 0)} kN (leleh penampang)` },
      ...(st.P > 0 ? [{ v: st.P / 1e3, color: C.orange, label: `P = ${fmt(st.P / 1e3, 1)} kN` }] : []),
    ],
    dots,
  })
}

function imperfChart(ctx: Ctx, w: number, h: number, st: ChartState) {
  const wide = w > 640
  const cw = wide ? w / 2 : w
  const ch = wide ? h : h / 2
  const P1 = st.Pcr / 1e3
  // kurva teori P–δ
  const th: [number, number][] = []
  const avail = !(st.sup === 'jepit-sendi' && st.e > 0)
  if (avail)
    for (let i = 0; i <= 120; i++) {
      const P = (st.Pcr * 0.985 * i) / 120
      th.push([imperfectTheory(st.sup, st.EI, st.L, P, st.e0, st.e).d, P / 1e3])
    }
  const ds = st.pts.map((q) => q.d)
  const dMax = Math.max(1, ...ds, (st.e0 + st.e) * 12) * 1.05
  const dots: Dot[] = st.pts.map((q) => ({ x: q.d, y: q.P / 1e3, color: C.green, r: 3.5 }))
  chart(ctx, 0, 0, cw, ch, {
    title: 'Beban – lendutan tambahan',
    x: [0, dMax],
    y: [0, P1 * 1.15],
    xlabel: 'δ (mm)',
    ylabel: 'P (kN)',
    series: [{ pts: th, color: C.navy, label: 'teori' }],
    hmarks: [
      { v: P1, color: C.red, label: `Pcr = ${fmt(P1, 1)} kN` },
      ...(st.Py ? [{ v: st.Py / 1e3, color: C.orange, label: `leleh pertama ${fmt(st.Py / 1e3, 1)} kN` }] : []),
    ],
    dots: [...dots, { x: 0, y: st.P / 1e3, color: C.orange, r: 4 }],
  })
  // Southwell
  const use = st.pts.filter((q) => q.P > 0 && q.d > 1e-9)
  const xs = use.map((q) => q.d / (q.P / 1e3))
  const ys = use.map((q) => q.d)
  const f = fitLine(xs, ys)
  const xM = Math.max(1e-3, ...xs) * 1.15
  const yM = Math.max(1, ...ys) * 1.15
  const line: [number, number][] = f ? [[0, f.b], [xM, f.a * xM + f.b]] : []
  chart(ctx, wide ? cw : 0, wide ? 0 : ch, cw, ch, {
    title: f ? `Southwell: kemiringan = Pcr ≈ ${fmt(f.a, 1)} kN` : 'Southwell (δ terhadap δ/P) — jalankan uji tekan',
    x: [0, xM],
    y: [Math.min(0, f ? f.b : 0), yM],
    xlabel: 'δ/P (mm/kN)',
    ylabel: 'δ (mm)',
    series: [{ pts: line, color: C.red, label: f ? 'garis kuadrat terkecil' : undefined, dash: [6, 4] }],
    dots: use.map((_, i) => ({ x: xs[i], y: ys[i], color: C.green, r: 3.5 })),
  })
}

function curveChart(ctx: Ctx, w: number, h: number, st: ChartState) {
  const lam = (st.K * st.L) / st.r
  const xMax = Math.max(220, Math.ceil(lam / 20) * 20 + 20)
  const eu: [number, number][] = []
  const sni: [number, number][] = []
  const phi: [number, number][] = []
  const pr: [number, number][] = []
  const eta = (l: number) => (l * st.c) / (1000 * st.r)
  for (let i = 1; i <= 300; i++) {
    const l = (xMax * i) / 300
    eu.push([l, (Math.PI ** 2 * st.E) / (l * l)])
    const f = sniFcr(l, st.E, st.fy).Fcr
    sni.push([l, f])
    phi.push([l, 0.9 * f])
    pr.push([l, perry(l, st.E, st.fy, eta(l))])
  }
  const cur = sniFcr(lam, st.E, st.fy)
  chart(ctx, 0, 0, w, h, {
    x: [0, xMax],
    y: [0, st.fy * 1.2],
    xlabel: 'kelangsingan KL/r',
    ylabel: 'σ (MPa)',
    series: [
      { pts: eu, color: C.mute, label: 'Euler π²E/(KL/r)²', dash: [6, 4] },
      { pts: pr, color: C.green, label: 'Perry–Robertson e0 = Le/1000' },
      { pts: sni, color: C.navy, label: 'SNI 1729 Fcr', width: 2.5 },
      { pts: phi, color: C.navy, label: 'φc·Fcr', width: 1, dash: [2, 3] },
    ],
    vmarks: [
      { v: sniLimit(st.E, st.fy), color: C.orange, label: '4,71√(E/fy)' },
      { v: 200, color: C.red, label: 'batas 200' },
    ],
    hmarks: [{ v: st.fy, color: C.mute, label: `fy = ${fmt(st.fy, 0)} MPa` }],
    dots: [{ x: lam, y: cur.Fcr, color: C.orange, r: 5, label: `KL/r = ${fmt(lam, 1)} · Fcr = ${fmt(cur.Fcr, 0)} MPa` }],
  })
}

function elasticaChart(ctx: Ctx, w: number, h: number, st: ChartState) {
  const dpts: [number, number][] = [[0, 0], [0, 1]]
  const spts: [number, number][] = [[0, 0], [0, 1]]
  for (let i = 1; i <= 300; i++) {
    const k = Math.sin(((i / 300) * 0.985 * Math.PI) / 2)
    const r = elasticaRatio(k)
    if (r > 4) break
    const t = elasticaTheory(st.sup, k)
    dpts.push([t.d, r])
    spts.push([t.short, r])
  }
  const dots: Dot[] = []
  if (st.ela && st.ela.d > 0) {
    dots.push({ x: st.ela.d, y: st.ratio, color: C.orange, r: 5, label: 'δ/L (RK4)' })
    dots.push({ x: st.ela.short, y: st.ratio, color: C.green, r: 5, label: 'Δ/L (RK4)' })
  } else dots.push({ x: 0, y: st.ratio, color: C.orange, r: 5, label: st.ratio < 1 ? 'lurus (stabil)' : '' })
  chart(ctx, 0, 0, w, h, {
    x: [0, st.sup === 'jepit-bebas' ? 2 : 1.4],
    y: [0, Math.max(3, st.ratio + 0.3)],
    xlabel: 'lendutan δ/L · perpendekan Δ/L',
    ylabel: 'P/Pcr',
    series: [
      { pts: dpts, color: C.orange, label: 'δ/L (eliptik)' },
      { pts: spts, color: C.green, label: 'Δ/L (eliptik)' },
    ],
    hmarks: [{ v: 1, color: C.mute, label: 'teori linear: netral di Pcr' }],
    dots,
  })
}
