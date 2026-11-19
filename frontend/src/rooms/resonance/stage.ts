// Panggung Room Resonance: massa–pegas–peredam horizontal + diagram fasor.
import { arrow, dashpot, hatchH, hatchV, refLineV, roundRect, spring } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import type { Setup } from './model'

type Ctx = CanvasRenderingContext2D

export interface StageInput {
  setup: Setup
  /** Simpangan relatif massa terhadap tanah (m). */
  u: number
  /** Perpindahan tanah/meja (m) — setup dasar. */
  ug: number
  /** Fase eksitasi ψ (rad): p = p0 sin ψ atau ug = ug0 sin ψ. */
  psi: number
  /** Fase tertinggal tunak (rad) dan rasio amplitudo tunak (Rd atau TR). */
  phi: number
  ratio: number
  /** Skala gambar (px per m). */
  scale: number
  showPhasor: boolean
}

const MW = 70 // lebar massa (px)
const MH = 54

/**
 * Skala px/m supaya amplitudo `amp` (m) tampil sekitar 30% lebar panggung.
 * `ug0` (eksitasi dasar) dibatasi ±7% lebar supaya tiang di atas meja tidak keluar panggung.
 */
export function targetScale(w: number, amp: number, ug0 = 0) {
  let s = Math.min(4000, Math.min(w * 0.3, 220) / Math.max(amp, 1e-4))
  if (ug0 > 0) s = Math.min(s, (w * 0.07) / ug0)
  return s
}

export function drawStage(ctx: Ctx, w: number, h: number, o: StageInput) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const gy = Math.round(h * 0.7) // permukaan tempat massa bergulir
  const x0 = Math.round(w * 0.55) // posisi diam pusat massa
  const s = o.scale

  if (o.setup === 'gaya') {
    const wx = Math.round(Math.max(40, w * 0.1))
    hatchH(ctx, wx, w - 20, gy, 1)
    hatchV(ctx, wx, gy - 90, gy, -1)
    drawOscillator(ctx, wx, gy, x0, x0 + o.u * s)
    refLineV(ctx, x0, gy - 100, gy + 14, 'u = 0', C.mute, [4, 4])
    // gaya p(t) pada sisi kanan massa
    const xm = x0 + o.u * s
    const p = Math.sin(o.psi)
    const len = 70 * p
    const yA = gy - MH / 2
    const base = p >= 0 ? xm + MW / 2 + 4 : xm + MW / 2 + 4 - len
    // p > 0: menarik ke kanan dari muka massa; p < 0: mendorong ke kiri, ujung panah di muka massa
    if (Math.abs(len) > 3) arrow(ctx, base, yA, base + len, yA, C.orange, 3)
    ctx.fillStyle = C.orange
    ctx.font = FONT_B
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText('p(t)', xm + MW / 2 + 8, yA - 10)
  } else {
    // tanah tetap + meja getar (memanjang melewati tepi panggung) yang bergeser ug
    const fy = gy + 26
    hatchH(ctx, 20, w - 20, fy, 1)
    const dx = o.ug * s
    // roda di antara tanah dan meja menggelinding: bergeser setengah perpindahan meja
    ctx.fillStyle = C.steel
    for (let x = 60; x < w - 30; x += 90) {
      ctx.beginPath()
      ctx.arc(x + dx / 2, fy - 7, 6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#e9e6dc'
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.fillRect(-10, gy, w + 20, 13)
    ctx.beginPath()
    ctx.moveTo(-10, gy)
    ctx.lineTo(w + 10, gy)
    ctx.moveTo(-10, gy + 13)
    ctx.lineTo(w + 10, gy + 13)
    ctx.stroke()
    // garis-garis pada meja supaya geraknya terlihat
    ctx.strokeStyle = '#c9c4b5'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = ((dx % 24) + 24) % 24; x < w; x += 24) {
      ctx.moveTo(x, gy + 3)
      ctx.lineTo(x - 6, gy + 10)
    }
    ctx.stroke()
    // tiang di atas meja
    const wx = Math.round(Math.max(48, w * 0.1)) + dx
    ctx.fillStyle = C.block
    ctx.fillRect(wx - 8, gy - 90, 8, 90)
    drawOscillator(ctx, wx, gy, x0 + dx, x0 + dx + o.u * s)
    refLineV(ctx, x0, gy - 100, fy + 4, 'x = 0', C.mute, [4, 4])
    // penanda ug pada meja
    ctx.strokeStyle = C.orange
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(x0 + dx, gy + 1)
    ctx.lineTo(x0 + dx, gy + 12)
    ctx.stroke()
    // label di badan meja (ikut bergerak)
    ctx.font = FONT_B
    const lab = 'meja getar  ug(t)'
    const lw = ctx.measureText(lab).width
    const lx = w - 24 - lw + dx
    ctx.fillStyle = '#e9e6dc'
    ctx.fillRect(lx - 4, gy + 1, lw + 8, 11)
    ctx.fillStyle = C.orange
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(lab, lx, gy + 7)
  }

  if (o.showPhasor) drawPhasor(ctx, Math.round(Math.max(160, w * 0.26)), 74, 44, o)
}

