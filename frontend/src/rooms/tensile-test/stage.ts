// Panggung Room Tensile Test: mesin uji universal dengan benda uji bulat (bahu, panjang ukur, pita Lüders, leher,
// patahan mangkuk–kerucut / getas), panel bacaan; silinder beton tekan dan belah; deret benda uji patah untuk dibandingkan.
import { arrow, dimV, hatchH } from '../../lab/draw'
import { fmt } from '../../lab/chart'
import { C, FONT, FONT_B } from '../../lab/theme'
import type { Point } from './material'

type Ctx = CanvasRenderingContext2D

const STEEL_FILL = '#aeb4bb'
const STEEL_DARK = '#7f8790'
const MACHINE = '#3d4833'
const CONC = '#c9c5b9'

// ---------- benda uji ----------

export interface Spec {
  d0: number // mm
  L0: number // mm
  /** pertambahan panjang ukur saat ini (mm) */
  ext: number
  pt: Point
  brittle: boolean
  /** panjang zona leher / d0 (lebar gambar leher) */
  lam: number
}

/** Panjang-panjang geometri benda uji (mm): ujung jepit, peralihan, panjang paralel Lc = L0 + d0. */
export function geom(d0: number, L0: number) {
  return { g: 2.2 * d0, f: 0.9 * d0, Lc: L0 + d0, R: 0.75 * d0 }
}

/** Tinggi total benda uji (mm) pada pertambahan panjang ext. */
export const specLength = (d0: number, L0: number, ext: number) => {
  const q = geom(d0, L0)
  return 2 * q.g + 2 * q.f + q.Lc + ext
}

interface Drawn {
  yTop: number
  yGripLo: number // batas atas jepitan bawah
  yGripHi: number // batas bawah jepitan atas
  marks: [number, number]
  dmin: number // mm
  xR: number // tepi kanan paralel (px)
}

