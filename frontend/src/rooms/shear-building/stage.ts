// Panggung Room Shear Building: portal geser bertingkat + profil simpangan per lantai.
import { hatchH } from '../../lab/draw'
import { C, FONT, FONT_B } from '../../lab/theme'
import { STORY_H, type Setup } from './model'

type Ctx = CanvasRenderingContext2D

export interface StageInput {
  setup: Setup
  /** Simpangan relatif tiap lantai (m), lantai 1 = terbawah. */
  u: number[]
  /** Perpindahan tanah (m). */
  ug: number
  /** Skala gambar perpindahan (px per m). */
  scale: number
  /** Simpangan maksimum |u| tiap lantai sejak perubahan terakhir (m). */
  env: number[]
  /** Amplitudo tunak teori tiap lantai (setup tanah) atau null. */
  steady: number[] | null
  /** Lantai yang sedang di-drag / disorot (indeks) atau −1. */
  active: number
}

export interface Layout {
  cx: number
  bw: number
  gy: number
  sh: number
  n: number
  scale: number
  /** y lantai j (indeks 0..n−1). */
  floorY: (j: number) => number
  /** Kisi x tiap lantai saat ini (pusat pelat). */
  floorX: number[]
}

const SLAB_H = 10

/** Skala px/m supaya simpangan `amp` (m) tampil ±(lebar gedung·0,35). */
export const targetScale = (bw: number, amp: number) => Math.min(20000, (bw * 0.35) / Math.max(amp, 1e-4))

export function geometry(w: number, h: number, n: number) {
  const narrow = w < 560
  const gy = h - 46
  const sh = Math.min(84, (gy - (narrow ? 80 : 40)) / n)
  const bw = Math.min(200, w * (narrow ? 0.3 : 0.26))
  const cx = w * 0.3
  return { gy, sh, bw, cx, narrow }
}

/** Kolom geser: kurva S (ujung jepit, rotasi nol) dari (xa, ya) ke (xb, yb). */
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

export function drawStage(ctx: Ctx, w: number, h: number, o: StageInput): Layout {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const n = o.u.length
  const { gy, sh, bw, cx, narrow } = geometry(w, h, n)
  const s = o.scale
  const xg = o.ug * s
  const floorY = (j: number) => gy - (j + 1) * sh
  const floorX = o.u.map((u) => cx + xg + u * s)

  // tanah / pondasi
  if (o.setup === 'tanah') {
    hatchH(ctx, 10, w - 10, gy + 22, 1)
    ctx.fillStyle = '#e9e6dc'
    ctx.fillRect(-10, gy, w + 20, 12)
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(-10, gy)
    ctx.lineTo(w + 10, gy)
    ctx.moveTo(-10, gy + 12)
    ctx.lineTo(w + 10, gy + 12)
    ctx.stroke()
    ctx.strokeStyle = '#c9c4b5'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = ((xg % 24) + 24) % 24; x < w; x += 24) {
      ctx.moveTo(x, gy + 3)
      ctx.lineTo(x - 6, gy + 10)
    }
    ctx.stroke()
    ctx.fillStyle = C.orange
    ctx.font = FONT_B
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('ug(t)', 14 + Math.max(0, xg), gy + 26)
  } else {
    hatchH(ctx, cx - bw / 2 - 50, cx + bw / 2 + 50, gy, 1)
  }

  // garis bentuk tak berdeformasi
  ctx.save()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = C.line
  ctx.lineWidth = 1
  ctx.strokeRect(cx - bw / 2, floorY(n - 1), bw, gy - floorY(n - 1))
  ctx.restore()

  // kolom
  ctx.strokeStyle = C.steel
  ctx.lineWidth = 3
  for (let j = 0; j < n; j++) {
    const xa = j === 0 ? cx + xg : floorX[j - 1]
    const ya = j === 0 ? gy : floorY(j - 1)
    for (const side of [-1, 1]) column(ctx, xa + (side * bw) / 2, ya, floorX[j] + (side * bw) / 2, floorY(j))
  }

  // pelat lantai (massa terpusat)
  for (let j = 0; j < n; j++) {
    const y = floorY(j)
    const x = floorX[j]
    ctx.fillStyle = j === o.active ? C.orange : C.block
    ctx.fillRect(x - bw / 2 - 10, y - SLAB_H / 2, bw + 20, SLAB_H)
    ctx.fillStyle = C.mute
    ctx.font = FONT
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(j === n - 1 ? 'atap' : `lt ${j + 1}`, cx - bw / 2 - 18 + Math.min(0, x - cx - xg), y)
  }

  // label skala
  const realPx = sh / STORY_H
  ctx.fillStyle = C.mute
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(`simpangan diperbesar ×${fmtScale(s / realPx)}`, 12, 18)

  // profil simpangan (kanan)
  const px0 = narrow ? w * 0.64 : w * 0.66
  const px1 = w - (narrow ? 10 : 22)
  drawProfile(ctx, px0, px1, gy, floorY, o, narrow)

  return { cx, bw, gy, sh, n, scale: s, floorY, floorX }
}

