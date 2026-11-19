// Panggung Room Earthquake: gedung satu tingkat (SDOF) di atas tanah bergerak; mode isolasi: dua gedung berdampingan.
import { hatchH } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import type { Setup } from './model'

type Ctx = CanvasRenderingContext2D

export interface StageInput {
  setup: Setup
  /** Perpindahan tanah (m). */
  dg: number
  /** Simpangan relatif struktur terjepit (m). */
  u: number
  /** Gedung terisolasi: simpangan isolator dan simpangan struktur relatif lantai dasar (m). */
  ub: number
  us: number
  scale: number
  /** Percepatan mutlak atap saat ini (g) untuk panah gaya inersia: [terjepit, terisolasi]. */
  acc: [number, number]
  done: boolean
}

/** Skala px/m: simpangan `amp` tampil ±`frac`·lebar. */
export const targetScale = (w: number, amp: number, frac = 0.12) => Math.min(5000, (w * frac) / Math.max(amp, 1e-4))

function column(ctx: Ctx, xa: number, ya: number, xb: number, yb: number) {
  ctx.beginPath()
  for (let i = 0; i <= 16; i++) {
    const s = i / 16
    const f = 3 * s * s - 2 * s * s * s
    const x = xa + (xb - xa) * f
    const y = ya + (yb - ya) * s
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

/** Portal satu tingkat: dasar di (xb, yb), atap di x + drift. */
function portal(ctx: Ctx, xBase: number, yBase: number, drift: number, bw: number, hh: number, label: string, acc: number) {
  ctx.strokeStyle = C.steel
  ctx.lineWidth = 3.5
  for (const sd of [-1, 1]) column(ctx, xBase + (sd * bw) / 2, yBase, xBase + drift + (sd * bw) / 2, yBase - hh)
  ctx.fillStyle = C.block
  ctx.fillRect(xBase + drift - bw / 2 - 12, yBase - hh - 14, bw + 24, 16)
  ctx.fillStyle = '#fff'
  ctx.font = FONT_B
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('m', xBase + drift, yBase - hh - 6)
  ctx.fillStyle = C.ink
  ctx.textBaseline = 'bottom'
  ctx.fillText(label, xBase, yBase - hh - 26)
  // gaya inersia ∝ −percepatan mutlak
  const len = Math.max(-90, Math.min(90, -acc * 120))
  if (Math.abs(len) > 4) {
    const y = yBase - hh - 6
    const x0 = len > 0 ? xBase + drift + bw / 2 + 14 : xBase + drift - bw / 2 - 14
    ctx.strokeStyle = C.red
    ctx.fillStyle = C.red
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 + len, y)
    ctx.stroke()
    const d = Math.sign(len)
    ctx.beginPath()
    ctx.moveTo(x0 + len + d * 8, y)
    ctx.lineTo(x0 + len, y - 5)
    ctx.lineTo(x0 + len, y + 5)
    ctx.fill()
  }
}

export function drawStage(ctx: Ctx, w: number, h: number, o: StageInput) {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const gy = h - 56
  const s = o.scale
  const xg = o.dg * s

  // tanah bergerak
  hatchH(ctx, 10, w - 10, gy + 30, 1)
  ctx.fillStyle = '#e9e1cf'
  ctx.fillRect(-10, gy, w + 20, 20)
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-10, gy)
  ctx.lineTo(w + 10, gy)
  ctx.stroke()
  ctx.fillStyle = '#c9bfa8'
  for (let x = ((xg % 30) + 30) % 30 - 30; x < w + 30; x += 30) {
    ctx.beginPath()
    ctx.arc(x, gy + 8, 2, 0, Math.PI * 2)
    ctx.arc(x + 15, gy + 14, 1.5, 0, Math.PI * 2)
    ctx.fill()
  }
  // penanda posisi diam tanah
  ctx.save()
  ctx.setLineDash([3, 4])
  ctx.strokeStyle = C.mute
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(w / 2, gy + 20)
  ctx.lineTo(w / 2, gy + 30)
  ctx.stroke()
  ctx.restore()
  ctx.strokeStyle = C.orange
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(w / 2 + xg, gy + 2)
  ctx.lineTo(w / 2 + xg, gy + 18)
  ctx.stroke()
  ctx.fillStyle = C.orange
  ctx.font = FONT_B
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`ug = ${(o.dg * 100).toFixed(1)} cm`, w / 2 + xg + 6, gy + 3)

  const hh = Math.min(170, h * 0.45)
  if (o.setup === 'spektrum') {
    const bw = Math.min(160, w * 0.28)
    portal(ctx, w / 2 + xg, gy, o.u * s, bw, hh, '', o.acc[0])
  } else {
    const bw = Math.min(110, w * 0.18)
    const xL = w * 0.27 + xg
    const xR = w * 0.72 + xg
    portal(ctx, xL, gy, o.u * s, bw, hh, 'Terjepit', o.acc[0])
    // isolator + lantai dasar
    const ih = 22
    const xb = xR + o.ub * s
    for (const sd of [-1, 1]) {
      const x0 = xR + (sd * bw) / 2
      const x1 = xb + (sd * bw) / 2
      ctx.fillStyle = '#3b3b3b'
      ctx.beginPath()
      ctx.moveTo(x0 - 11, gy)
      ctx.lineTo(x0 + 11, gy)
      ctx.lineTo(x1 + 11, gy - ih)
      ctx.lineTo(x1 - 11, gy - ih)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#9a9a9a'
      ctx.lineWidth = 1
      for (let i = 1; i < 4; i++) {
        const f = i / 4
        ctx.beginPath()
        ctx.moveTo(x0 - 11 + (x1 - x0) * f, gy - ih * f)
        ctx.lineTo(x0 + 11 + (x1 - x0) * f, gy - ih * f)
        ctx.stroke()
      }
    }
    ctx.fillStyle = C.block
    ctx.fillRect(xb - bw / 2 - 18, gy - ih - 10, bw + 36, 10)
    portal(ctx, xb, gy - ih - 10, o.us * s, bw, hh - ih - 10, 'Terisolasi', o.acc[1])
    ctx.fillStyle = C.mute
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('isolator karet', xR, gy + 34)
  }
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`perpindahan digambar ×${fmt(s / (hh / 3.5))} skala gedung`, 12, 10)
  ctx.fillStyle = C.red
  ctx.fillText('→ gaya inersia −m·ä mutlak', 12, 26)
  if (o.done) {
    ctx.fillStyle = C.green
    ctx.font = FONT_B
    ctx.fillText('rekaman selesai — titik spektrum tercatat', 12, 44)
  }
}

const fmt = (v: number) => (v >= 10 ? Math.round(v) : v.toFixed(1))
