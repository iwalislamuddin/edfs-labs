// Grafik bawah Room Hydrostatic: p terhadap ketinggian (Tekanan), F & P serta letak pusat tekanan terhadap muka air
// (Pintu Bidang), FH/FV/R dan momen terhadap pusat vs ambang (Permukaan Lengkung).
import { chart, fmt, type Dot, type Mark, type Series } from '../../lab/chart'
import { C } from '../../lab/theme'
import { pressure } from './hydro'
import { layers, type Params, type Setup } from './model'
import { COL } from './stage'

type Ctx = CanvasRenderingContext2D

export interface ProbeDot {
  d: number
  p: number // Pa, terukur (integrasi kolom)
}

/** Kurva yang mahal dihitung di komponen (useMemo) dan diteruskan ke sini. */
export interface GateCurves {
  h: number[]
  F: number[]
  P: number[]
  sp: number[]
  hOpen: number | null
  sc: number
  L: number
  meas: { F: number; P: number; sp: number }
}
export interface CurvedCurves {
  H: number[]
  FH: number[]
  FV: number[]
  R: number[]
  Mc: number[]
  Mo: number[]
  meas: { FH: number; FV: number; Mc: number; Mo: number }
}

export interface ChartState {
  setup: Setup
  p: Params
  dots: ProbeDot[]
  gate: GateCurves | null
  curved: CurvedCurves | null
}

const range = (vals: number[], pad = 0.08, zero = true): [number, number] => {
  let lo = Math.min(...vals, zero ? 0 : Infinity)
  let hi = Math.max(...vals, zero ? 0 : -Infinity)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (hi - lo < 1e-9) hi = lo + 1
  const d = (hi - lo) * pad
  return [lo - (lo < 0 ? d : 0), hi + d]
}