/** Menggambar benda uji tegak; dasar di yB, sumbu di cx, s = px/mm. */
export function drawSpecimen(ctx: Ctx, cx: number, yB: number, s: number, sp: Spec): Drawn {
  const q = geom(sp.d0, sp.L0)
  const Lc = q.Lc + sp.ext
  const ru = sp.d0 / 2 / Math.sqrt(1 + Math.max(0, sp.pt.eu))
  const rn = sp.pt.t !== null ? (sp.d0 / 2) * Math.exp(-sp.pt.t / 2) : ru
  const uc = q.g + q.f + 0.55 * Lc
  const w = Math.max(0.45, Math.min(1.2, sp.lam)) * sp.d0
  // profil jari-jari r(u) sepanjang sumbu
  const prof: [number, number][] = []
  const total = 2 * q.g + 2 * q.f + Lc
  const rAt = (u: number) => {
    if (u <= q.g || u >= total - q.g) return q.R
    if (u < q.g + q.f) {
      const a = (u - q.g) / q.f
      return ru + (q.R - ru) * (0.5 + 0.5 * Math.cos(Math.PI * a))
    }
    if (u > total - q.g - q.f) {
      const a = (total - q.g - u) / q.f
      return ru + (q.R - ru) * (0.5 + 0.5 * Math.cos(Math.PI * a))
    }
    return ru - (ru - rn) * Math.exp(-(((u - uc) / w) ** 2))
  }
  const N = 160
  for (let i = 0; i <= N; i++) {
    const u = (total * i) / N
    prof.push([u, rAt(u)])
  }
  // pastikan titik leher tepat ikut
  prof.push([uc, rn])
  prof.sort((a, b) => a[0] - b[0])

  const Y = (u: number) => yB - u * s
  const gap = sp.pt.broken ? 7 : 0
  const piece = (from: number, to: number, shift: number, endLo: 'flat' | 'cone' | 'cup' | 'jag', endHi: 'flat' | 'cone' | 'cup' | 'jag') => {
    const pts = prof.filter(([u]) => u >= from && u <= to)
    if (pts[0][0] > from) pts.unshift([from, rAt(from)])
    if (pts[pts.length - 1][0] < to) pts.push([to, rAt(to)])
    ctx.beginPath()
    // sisi kanan naik
    pts.forEach(([u, r], i) => (i ? ctx.lineTo(cx + r * s, Y(u) - shift) : ctx.moveTo(cx + r * s, Y(u) - shift)))
    endCap(pts[pts.length - 1], -1, endHi, shift)
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(cx - pts[i][1] * s, Y(pts[i][0]) - shift)
    endCap(pts[0], 1, endLo, shift)
    ctx.closePath()
    const grad = ctx.createLinearGradient(cx - q.R * s, 0, cx + q.R * s, 0)
    grad.addColorStop(0, STEEL_DARK)
    grad.addColorStop(0.35, '#d6dade')
    grad.addColorStop(1, STEEL_DARK)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.strokeStyle = '#4a525b'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  // ujung: dari kiri ke kanan (dir 1, bawah) atau kanan ke kiri (dir −1, atas)
  function endCap([u, r]: [number, number], dir: 1 | -1, kind: 'flat' | 'cone' | 'cup' | 'jag', shift: number) {
    const y = Y(u) - shift
    const x0 = cx - dir * r * s
    const x1 = cx + dir * r * s
    if (kind === 'flat') return ctx.lineTo(x1, y)
    // kerucut (potongan bawah) dan mangkuk (potongan atas) sama-sama mengarah ke atas sehingga saling mengunci
    if (kind === 'cone' || kind === 'cup') ctx.lineTo(cx, y - Math.max(2, r * s * 0.45))
    else {
      const n = 5
      for (let i = 1; i < n; i++) ctx.lineTo(x0 + ((x1 - x0) * i) / n, y + (i % 2 ? 1.5 : -1.5))
    }
    ctx.lineTo(x1, y)
  }

  if (!sp.pt.broken) piece(0, total, 0, 'flat', 'flat')
  else {
    const b = sp.brittle
    // potongan bawah: ujung atas kerucut (menonjol ke atas); potongan atas: mangkuk (cekung)
    piece(0, uc, 0, 'flat', b ? 'jag' : 'cone')
    piece(uc, total, gap, b ? 'jag' : 'cup', 'flat')
  }

  // pita Lüders: dari bahu atas menjalar ke bawah
  const q0 = q.g + q.f
  if (sp.pt.luders > 0 && sp.pt.luders < 1 && !sp.pt.broken) {
    const uTop = q0 + Lc
    const uBot = uTop - sp.pt.luders * Lc
    ctx.save()
    ctx.beginPath()
    ctx.rect(cx - ru * s, Y(uTop), 2 * ru * s, (uTop - uBot) * s)
    ctx.clip()
    ctx.fillStyle = 'rgba(61,72,51,0.18)'
    ctx.fillRect(cx - ru * s, Y(uTop), 2 * ru * s, (uTop - uBot) * s)
    ctx.strokeStyle = 'rgba(61,72,51,0.45)'
    ctx.lineWidth = 1
    const span = 2 * ru * s
    for (let y = Y(uTop) - span; y < Y(uBot) + span; y += 4) {
      ctx.beginPath()
      ctx.moveTo(cx - ru * s, y)
      ctx.lineTo(cx + ru * s, y + span * 1.1)
      ctx.stroke()
    }
    ctx.restore()
    // muka pita miring ±50°
    ctx.strokeStyle = C.green
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx - ru * s, Y(uBot) - ru * s * 0.6)
    ctx.lineTo(cx + ru * s, Y(uBot) + ru * s * 0.6)
    ctx.stroke()
  }

  // tanda panjang ukur
  const ratio = Lc / q.Lc
  const uMark1 = q0 + (sp.d0 / 2) * ratio
  const uMark2 = q0 + (sp.d0 / 2 + sp.L0) * ratio
  const shiftAbove = (u: number) => (sp.pt.broken && u > uc ? gap : 0)
  const marks: [number, number] = [Y(uMark1) - shiftAbove(uMark1), Y(uMark2) - shiftAbove(uMark2)]
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 1.5
  for (const [i, y] of marks.entries()) {
    const r = rAt(i ? uMark2 : uMark1)
    ctx.beginPath()
    ctx.moveTo(cx - r * s - 4, y)
    ctx.lineTo(cx - r * s + 3, y)
    ctx.stroke()
  }
  return {
    yTop: Y(total) - gap,
    yGripLo: Y(q.g),
    yGripHi: Y(total - q.g) - gap,
    marks,
    dmin: 2 * rn,
    xR: cx + ru * s,
  }
}

// ---------- mesin uji baja ----------

export interface SteelStage {
  spec: Spec
  /** perpanjangan maksimum sepanjang uji (mm) untuk skala tetap */
  extMax: number
  P: number // kN
  sigma: number // MPa (P/A0)
  e: number // regangan teknik total
  phase: string
  dir: number // 1 tarik, −1 bongkar, 0 diam
  A0: number
}

