// Grafik Room Tensile Test: σ–ε penuh + perbesaran daerah elastis/leleh, kurva sebenarnya, siklus bongkar–muat,
// perbandingan material + batang ketangguhan, beton tekan (Popovics/Hognestad + modulus chord) dan belah.
import { chart, fmt, type Dot, type Series } from '../../lab/chart'
import { C, FONT, FONT_B } from '../../lab/theme'
import { chordModulus, concreteEc, hognestad, popovics, splitStress, type Measured, type Steel } from './material'

type Ctx = CanvasRenderingContext2D
type XY = [number, number]

const pct = (pts: XY[]): XY[] => pts.map(([e, s]) => [e * 100, s])

export interface SteelChart {
  m: Steel
  theory: XY[]
  data: XY[]
  trueData: XY[]
  trueTheory: XY[]
  showTrue: boolean
  cur: XY
  meas: Measured
  eF: number
  zoomE: number
}

export function drawSteelChart(ctx: Ctx, w: number, h: number, st: SteelChart) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const split = w > 560
  const wl = split ? w * 0.6 : w
  const { m, meas } = st
  const ymax = Math.max(m.fu, ...(st.showTrue ? st.trueTheory.map((p) => p[1]) : [0]), meas.Rm ?? 0) * 1.12
  const series: Series[] = [{ pts: pct(st.theory), color: C.greenSoft, width: 1.5, dash: [5, 4], label: 'model' }]
  if (st.showTrue) {
    series.push({ pts: pct(st.trueTheory), color: '#f2c39a', width: 1.5, dash: [5, 4] })
    series.push({ pts: pct(st.trueData), color: C.orange, width: 2, label: 'sebenarnya (true)' })
  }
  series.push({ pts: pct(st.data), color: C.navy, width: 2, label: 'data uji (teknik)' })
  const dots: Dot[] = [{ x: st.cur[0] * 100, y: st.cur[1], color: C.red, r: 5 }]
  const hm = []
  if (meas.Rm) hm.push({ v: meas.Rm, color: C.red, label: `Rm ${fmt(meas.Rm, 0)}` })
  const yl = meas.ReL ?? meas.Rp02
  if (yl) hm.push({ v: yl, color: C.green, label: `${meas.ReL ? 'ReL' : 'Rp0,2'} ${fmt(yl, 0)}` })
  chart(ctx, 0, 0, wl, h, {
    x: [0, Math.max(st.eF, st.cur[0]) * 105],
    y: [0, ymax],
    xlabel: 'regangan ε (%)',
    ylabel: 'tegangan σ (MPa)',
    series,
    dots,
    hmarks: hm,
  })
  if (!split) return
  // perbesaran: elastis, leleh atas/bawah, garis offset 0,2%
  const ez = st.zoomE
  const zs: Series[] = [{ pts: pct(st.theory.filter((p) => p[0] <= ez * 1.05)), color: C.greenSoft, width: 1.5, dash: [5, 4] }]
  const E = meas.E ?? m.E
  const top = Math.max(...st.theory.filter((p) => p[0] <= ez).map((p) => p[1])) * 1.15
  zs.push({ pts: [[0, 0], [(top / E) * 100, top]], color: C.mute, width: 1, dash: [2, 3] })
  zs.push({ pts: [[0.2, 0], [(top / E + 0.002) * 100, top]], color: C.green, width: 1, dash: [6, 3], label: 'offset 0,2%' })
  zs.push({ pts: pct(st.data.filter((p) => p[0] <= ez * 1.05)), color: C.navy, width: 2 })
  const zd: Dot[] = []
  if (st.cur[0] <= ez) zd.push({ x: st.cur[0] * 100, y: st.cur[1], color: C.red, r: 4 })
  if (meas.Rp02 && !meas.ReH) zd.push({ x: (meas.Rp02 / E + 0.002) * 100, y: meas.Rp02, color: C.green, r: 4, label: 'Rp0,2' })
  if (meas.ReH) zd.push({ x: (meas.ReH / E) * 100, y: meas.ReH, color: C.red, r: 4, label: 'ReH' })
  chart(ctx, wl + 8, 0, w - wl - 8, h, {
    x: [0, ez * 100],
    y: [0, top],
    xlabel: 'ε (%) — perbesaran',
    ylabel: 'σ (MPa)',
    series: zs,
    dots: zd,
    title: meas.E ? `E terukur = ${fmt(meas.E / 1000, 1)} GPa` : 'kemiringan awal = E',
  })
}

