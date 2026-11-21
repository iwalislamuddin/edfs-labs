// Grafik bawah Room Buckling: Pcr–L (Euler), P–δ + Southwell (Imperfeksi), σcr–KL/r (Kurva Kolom), P/Pcr–δ (Elastica).
import { C } from '../../lab/theme'
import { elasticaRatio, elasticaTheory, fitLine, imperfectTheory, pcr, perry, sniFcr, sniLimit, SUPPORTS, type Support } from './buckling'
import { fmt } from './stage'
import { chart, type Dot, type Series } from '../../lab/chart'

type Ctx = CanvasRenderingContext2D

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