const fmtScale = (v: number) => (v >= 100 ? Math.round(v / 10) * 10 : v >= 10 ? Math.round(v) : v.toFixed(1))

/** Profil: sumbu vertikal = lantai, horizontal = simpangan relatif u (sumbu nol di tengah). */
function drawProfile(ctx: Ctx, x0: number, x1: number, gy: number, floorY: (j: number) => number, o: StageInput, narrow: boolean) {
  const n = o.u.length
  const xm = (x0 + x1) / 2
  const half = (x1 - x0) / 2 - 6
  let maxV = 0
  for (let j = 0; j < n; j++) maxV = Math.max(maxV, o.env[j], Math.abs(o.u[j]), o.steady ? o.steady[j] : 0)
  const sc = half / Math.max(maxV * 1.1, 1e-5)
  const X = (v: number) => xm + v * sc
  const yTop = floorY(n - 1) - 18
  ctx.strokeStyle = C.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(xm, gy)
  ctx.lineTo(xm, yTop)
  for (let j = -1; j < n; j++) {
    const y = j < 0 ? gy : floorY(j)
    ctx.moveTo(x0, y)
    ctx.lineTo(x1, y)
  }
  ctx.stroke()
  ctx.fillStyle = C.ink
  ctx.font = FONT_B
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(narrow ? 'profil u' : 'profil simpangan u', xm, yTop - 2)

  const poly = (vals: number[], sign: number, color: string, dash: number[], width: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.setLineDash(dash)
    ctx.beginPath()
    ctx.moveTo(xm, gy)
    vals.forEach((v, j) => ctx.lineTo(X(sign * v), floorY(j)))
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (o.steady) for (const sg of [1, -1]) poly(o.steady, sg, C.greenSoft, [2, 3], 1.5)
  for (const sg of [1, -1]) poly(o.env, sg, C.orange, [5, 4], 1.3)
  poly(o.u, 1, C.navy, [], 2.2)
  ctx.fillStyle = C.navy
  o.u.forEach((v, j) => {
    ctx.beginPath()
    ctx.arc(X(v), floorY(j), 3.5, 0, Math.PI * 2)
    ctx.fill()
  })
  // nilai per lantai
  ctx.font = FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  for (let j = 0; j < n; j++) {
    ctx.fillStyle = C.orange
    ctx.fillText(`${narrow ? '' : 'maks '}${(o.env[j] * 100).toFixed(2)} cm`, x1, floorY(j) - 3)
  }
  // legenda kecil
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = C.navy
  ctx.fillText('— saat ini', x0, gy + 4)
  ctx.fillStyle = C.orange
  if (narrow) ctx.fillText('- - maks', x0, gy + 18)
  else ctx.fillText('- - selubung maks', x0 + 64, gy + 4)
  if (o.steady) {
    ctx.fillStyle = C.green
    ctx.fillText(narrow ? '··· tunak' : '··· tunak teori', narrow ? x0 + 56 : x0, gy + 18)
  }
}

/** Indeks lantai yang terkena pointer, atau −1. */
export function hitFloor(l: Layout, x: number, y: number): number {
  for (let j = l.n - 1; j >= 0; j--) {
    const fy = l.floorY(j)
    if (Math.abs(y - fy) <= 12 && Math.abs(x - l.floorX[j]) <= l.bw / 2 + 14) return j
  }
  return -1
}