export interface SteelLayout {
  s: number
  extPx: number // px per regangan (crosshead) = L0·s
}

export function steelLayout(w: number, h: number, st: SteelStage): SteelLayout {
  const { d0, L0 } = st.spec
  const maxLen = specLength(d0, L0, st.extMax) + 8
  const s = Math.min((h - 170) / maxLen, 64 / (1.5 * d0), (w * 0.5) / (6 * d0))
  return { s, extPx: L0 * s }
}

export function drawSteelStage(ctx: Ctx, w: number, h: number, st: SteelStage) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const lay = steelLayout(w, h, st)
  const s = lay.s
  const narrow = w < 620
  const cx = narrow ? w * 0.34 : Math.min(w * 0.36, 300)
  const baseY = h - 52
  const yB = baseY - 46
  const colX = Math.max(80, 3.2 * st.spec.d0 * s + 40)

  // kolom & dasar mesin
  ctx.fillStyle = '#e9e7df'
  ctx.fillRect(cx - colX - 14, 18, 14, baseY - 18)
  ctx.fillRect(cx + colX, 18, 14, baseY - 18)
  ctx.fillStyle = MACHINE
  ctx.fillRect(cx - colX - 30, baseY, 2 * colX + 60, 14)
  hatchH(ctx, cx - colX - 40, cx + colX + 40, baseY + 14, 1)
  ctx.fillStyle = '#d9dccf'
  ctx.fillRect(cx - colX - 14, 18, 2 * colX + 28, 12)
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('kepala tetap', cx, 16)

  const d = drawSpecimen(ctx, cx, yB, s, st.spec)

  // jepitan baji bawah (tetap) dan atas (bergerak bersama crosshead)
  const R = 0.75 * st.spec.d0 * s
  const gripW = R + 16
  const wedge = (yA: number, yZ: number) => {
    ctx.fillStyle = '#5e6a52'
    for (const sg of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + sg * R, yA)
      ctx.lineTo(cx + sg * (R + 10), yA)
      ctx.lineTo(cx + sg * (R + 16), yZ)
      ctx.lineTo(cx + sg * R, yZ)
      ctx.closePath()
      ctx.fill()
    }
  }
  wedge(d.yGripLo + 2, yB + 4)
  ctx.fillStyle = MACHINE
  ctx.fillRect(cx - gripW - 10, yB + 4, 2 * (gripW + 10), baseY - yB - 4)
  wedge(d.yTop - 4, d.yGripHi - 2)
  // crosshead bergerak
  const chY = d.yTop - 4 - 16
  ctx.fillStyle = MACHINE
  ctx.fillRect(cx - gripW - 10, d.yTop - 4 - 4, 2 * (gripW + 10), 8)
  ctx.fillRect(cx - colX - 14, chY - 14, 2 * colX + 28, 16)
  // sel beban
  ctx.fillStyle = C.orange
  ctx.fillRect(cx - 18, chY - 32, 36, 18)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 10px "Helvetica Neue", Helvetica, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('kN', cx, chY - 23)
  if (st.dir !== 0 && !st.spec.pt.broken) {
    const up = st.dir > 0
    arrow(ctx, cx + colX - 28, up ? chY - 2 : chY - 40, cx + colX - 28, up ? chY - 40 : chY - 2, up ? C.red : C.navy, 2.5)
  }

  // ekstensometer jepit di tanda ukur
  if (!st.spec.pt.broken) {
    const xa = d.xR + 2
    ctx.strokeStyle = C.navy
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(xa, d.marks[0])
    ctx.lineTo(xa + 22, d.marks[0])
    ctx.moveTo(xa, d.marks[1])
    ctx.lineTo(xa + 22, d.marks[1])
    ctx.stroke()
    ctx.fillStyle = '#dfe6ee'
    ctx.strokeStyle = C.navy
    ctx.lineWidth = 1
    ctx.fillRect(xa + 22, d.marks[1] - 2, 9, d.marks[0] - d.marks[1] + 4)
    ctx.strokeRect(xa + 22, d.marks[1] - 2, 9, d.marks[0] - d.marks[1] + 4)
  }
  dimV(ctx, cx - R - 26, d.marks[0], d.marks[1], st.spec.pt.broken ? `Lu = ${fmt(st.spec.L0 + st.spec.ext, 1)}` : `L0 = ${fmt(st.spec.L0, 0)}`, C.mute, -1)

  // panel bacaan
  const px = narrow ? cx + colX + 26 : Math.max(cx + colX + 40, w * 0.56)
  const pw = w - px - 14
  let y = 28
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = FONT_B
  ctx.fillStyle = st.spec.pt.broken ? C.red : C.green
  ctx.fillText(st.phase, px, y)
  y += 30
  const big = narrow ? 22 : 30
  const line = (lab: string, val: string, unit: string, col = C.ink) => {
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.fillText(lab, px, y)
    ctx.font = `bold ${big}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    ctx.fillStyle = col
    ctx.fillText(val, px, y + big + 2)
    const tw = ctx.measureText(val).width
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.fillText(unit, px + tw + 5, y + big + 2)
    y += big + 24
  }
  line('Gaya P', fmt(st.P, 2), 'kN', C.orange)
  line('Pertambahan panjang ΔL', fmt(st.e * st.spec.L0, 2), 'mm')
  line('σ = P / A0', fmt(st.sigma, 1), 'MPa', C.navy)
  line('ε = ΔL / L0', fmt(st.e * 100, 2), '%', C.navy)

  // penampang: d0 vs d terkecil
  const rr = Math.min(42, pw / 3, (h - y - 40) / 2.4)
  if (rr > 14) {
    const ccx = px + rr + 4
    const ccy = y + rr + 6
    const f = rr / (st.spec.d0 / 2)
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = C.mute
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(ccx, ccy, rr, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = STEEL_FILL
    ctx.beginPath()
    ctx.arc(ccx, ccy, (d.dmin / 2) * f, 0, 2 * Math.PI)
    ctx.fill()
    ctx.strokeStyle = '#4a525b'
    ctx.stroke()
    ctx.fillStyle = C.ink
    ctx.font = FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const ar = (d.dmin / st.spec.d0) ** 2
    ctx.fillText(`d0 = ${fmt(st.spec.d0, 1)} mm`, ccx + rr + 10, ccy - 18)
    ctx.fillText(`d = ${fmt(d.dmin, 2)} mm`, ccx + rr + 10, ccy)
    ctx.fillText(`A/A0 = ${fmt(ar * 100, 1)}%`, ccx + rr + 10, ccy + 18)
  }
}

// ---------- beton ----------

export interface ConcStage {
  mode: 'tekan' | 'belah'
  D: number
  H: number
  e: number // regangan tekan (tekan)
  e0: number
  eEnd: number
  P: number // kN
  sigma: number // MPa (σ tekan atau fct)
  /** 0–1 progres retak */
  crack: number
  broken: boolean
  running: boolean
}

function rnd(i: number) {
  const x = Math.sin(i * 91.17 + 3.1) * 15731.743
  return x - Math.floor(x)
}

export function drawConcreteStage(ctx: Ctx, w: number, h: number, st: ConcStage) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const narrow = w < 620
  const cx = narrow ? w * 0.32 : Math.min(w * 0.34, 290)
  const baseY = h - 52
  ctx.fillStyle = MACHINE
  ctx.fillRect(cx - 150, baseY, 300, 14)
  hatchH(ctx, cx - 160, cx + 160, baseY + 14, 1)
  ctx.fillStyle = '#e9e7df'
  ctx.fillRect(cx - 140, 18, 14, baseY - 18)
  ctx.fillRect(cx + 126, 18, 14, baseY - 18)

  if (st.mode === 'tekan') {
    const s = Math.min((h - 150) / st.H, 150 / st.D)
    const Hp = st.H * s * (1 - st.e * 6) // perpendekan diperbesar 6×
    const Dp = st.D * s
    const yb = baseY - 18
    const yt = yb - Hp
    // pelat tekan
    ctx.fillStyle = '#5e6a52'
    ctx.fillRect(cx - Dp / 2 - 18, yb, Dp + 36, 18)
    ctx.fillRect(cx - Dp / 2 - 18, yt - 18, Dp + 36, 18)
    ctx.fillStyle = MACHINE
    ctx.fillRect(cx - 126, yt - 34, 252, 16)
    if (st.running && !st.broken) arrow(ctx, cx + 100, yt - 74, cx + 100, yt - 38, C.red, 2.5)
    // silinder menggembung (diperbesar), ujung ditahan gesekan pelat
    const bulge = Dp * (0.2 * st.e * 40 + 1.2 * Math.max(0, st.e - 0.8 * st.e0) * 40)
    ctx.beginPath()
    const N = 40
    for (let i = 0; i <= N; i++) {
      const a = i / N
      const x = cx + Dp / 2 + bulge * Math.sin(Math.PI * a)
      const y = yb - a * Hp
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    for (let i = N; i >= 0; i--) {
      const a = i / N
      ctx.lineTo(cx - Dp / 2 - bulge * Math.sin(Math.PI * a), yb - a * Hp)
    }
    ctx.closePath()
    const g = ctx.createLinearGradient(cx - Dp / 2, 0, cx + Dp / 2, 0)
    g.addColorStop(0, '#b0ab9d')
    g.addColorStop(0.4, '#ddd9cf')
    g.addColorStop(1, '#a9a495')
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = '#6f6a5c'
    ctx.lineWidth = 1
    ctx.stroke()
    // agregat
    ctx.fillStyle = 'rgba(110,104,90,0.35)'
    for (let i = 0; i < 70; i++) {
      const x = cx + (rnd(i) - 0.5) * Dp * 0.9
      const y = yb - rnd(i + 100) * Hp
      ctx.beginPath()
      ctx.arc(x, y, 1 + rnd(i + 200) * 2.2, 0, 2 * Math.PI)
      ctx.fill()
    }
    // retak: belah vertikal lalu kerucut geser
    const nc = Math.floor(st.crack * 9)
    ctx.strokeStyle = '#3b352b'
    ctx.lineWidth = 1.2
    for (let i = 0; i < nc; i++) {
      const x0 = cx + (rnd(i + 300) - 0.5) * Dp * 0.8
      const yA = yb - Hp * (0.15 + rnd(i + 400) * 0.3)
      const yZ = yb - Hp * (0.55 + rnd(i + 500) * 0.35)
      ctx.beginPath()
      ctx.moveTo(x0, yA)
      const n = 6
      for (let j = 1; j <= n; j++) ctx.lineTo(x0 + (rnd(i * 10 + j) - 0.5) * 8, yA + ((yZ - yA) * j) / n)
      ctx.stroke()
    }
    if (st.crack > 0.6) {
      ctx.lineWidth = 2
      for (const sg of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(cx + (sg * Dp) / 2, yb)
        ctx.lineTo(cx + sg * Dp * 0.08, yb - Hp * 0.5)
        ctx.lineTo(cx + (sg * Dp) / 2, yt)
        ctx.stroke()
      }
    }
    dimV(ctx, cx - Dp / 2 - 30, yb, yt, `H = ${st.H}`, C.mute, -1)
  } else {
    // uji belah: penampang silinder berbaring, beban garis lewat bilah kayu
    const R = Math.min((h - 160) / 2, 110)
    const cy = baseY - 18 - 6 - R
    ctx.fillStyle = '#5e6a52'
    ctx.fillRect(cx - R - 20, cy + R + 6, 2 * R + 40, 18)
    ctx.fillRect(cx - R - 20, cy - R - 24, 2 * R + 40, 18)
    ctx.fillStyle = MACHINE
    ctx.fillRect(cx - 126, cy - R - 40, 252, 16)
    ctx.fillStyle = '#c8a76f'
    ctx.fillRect(cx - 12, cy + R, 24, 6)
    ctx.fillRect(cx - 12, cy - R - 6, 24, 6)
    const gap = st.broken ? 5 : 0
    for (const sg of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + sg * gap, cy - R)
      ctx.arc(cx + sg * gap, cy, R, -Math.PI / 2, Math.PI / 2, sg < 0)
      ctx.closePath()
      ctx.fillStyle = CONC
      ctx.fill()
      ctx.strokeStyle = '#6f6a5c'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(110,104,90,0.35)'
    for (let i = 0; i < 60; i++) {
      const a = rnd(i) * 2 * Math.PI
      const r = Math.sqrt(rnd(i + 50)) * R * 0.92
      const x = cx + r * Math.cos(a)
      ctx.beginPath()
      ctx.arc(x + (st.broken ? Math.sign(x - cx) * gap : 0), cy + r * Math.sin(a), 1 + rnd(i + 200) * 2, 0, 2 * Math.PI)
      ctx.fill()
    }
    // tegangan tarik merata di bidang vertikal (panah horizontal)
    if (!st.broken && st.P > 0) {
      const n = 7
      const len = 6 + 22 * st.crack
      for (let i = 1; i < n; i++) {
        const y = cy - R + (2 * R * i) / n
        arrow(ctx, cx + 4, y, cx + 4 + len, y, C.red, 1.5)
        arrow(ctx, cx - 4, y, cx - 4 - len, y, C.red, 1.5)
      }
    }
    if (st.broken) {
      ctx.strokeStyle = '#3b352b'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let j = 0; j <= 10; j++) ctx.lineTo(cx + (rnd(j + 700) - 0.5) * 4, cy - R + (2 * R * j) / 10)
      ctx.stroke()
    }
    if (st.running && !st.broken) arrow(ctx, cx + 100, cy - R - 80, cx + 100, cy - R - 44, C.red, 2.5)
    ctx.fillStyle = C.mute
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`D ${st.D} × L ${st.H} mm (L tegak lurus layar)`, cx, 2)
  }

  // panel bacaan
  const px = narrow ? cx + 150 : Math.max(cx + 170, w * 0.56)
  let y = 28
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = FONT_B
  ctx.fillStyle = st.broken ? C.red : C.green
  ctx.fillText(
    st.broken ? (st.mode === 'tekan' ? 'Hancur' : 'Terbelah') : st.mode === 'tekan' ? (st.crack > 0 ? 'Retak mikro menjalar' : 'Elastis–tak linear') : 'Tarik merata di bidang belah',
    px,
    y,
  )
  y += 30
  const big = narrow ? 22 : 30
  const line = (lab: string, val: string, unit: string, col = C.ink) => {
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.fillText(lab, px, y)
    ctx.font = `bold ${big}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    ctx.fillStyle = col
    ctx.fillText(val, px, y + big + 2)
    const tw = ctx.measureText(val).width
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.fillText(unit, px + tw + 5, y + big + 2)
    y += big + 24
  }
  line('Gaya P', fmt(st.P, 1), 'kN', C.orange)
  if (st.mode === 'tekan') {
    line('σ = P / A', fmt(st.sigma, 2), 'MPa', C.navy)
    line('ε (perpendekan)', fmt(st.e * 1000, 3), '‰', C.navy)
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.fillText('gambar perpendekan & gembung diperbesar', px, y)
  } else {
    line('fct = 2P / (π·L·D)', fmt(st.sigma, 2), 'MPa', C.navy)
  }
}