// ---------- perbandingan ----------

export interface CompareItem {
  label: string
  color: string
  curve: XY[]
  U: number
  A: number
  selected: boolean
}

export function drawCompareChart(ctx: Ctx, w: number, h: number, list: CompareItem[]) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const split = w > 560
  const wl = split ? w * 0.62 : w
  const xmax = Math.max(...list.map((x) => x.curve[x.curve.length - 1][0])) * 105
  const ymax = Math.max(...list.map((x) => Math.max(...x.curve.map((p) => p[1])))) * 1.1
  chart(ctx, 0, 0, wl, h, {
    x: [0, xmax],
    y: [0, ymax],
    xlabel: 'regangan ε (%)',
    ylabel: 'σ (MPa)',
    series: list.map((x) => ({ pts: pct(x.curve), color: x.color, width: x.selected ? 3 : 1.6 })),
    dots: list.map((x) => {
      const [e, s] = x.curve[x.curve.length - 1]
      return { x: e * 100, y: s, color: x.color, r: 3 }
    }),
  })
  if (!split) return
  // batang ketangguhan (luas di bawah kurva)
  const x0 = wl + 20
  const bw = w - x0 - 14
  const umax = Math.max(...list.map((x) => x.U))
  ctx.font = FONT_B
  ctx.fillStyle = C.ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('Ketangguhan U = ∫σ dε (MJ/m³)', x0, 4)
  const rowH = Math.min(30, (h - 34) / list.length)
  list.forEach((x, i) => {
    const y = 28 + i * rowH
    const lw = 66
    ctx.font = x.selected ? FONT_B : FONT
    ctx.fillStyle = C.ink
    ctx.textBaseline = 'middle'
    ctx.fillText(x.label, x0, y + rowH / 2 - 2)
    const len = ((bw - lw - 40) * x.U) / umax
    ctx.fillStyle = x.color
    ctx.globalAlpha = x.selected ? 1 : 0.75
    ctx.fillRect(x0 + lw, y + 4, Math.max(1, len), rowH - 12)
    ctx.globalAlpha = 1
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.fillText(fmt(x.U, x.U < 10 ? 2 : 0), x0 + lw + len + 5, y + rowH / 2 - 2)
  })
}

// ---------- beton ----------

export interface ConcChart {
  mode: 'tekan' | 'belah'
  fc: number
  data: XY[] // tekan: (ε, σ); belah: (t, P kN)
  eEnd: number
  Pmax: number // kN (belah, teori)
  tEnd: number
  chordData: { E: number; S1: number; e2: number } | null
}

