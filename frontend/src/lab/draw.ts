// Primitif gambar canvas 2D yang dipakai banyak Room.
import { C, FONT } from './theme'

type Ctx = CanvasRenderingContext2D

/** Pegas zig-zag dari (x1,y1) ke (x2,y2). */
export function spring(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, coils = 12, amp = 12) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const lead = Math.min(14, len * 0.12)
  const body = len - 2 * lead
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 + ux * lead, y1 + uy * lead)
  const n = coils * 2
  for (let i = 1; i < n; i++) {
    const t = lead + (body * i) / n
    const side = i % 2 === 1 ? 1 : -1
    ctx.lineTo(x1 + ux * t + nx * amp * side, y1 + uy * t + ny * amp * side)
  }
  ctx.lineTo(x2 - ux * lead, y2 - uy * lead)
  ctx.lineTo(x2, y2)
  ctx.strokeStyle = C.steel
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.stroke()
}

/** Peredam (dashpot): silinder menempel di (x1,y1), batang piston menempel di (x2,y2). */
export function dashpot(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, restLen: number, w = 14) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const lead = restLen * 0.12
  const cyl = restLen * 0.5
  const rod = restLen * 0.45
  const p = (t: number, s = 0): [number, number] => [x1 + ux * t + nx * s, y1 + uy * t + ny * s]
  ctx.strokeStyle = C.steel
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(...p(lead))
  // silinder (terbuka di ujung jauh)
  ctx.moveTo(...p(lead + cyl, w / 2))
  ctx.lineTo(...p(lead, w / 2))
  ctx.lineTo(...p(lead, -w / 2))
  ctx.lineTo(...p(lead + cyl, -w / 2))
  ctx.stroke()
  // piston
  const piston = Math.min(lead + cyl - 3, Math.max(lead + 4, len - rod))
  ctx.beginPath()
  ctx.moveTo(...p(piston, w / 2 - 3))
  ctx.lineTo(...p(piston, -w / 2 + 3))
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(...p(piston))
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

/** Tumpuan jepit berarsir: garis dari (x1,y) ke (x2,y), arsir ke arah `side` (-1 = atas, 1 = bawah). */
export function hatchH(ctx: Ctx, x1: number, x2: number, y: number, side: -1 | 1) {
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = C.mute
  ctx.beginPath()
  for (let x = x1 + 4; x < x2; x += 10) {
    ctx.moveTo(x, y)
    ctx.lineTo(x - 8, y + side * 9)
  }
  ctx.stroke()
}

export function hatchV(ctx: Ctx, x: number, y1: number, y2: number, side: -1 | 1) {
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y1)
  ctx.lineTo(x, y2)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = C.mute
  ctx.beginPath()
  for (let y = y1 + 4; y < y2; y += 10) {
    ctx.moveTo(x, y)
    ctx.lineTo(x + side * 9, y - 8)
  }
  ctx.stroke()
}

/** Garis referensi putus-putus dengan label. */
export function refLineH(ctx: Ctx, x1: number, x2: number, y: number, label: string, color: string, dash: number[]) {
  ctx.save()
  ctx.setLineDash(dash)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = color
  ctx.font = FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(label, x2, y - 3)
}

export function refLineV(ctx: Ctx, x: number, y1: number, y2: number, label: string, color: string, dash: number[]) {
  ctx.save()
  ctx.setLineDash(dash)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y1)
  ctx.lineTo(x, y2)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = color
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(label, x, y2 + 3)
}

/** Panah dari (x1,y1) ke (x2,y2). */
export function arrow(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width = 2.5) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  if (len < 2) return
  const ux = (x2 - x1) / len
  const uy = (y2 - y1) / len
  const head = Math.min(10, len * 0.5)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2 - ux * head, y2 - uy * head)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - ux * head - uy * head * 0.5, y2 - uy * head + ux * head * 0.5)
  ctx.lineTo(x2 - ux * head + uy * head * 0.5, y2 - uy * head - ux * head * 0.5)
  ctx.closePath()
  ctx.fill()
}

/** Ukuran (dimension) vertikal dengan panah dua arah dan label. */
export function dimV(ctx: Ctx, x: number, y1: number, y2: number, label: string, color: string, labelSide: -1 | 1 = 1) {
  if (Math.abs(y2 - y1) < 3) return
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y1)
  ctx.lineTo(x, y2)
  ctx.moveTo(x - 4, y1)
  ctx.lineTo(x + 4, y1)
  ctx.moveTo(x - 4, y2)
  ctx.lineTo(x + 4, y2)
  ctx.stroke()
  ctx.font = FONT
  ctx.textAlign = labelSide === 1 ? 'left' : 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + labelSide * 7, (y1 + y2) / 2)
}

export function dimH(ctx: Ctx, x1: number, x2: number, y: number, label: string, color: string) {
  if (Math.abs(x2 - x1) < 3) return
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.moveTo(x1, y - 4)
  ctx.lineTo(x1, y + 4)
  ctx.moveTo(x2, y - 4)
  ctx.lineTo(x2, y + 4)
  ctx.stroke()
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(label, (x1 + x2) / 2, y + 5)
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Menyesuaikan ukuran canvas dengan elemen dan devicePixelRatio; mengembalikan ukuran CSS. */
export function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number; ctx: Ctx } {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { w, h, ctx }
}