export function drawChart(ctx: Ctx, w: number, h: number, S: ChartState) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const two = w >= 640
  const wl = two ? Math.floor(w * 0.56) : w
  if (S.setup === 'tekanan') {
    const p = S.p
    const Ls = layers(p)
    const Ht = p.h1 + p.h2
    const pts: [number, number][] = []
    for (let i = 0; i <= 120; i++) {
      const d = (Ht * i) / 120
      pts.push([pressure(p.p0 * 1e3, Ls, p.g, d) / 1e3, Ht - d])
    }
    const xs = pts.map((q) => q[0])
    const dots: Dot[] = S.dots.map((d) => ({ x: d.p / 1e3, y: Ht - d.d, color: COL.meas, r: 3.5 }))
    const pc = pressure(p.p0 * 1e3, Ls, p.g, p.pd) / 1e3
    dots.push({ x: pc, y: Ht - p.pd, color: C.orange, r: 5, label: `${fmt(pc, 2)} kPa` })
    const hmarks: Mark[] = [{ v: Ht, color: COL.waterEdge, label: 'muka' }]
    if (p.h1 > 1e-9) hmarks.push({ v: p.h2, color: COL.oilEdge, label: 'antarmuka' })
    chart(ctx, 0, 0, w, h, {
      x: range([...xs, ...dots.map((d) => d.x)]),
      y: [0, Math.max(Ht * 1.08, 0.5)],
      xlabel: 'tekanan relatif p (kPa)',
      ylabel: 'tinggi dari dasar z (m)',
      series: [{ pts, color: COL.p, label: 'p = p₀ + Σρgh' }],
      vmarks: [{ v: 0, color: C.mute }],
      hmarks,
      dots,
    })
    return
  }
  if (S.setup === 'pintu' && S.gate) {
    const G = S.gate
    const p = S.p
    const kN = (a: number[]) => a.map((x) => x / 1e3)
    const F = kN(G.F)
    const P = kN(G.P)
    const series: Series[] = [
      { pts: G.h.map((x, i) => [x, F[i]]), color: COL.force, label: 'F hulu' },
      { pts: G.h.map((x, i) => [x, P[i]]), color: C.green, label: 'P penahan' },
    ]
    const vmarks: Mark[] = [{ v: p.hu, color: C.orange }]
    if (G.hOpen !== null) vmarks.push({ v: G.hOpen, color: C.red, label: `buka ${fmt(G.hOpen, 2)} m` })
    chart(ctx, 0, 0, wl, h, {
      x: [0, G.h[G.h.length - 1]],
      y: range([...F, ...P]),
      xlabel: 'muka air hulu h₁ (m)',
      ylabel: 'gaya (kN)',
      series,
      vmarks,
      hmarks: [{ v: 0, color: C.mute }],
      dots: [
        { x: p.hu, y: G.meas.F / 1e3, color: COL.meas, r: 4.5 },
        { x: p.hu, y: G.meas.P / 1e3, color: COL.meas, r: 4.5 },
      ],
    })
    if (!two) return
    // tinggi pusat tekanan di atas tepi bawah, sepanjang pintu
    const up = (s: number) => G.L - s
    const pts: [number, number][] = []
    G.h.forEach((x, i) => {
      if (G.F[i] > 0) pts.push([x, up(G.sp[i])])
    })
    const hmarks: Mark[] = [{ v: up(G.sc), color: C.ink, label: 'G pintu' }]
    if (p.hinge === 'poros') hmarks.push({ v: up(p.piv * G.L), color: C.red, label: 'poros' })
    chart(ctx, wl, 0, w - wl, h, {
      x: [0, G.h[G.h.length - 1]],
      y: [0, G.L],
      xlabel: 'h₁ (m)',
      ylabel: 'letak CP dari tepi bawah (m)',
      series: [{ pts, color: COL.cp, label: 'pusat tekanan' }],
      vmarks: [{ v: p.hu, color: C.orange }],
      hmarks,
      dots: G.meas.F > 0 ? [{ x: p.hu, y: up(G.meas.sp), color: COL.meas, r: 4.5 }] : [],
    })
    return
  }
  if (S.setup === 'lengkung' && S.curved) {
    const K = S.curved
    const p = S.p
    const kN = (a: number[]) => a.map((x) => x / 1e3)
    const FH = kN(K.FH)
    const FV = kN(K.FV)
    const R = kN(K.R)
    chart(ctx, 0, 0, wl, h, {
      x: [0, K.H[K.H.length - 1]],
      y: range([...FH, ...FV, ...R]),
      xlabel: 'muka air H (m)',
      ylabel: 'gaya (kN)',
      series: [
        { pts: K.H.map((x, i) => [x, FH[i]]), color: COL.p, label: 'FH' },
        { pts: K.H.map((x, i) => [x, FV[i]]), color: C.orange, label: 'FV' },
        { pts: K.H.map((x, i) => [x, R[i]]), color: COL.force, label: 'R' },
      ],
      vmarks: [{ v: p.H, color: C.mute }],
      dots: [
        { x: p.H, y: K.meas.FH / 1e3, color: COL.meas, r: 4.5 },
        { x: p.H, y: K.meas.FV / 1e3, color: COL.meas, r: 4.5 },
      ],
    })
    if (!two) return
    const Mc = kN(K.Mc)
    const Mo = kN(K.Mo)
    chart(ctx, wl, 0, w - wl, h, {
      x: [0, K.H[K.H.length - 1]],
      y: range([...Mc, ...Mo]),
      xlabel: 'H (m)',
      ylabel: 'momen air (kN·m)',
      series: [
        { pts: K.H.map((x, i) => [x, Mo[i]]), color: C.steel, label: 'thd ambang' },
        { pts: K.H.map((x, i) => [x, Mc[i]]), color: COL.force, label: 'thd pusat O' },
      ],
      vmarks: [{ v: p.H, color: C.mute }],
      hmarks: [{ v: 0, color: C.mute }],
      dots: [
        { x: p.H, y: K.meas.Mc / 1e3, color: COL.meas, r: 4.5 },
        { x: p.H, y: K.meas.Mo / 1e3, color: COL.meas, r: 4.5 },
      ],
    })
  }
}
