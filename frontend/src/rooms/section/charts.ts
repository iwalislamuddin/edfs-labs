// Grafik bawah Room Section: I(θ) (Properti), σ tegak lurus garis netral (Tegangan Normal), Q, b, τ terhadap y (Geser).
import { C, FONT, FONT_B } from '../../lab/theme'
import type { Params, Setup } from './model'
import { hull, Q, rotated, shearProfile, sigma, stressPlane, width, type Part, type Props } from './section'
import { COL, fmt } from './stage'

type Ctx = CanvasRenderingContext2D

interface Series {
  pts: [number, number][]
  color: string
  label: string
  fill?: boolean
  width?: number
}
interface Mark {
  v: number
  color: string
  label?: string
  dash?: number[]
}
interface ChartOpts {
  x: [number, number]
  y: [number, number]
  xlabel: string
  ylabel: string
  series: Series[]
  vmarks?: Mark[]
  hmarks?: Mark[]
  dots?: { x: number; y: number; color: string; label?: string }[]
}

function niceStep(span: number, n: number) {
  const raw = span / n
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

function chart(ctx: Ctx, w: number, h: number, o: ChartOpts) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const L = 58
  const R = 14
  const B = 34
  const pw = w - L - R
  // legenda di atas area grafik (rata kanan), membungkus ke baris baru bila sempit
  ctx.font = FONT_B
  const items = o.series.filter((s) => s.label).map((s) => ({ s, w: ctx.measureText(s.label).width + 30 }))
  const rows: (typeof items)[] = [[]]
  let used = 0
  for (const it of items) {
    if (used + it.w > pw && rows[rows.length - 1].length) {
      rows.push([])
      used = 0
    }
    rows[rows.length - 1].push(it)
    used += it.w
  }
  const T = 22 + 15 * (rows.length - 1) + (rows.length > 1 ? 15 : 0)
  const ph = h - T - B
  let [y0, y1] = o.y
  if (y1 - y0 < 1e-12) {
    y0 -= 1
    y1 += 1
  }
  const pad = (y1 - y0) * 0.08
  y0 -= pad
  y1 += pad
  const [x0, x1] = o.x
  const px = (x: number) => L + ((x - x0) / (x1 - x0)) * pw
  const py = (y: number) => T + ((y1 - y) / (y1 - y0)) * ph

  ctx.font = FONT
  ctx.strokeStyle = C.grid
  ctx.fillStyle = C.mute
  ctx.lineWidth = 1
  const sx = niceStep(x1 - x0, 8)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) {
    ctx.beginPath()
    ctx.moveTo(px(x), T)
    ctx.lineTo(px(x), T + ph)
    ctx.stroke()
    ctx.fillText(fmt(x, sx < 1 ? 1 : 0), px(x), T + ph + 4)
  }
  const sy = niceStep(y1 - y0, 5)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) {
    ctx.beginPath()
    ctx.moveTo(L, py(y))
    ctx.lineTo(L + pw, py(y))
    ctx.stroke()
    ctx.fillText(fmt(y, sy < 1 ? (sy < 0.1 ? 2 : 1) : 0), L - 6, py(y))
  }
  if (y0 < 0 && y1 > 0) {
    ctx.strokeStyle = C.mute
    ctx.beginPath()
    ctx.moveTo(L, py(0))
    ctx.lineTo(L + pw, py(0))
    ctx.stroke()
  }
  ctx.fillStyle = C.mute
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(o.xlabel, L + pw, T + ph + 18)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(o.ylabel, 4, 16)

  ctx.save()
  ctx.beginPath()
  ctx.rect(L, T, pw, ph)
  ctx.clip()
  for (const m of o.vmarks ?? []) {
    ctx.strokeStyle = m.color
    ctx.setLineDash(m.dash ?? [4, 3])
    ctx.beginPath()
    ctx.moveTo(px(m.v), T)
    ctx.lineTo(px(m.v), T + ph)
    ctx.stroke()
  }
  for (const m of o.hmarks ?? []) {
    ctx.strokeStyle = m.color
    ctx.setLineDash(m.dash ?? [4, 3])
    ctx.beginPath()
    ctx.moveTo(L, py(m.v))
    ctx.lineTo(L + pw, py(m.v))
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (const s of o.series) {
    if (!s.pts.length) continue
    ctx.beginPath()
    s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
    if (s.fill) {
      ctx.lineTo(px(s.pts[s.pts.length - 1][0]), py(0))
      ctx.lineTo(px(s.pts[0][0]), py(0))
      ctx.closePath()
      ctx.globalAlpha = 0.15
      ctx.fillStyle = s.color
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.beginPath()
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
    }
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width ?? 2
    ctx.stroke()
  }
  for (const d of o.dots ?? []) {
    ctx.fillStyle = d.color
    ctx.beginPath()
    ctx.arc(px(d.x), py(d.y), 4, 0, 2 * Math.PI)
    ctx.fill()
  }
  ctx.restore()
  ctx.font = FONT
  ctx.textBaseline = 'middle'
  for (const m of [...(o.vmarks ?? [])]) {
    if (!m.label) continue
    ctx.fillStyle = m.color
    ctx.textAlign = 'left'
    ctx.fillText(m.label, px(m.v) + 4, T + 8)
  }
  for (const m of [...(o.hmarks ?? [])]) {
    if (!m.label) continue
    ctx.fillStyle = m.color
    ctx.textAlign = 'right'
    ctx.fillText(m.label, L + pw - 4, py(m.v) - 8)
  }
  for (const d of o.dots ?? []) {
    if (!d.label) continue
    ctx.fillStyle = d.color
    ctx.textAlign = 'left'
    ctx.fillText(d.label, px(d.x) + 7, py(d.y) - 9)
  }
  ctx.font = FONT_B
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  rows.forEach((row, r) => {
    const yy = T - 11 - 15 * (rows.length - 1 - r)
    let lx = L + pw - row.reduce((a, it) => a + it.w, 0)
    for (const { s, w: iw } of row) {
      ctx.fillStyle = s.color
      ctx.fillRect(lx, yy - 1, 12, 3)
      ctx.fillText(s.label, lx + 16, yy)
      lx += iw
    }
  })
}