// ---------- deret benda uji patah ----------

export interface Broken {
  label: string
  spec: Spec
  A: number // perpanjangan putus
  Z: number
  color: string
  selected: boolean
}

/** Mengembalikan batas x tiap benda uji untuk klik. */
export function drawCompareStage(ctx: Ctx, w: number, h: number, list: Broken[]): [number, number][] {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const n = list.length
  const slot = w / n
  const d0 = list[0].spec.d0
  const L0 = list[0].spec.L0
  const maxExt = Math.max(...list.map((b) => b.spec.ext))
  const s = Math.min((h - 120) / (specLength(d0, L0, maxExt) + 8), (slot * 0.5) / (1.5 * d0))
  const yB = h - 84
  const hits: [number, number][] = []
  // garis panjang semula
  const L0px = specLength(d0, L0, 0) * s
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = C.line
  ctx.beginPath()
  ctx.moveTo(10, yB - L0px)
  ctx.lineTo(w - 10, yB - L0px)
  ctx.stroke()
  ctx.setLineDash([])
  list.forEach((b, i) => {
    const cx = slot * (i + 0.5)
    hits.push([slot * i, slot * (i + 1)])
    if (b.selected) {
      ctx.fillStyle = 'rgba(86,100,73,0.08)'
      ctx.fillRect(slot * i + 3, 8, slot - 6, h - 16)
    }
    drawSpecimen(ctx, cx, yB, s, b.spec)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.font = FONT_B
    ctx.fillStyle = b.color
    ctx.fillText(b.label, cx, yB + 8)
    ctx.font = FONT
    ctx.fillStyle = C.mute
    ctx.fillText(`A ${fmt(b.A * 100, 1)}%`, cx, yB + 24)
    ctx.fillText(`Z ${fmt(b.Z * 100, 0)}%`, cx, yB + 38)
  })
  // label garis panjang semula di celah antara dua benda uji pertama
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('panjang', slot, yB - L0px - 3)
  ctx.textBaseline = 'top'
  ctx.fillText('semula', slot, yB - L0px + 3)
  return hits
}
