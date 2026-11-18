// Rumus klasik (solusi tangan) untuk dibandingkan dengan hasil metode kekakuan. Satuan kN, m.
// Konvensi: beban P dan q ke bawah bernilai positif; momen positif = sagging (serat bawah tertarik).
import type { Params } from './model'

/** Balok sederhana sendi–rol, P di jarak a dari kiri + q merata penuh. */
export function simpleBeam(L: number, P: number, a: number, q: number, EI: number) {
  const b = L - a
  const RA = (P * b) / L + (q * L) / 2
  const RB = P + q * L - RA
  const M = (x: number) => RA * x - (q * x * x) / 2 - (x > a ? P * (x - a) : 0)
  // momen maksimum: di bawah P atau di titik V = 0 akibat q
  const cand = [a, 0, L]
  if (q > 0) {
    const x1 = RA / q // V = 0 sebelum P
    if (x1 > 0 && x1 < a) cand.push(x1)
    const x2 = (RA - P) / q // V = 0 sesudah P
    if (x2 > a && x2 < L) cand.push(x2)
  }
  let xMax = cand[0]
  for (const x of cand) if (M(x) > M(xMax)) xMax = x
  // lendutan di tengah bentang (ke bawah positif)
  const x = L / 2
  const dP = x <= a ? (P * b * x * (L * L - b * b - x * x)) / (6 * L * EI) : (P * a * (L - x) * (L * L - a * a - (L - x) ** 2)) / (6 * L * EI)
  const dMid = dP + (5 * q * L ** 4) / (384 * EI)
  return { RA, RB, Mmax: M(xMax), xMax, dMid }
}

/** Kantilever jepit di kiri, P di jarak a dari jepit + q merata penuh. */
export function cantilever(L: number, P: number, a: number, q: number, EI: number) {
  const R = P + q * L
  const MA = -(P * a + (q * L * L) / 2) // hogging
  const dTip = (P * a * a * (3 * L - a)) / (6 * EI) + (q * L ** 4) / (8 * EI)
  return { R, MA, dTip }
}

/** Balok menerus dua bentang (sendi–rol–rol) dengan persamaan tiga momen Clapeyron. a diukur dari tumpuan kiri. */
export function continuous2(L1: number, L2: number, P: number, a: number, q: number) {
  let rhs = (q * L1 ** 3) / 4 + (q * L2 ** 3) / 4
  if (a <= L1) rhs += (P * a * (L1 * L1 - a * a)) / L1
  else {
    const b = L1 + L2 - a // jarak dari tumpuan kanan
    rhs += (P * b * (L2 * L2 - b * b)) / L2
  }
  const MB = -rhs / (2 * (L1 + L2))
  // reaksi bentang sederhana + koreksi momen tumpuan
  let RA0 = (q * L1) / 2
  let RC0 = (q * L2) / 2
  if (a <= L1) RA0 += (P * (L1 - a)) / L1
  else RC0 += (P * (a - L1)) / L2
  const RA = RA0 + MB / L1
  const RC = RC0 + MB / L2
  const RB = P + q * (L1 + L2) - RA - RC
  return { MB, RA, RB, RC }
}

/**
 * Portal dua sendi (kolom sama tinggi h, inersia Ic; balok bentang L, Ib = r·Ic): gaya horizontal tumpuan H akibat q merata
 * dan P di jarak a pada balok (metode gaya / unit load, deformasi aksial diabaikan). H mendorong ke dalam.
 */
export function portalHingedH(L: number, h: number, q: number, P: number, a: number, r: number) {
  const k = (r * h) / L
  const fromQ = (q * L * L) / (4 * h * (2 * k + 3))
  const fromP = (3 * P * a * (L - a)) / (2 * h * L * (2 * k + 3))
  return fromQ + fromP
}

/** Rangka: reaksi kiri dan gaya batang bawah tengah-kiri dengan metode potongan (Ritter). */
export function trussChord(p: Params) {
  const n = Math.max(2, Math.round(p.n / 2) * 2)
  const dx = p.L / n
  const loads: { x: number; F: number }[] = []
  const iP = Math.round(Math.min(p.L, Math.max(0, p.a)) / dx)
  if (p.P) loads.push({ x: iP * dx, F: p.P })
  if (p.w) for (let i = 1; i < n; i++) loads.push({ x: i * dx, F: p.w })
  const total = loads.reduce((s, l) => s + l.F, 0)
  const RA = loads.reduce((s, l) => s + (l.F * (p.L - l.x)) / p.L, 0)
  const M = (x: number) => RA * x - loads.reduce((s, l) => s + (l.x < x ? l.F * (x - l.x) : 0), 0)
  const m = n / 2
  const tp = Math.round(p.tp)
  // titik momen = pertemuan batang atas dan diagonal yang ikut terpotong
  const xc = tp === 2 ? (m - 0.5) * dx : tp === 0 && m > 1 ? (m - 1) * dx : m * dx
  return { RA, RB: total - RA, total, xc, F: M(xc) / p.h }
}