export function drawChart(ctx: Ctx, w: number, h: number, setup: Setup, p: Params, parts: Part[], pr: Props) {
  if (setup === 'properti') {
    const E = 1e6
    const iu: [number, number][] = []
    const iv: [number, number][] = []
    const iuv: [number, number][] = []
    for (let k = 0; k <= 360; k++) {
      const th = -90 + k * 0.5
      const r = rotated(pr, th)
      iu.push([th, r.Iu / E])
      iv.push([th, r.Iv / E])
      iuv.push([th, r.Iuv / E])
    }
    const r = rotated(pr, p.th)
    const all = [...iu, ...iv, ...iuv].map((x) => x[1])
    chart(ctx, w, h, {
      x: [-90, 90],
      y: [Math.min(0, ...all), Math.max(...all)],
      xlabel: 'sudut sumbu u, θ (°)',
      ylabel: '×10⁶ mm⁴',
      series: [
        { pts: iu, color: COL.u, label: 'Iu' },
        { pts: iv, color: C.steel, label: 'Iv' },
        { pts: iuv, color: C.orange, label: 'Iuv', width: 1.5 },
      ],
      vmarks: [
        { v: p.th, color: COL.u, dash: [] },
        { v: pr.thP, color: C.orange, label: `θp = ${fmt(pr.thP)}°` },
      ],
      dots: [
        { x: p.th, y: r.Iu / E, color: COL.u, label: fmt(r.Iu / E, 2) },
        { x: p.th, y: r.Iuv / E, color: C.orange },
      ],
    })
    return
  }
  if (setup === 'lentur') {
    const pl = stressPlane(pr, p.N, p.Mx, p.My)
    const g = Math.hypot(pl.a, pl.b)
    const hl = hull(parts)
    // koordinat d sepanjang arah gradien (tegak lurus garis netral), dari titik berat
    const ux = g > 1e-15 ? pl.a / g : 0
    const uy = g > 1e-15 ? pl.b / g : 1
    const ds = hl.map(([x, y]) => ux * (x - pr.xc) + uy * (y - pr.yc))
    const d0 = Math.min(...ds)
    const d1 = Math.max(...ds)
    const pts: [number, number][] = []
    for (let k = 0; k <= 100; k++) {
      const d = d0 + ((d1 - d0) * k) / 100
      pts.push([d, sigma(pl, pr, pr.xc + ux * d, pr.yc + uy * d)])
    }
    const ys = [...pts.map((x) => x[1]), 0]
    const fyIn = Math.max(...ys.map(Math.abs)) > 0.4 * p.fy
    chart(ctx, w, h, {
      x: [d0, d1],
      y: [Math.min(...ys, fyIn ? -p.fy : 0), Math.max(...ys, fyIn ? p.fy : 0)],
      xlabel: g > 1e-15 ? 'jarak tegak lurus garis netral dari titik berat (mm)' : 'jarak vertikal dari titik berat (mm)',
      ylabel: 'σ (MPa)',
      series: [{ pts, color: C.ink, label: 'σ', fill: true }],
      vmarks: g > 1e-15 && Math.abs(pl.s0 / g) < (d1 - d0) * 2 ? [{ v: -pl.s0 / g, color: C.ink, label: 'garis netral' }] : [],
      hmarks: fyIn
        ? [
            { v: p.fy, color: COL.tension, label: `+fy ${fmt(p.fy, 0)}` },
            { v: -p.fy, color: COL.compression, label: `−fy` },
          ]
        : [],
    })
    return
  }
  // geser: Q, b, τ terhadap y, dinormalisasi ke maksimum masing-masing
  const V = p.V * 1e3
  const prof = shearProfile(parts, pr, V)
  const qs: [number, number][] = []
  const bs: [number, number][] = []
  for (let k = 0; k <= 200; k++) {
    const y = pr.ymin + ((pr.ymax - pr.ymin) * k) / 200
    qs.push([y - pr.ymin, Q(parts, pr, y).Qx])
    bs.push([y - pr.ymin, width(parts, y)])
  }
  const qm = Math.max(...qs.map((x) => Math.abs(x[1])), 1e-12)
  const bm = Math.max(...bs.map((x) => x[1]), 1e-12)
  const tm = Math.max(...prof.map((x) => Math.abs(x.tau)), 1e-12)
  const yCut = p.cut * (pr.ymax - pr.ymin)
  chart(ctx, w, h, {
    x: [0, pr.ymax - pr.ymin],
    y: [0, 1],
    xlabel: 'tinggi dari serat bawah, y (mm)',
    ylabel: 'relatif terhadap maks',
    series: [
      { pts: bs.map(([x, y]) => [x, y / bm]), color: C.steel, label: `b (maks ${fmt(bm, 0)} mm)`, width: 1.5 },
      { pts: qs.map(([x, y]) => [x, Math.abs(y) / qm]), color: C.orange, label: `Q (maks ${fmt(qm / 1e3, 0)}×10³ mm³)` },
      { pts: [...prof].reverse().map((x) => [x.y - pr.ymin, Math.abs(x.tau) / tm]), color: COL.shear, label: `τ (maks ${fmt(V ? tm : 0, 2)} MPa)` },
    ],
    vmarks: [
      { v: yCut, color: COL.cut, dash: [] },
      { v: pr.yc - pr.ymin, color: COL.axis, label: 'GN' },
    ],
  })
}