/** Pegas (atas) + peredam (bawah) dari dinding x = wx ke massa berpusat di xm. */
function drawOscillator(ctx: Ctx, wx: number, gy: number, xRest: number, xm: number) {
  const left = xm - MW / 2
  const rest = xRest - MW / 2 - wx
  spring(ctx, wx, gy - MH + 14, left, gy - MH + 14, 10, 9)
  dashpot(ctx, wx, gy - 14, left, gy - 14, rest, 12)
  // massa + roda
  ctx.fillStyle = C.steel
  for (const dx of [-MW / 4, MW / 4]) {
    ctx.beginPath()
    ctx.arc(xm + dx, gy - 5, 5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = C.block
  roundRect(ctx, left, gy - MH - 10, MW, MH, 4)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = FONT_B
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('m', xm, gy - MH / 2 - 10)
}

/** Fasor eksitasi (oranye) dan respons tunak (navy), tertinggal φ. Panjang sebanding amplitudo. */
function drawPhasor(ctx: Ctx, cx: number, cy: number, r: number, o: StageInput) {
  const ex = 1
  const re = Math.min(o.ratio, 1e6) // ζ = 0, β = 1 → tak hingga
  const k = r / Math.max(ex, re)
  const le = Math.max(6, ex * k)
  const lr = Math.max(6, re * k)
  ctx.strokeStyle = C.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.moveTo(cx - r - 4, cy)
  ctx.lineTo(cx + r + 4, cy)
  ctx.moveTo(cx, cy - r - 4)
  ctx.lineTo(cx, cy + r + 4)
  ctx.stroke()
  // sudut diukur dari sumbu-x positif, berlawanan jarum jam; sinyal = proyeksi vertikal
  const a1 = o.psi
  const a2 = o.psi - o.phi
  const P = (a: number, l: number) => [cx + l * Math.cos(a), cy - l * Math.sin(a)] as const
  // busur φ
  ctx.strokeStyle = C.green
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, Math.min(le, lr, r) * 0.45 + 6, -a1, -a2)
  ctx.stroke()
  arrow(ctx, cx, cy, ...P(a1, le), C.orange, 2.5)
  arrow(ctx, cx, cy, ...P(a2, lr), C.navy, 2.5)
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = C.mute
  ctx.fillText('fasor tunak', cx, cy - r - 8)
  ctx.textBaseline = 'top'
  ctx.fillStyle = C.orange
  ctx.textAlign = 'right'
  ctx.fillText(o.setup === 'gaya' ? 'p/k' : 'ug', cx - 4, cy + r + 8)
  ctx.fillStyle = C.navy
  ctx.textAlign = 'left'
  ctx.fillText(o.setup === 'gaya' ? 'u' : 'x', cx + 4, cy + r + 8)
  ctx.fillStyle = C.green
  ctx.textAlign = 'center'
  ctx.fillText(`φ = ${((o.phi * 180) / Math.PI).toFixed(0)}°`, cx, cy + r + 24)
}