export function drawConcreteChart(ctx: Ctx, w: number, h: number, st: ConcChart) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const split = w > 560
  const wl = split ? w * 0.6 : w
  if (st.mode === 'tekan') {
    const fc = st.fc
    const n = 200
    const pop: XY[] = []
    const hog: XY[] = []
    const ex = Math.max(st.eEnd, 0.0038)
    for (let i = 0; i <= n; i++) {
      const e = (ex * i) / n
      pop.push([e * 1000, popovics(fc, e)])
      hog.push([e * 1000, hognestad(fc, e)])
    }
    const ec = concreteEc(fc)
    chart(ctx, 0, 0, wl, h, {
      x: [0, ex * 1050],
      y: [0, fc * 1.18],
      xlabel: 'regangan ε (‰)',
      ylabel: 'σ tekan (MPa)',
      series: [
        { pts: hog, color: C.orange, width: 1.5, dash: [5, 4], label: 'Hognestad' },
        { pts: pop, color: C.greenSoft, width: 1.5, dash: [5, 4], label: 'Popovics' },
        { pts: st.data.map(([e, s]) => [e * 1000, s]), color: C.navy, width: 2, label: 'data uji' },
        { pts: [[0, 0], [(fc / ec) * 1000, fc]], color: C.mute, width: 1, dash: [2, 3] },
      ],
      hmarks: [{ v: fc, color: C.red, label: `fc′ = ${fmt(fc, 0)}` }],
      dots: st.data.length ? [{ x: st.data[st.data.length - 1][0] * 1000, y: st.data[st.data.length - 1][1], color: C.red, r: 5 }] : [],
    })
    if (!split) return
    const th = chordModulus((e) => popovics(fc, e), 0.4 * fc)
    const ez = th.e2 * 1.6
    const zs: Series[] = [
      { pts: pop.filter((p) => p[0] <= ez * 1000), color: C.greenSoft, width: 1.5, dash: [5, 4] },
      { pts: st.data.filter((p) => p[0] <= ez).map(([e, s]) => [e * 1000, s]), color: C.navy, width: 2 },
      { pts: [[0, 0], [(0.6 * fc * 1000) / ec, 0.6 * fc]], color: C.mute, width: 1, dash: [2, 3], label: 'Ec = 4700√fc′' },
    ]
    const c = st.chordData
    const dots: Dot[] = []
    if (c) {
      zs.push({ pts: [[0.05, c.S1], [c.e2 * 1000, 0.4 * fc]], color: C.red, width: 2, label: 'chord' })
      dots.push({ x: 0.05, y: c.S1, color: C.red, r: 3 }, { x: c.e2 * 1000, y: 0.4 * fc, color: C.red, r: 3 })
    }
    chart(ctx, wl + 8, 0, w - wl - 8, h, {
      x: [0, ez * 1000],
      y: [0, 0.6 * fc],
      xlabel: 'ε (‰)',
      ylabel: 'σ (MPa)',
      series: zs,
      dots,
      hmarks: [{ v: 0.4 * fc, color: C.mute, label: '0,4fc′' }],
      title: c ? `E chord (ASTM C469) = ${fmt(c.E / 1000, 1)} GPa` : 'modulus chord: 50 µε → 0,4fc′',
    })
    return
  }
  // belah
  chart(ctx, 0, 0, wl, h, {
    x: [0, Math.max(st.tEnd, st.data.length ? st.data[st.data.length - 1][0] : 0) * 1.05],
    y: [0, st.Pmax * 1.25],
    xlabel: 'waktu t (s)',
    ylabel: 'gaya P (kN)',
    series: [{ pts: st.data, color: C.navy, width: 2, label: 'data uji' }],
    hmarks: [{ v: st.Pmax, color: C.red, label: `Pmax teori ${fmt(st.Pmax, 0)} kN` }],
  })
  if (!split) return
  const sx: XY[] = []
  const sy: XY[] = []
  for (let i = 1; i < 200; i++) {
    const y = i / 200
    const s = splitStress(1, 1, 1, y)
    sx.push([s.sx / s.sx, y])
    sy.push([Math.max(-12, s.sy / s.sx), y])
  }
  chart(ctx, wl + 8, 0, w - wl - 8, h, {
    x: [-12, 3],
    y: [0, 1],
    xlabel: 'σ / (2P/πLD)',
    ylabel: 'y/D dari beban atas',
    series: [
      { pts: sx, color: C.red, width: 2, label: 'σx tarik' },
      { pts: sy, color: C.navy, width: 2, label: 'σy tekan' },
    ],
    vmarks: [{ v: 0, color: C.mute }],
    title: 'Tegangan di bidang belah (elastis)',
  })
  ctx.font = FONT
}
