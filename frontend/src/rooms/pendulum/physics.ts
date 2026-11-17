// Fisika murni Room Pendulum (tanpa DOM), diuji di physics.test.ts.
//
// 1 DOF (bandul sederhana & bandul fisik):  I·θ̈ + c·θ̇ + m·g·d·sin θ = 0
//   sederhana: I = m·L², d = L      fisik (batang): I = m·(L²/12 + d²), d = jarak sendi ke titik berat
//   model linear (sudut kecil): sin θ ≈ θ
// 2 DOF (bandul ganda, dua massa titik), sudut diukur dari garis vertikal ke bawah, peredam rotasi c di
// sendi atas (terhadap θ̇₁) dan di sendi tengah (terhadap θ̇₂ − θ̇₁).

// ---------------- 1 DOF ----------------

export interface Pend1 {
  I: number // kg·m²
  mgd: number // N·m (momen pemulih per sin θ)
  c: number // N·m·s/rad
  linear?: boolean
}

/** y = [θ, ω] */
export const pend1Deriv = (p: Pend1) => (y: number[]) => [y[1], (-p.mgd * (p.linear ? y[0] : Math.sin(y[0])) - p.c * y[1]) / p.I]

export interface Modal1 {
  w0: number
  f0: number
  T0: number // periode sudut kecil
  zeta: number
  cCrit: number
}

export function pend1Modal(p: Pend1): Modal1 {
  const w0 = Math.sqrt(p.mgd / p.I)
  const cCrit = 2 * Math.sqrt(p.mgd * p.I)
  return { w0, f0: w0 / (2 * Math.PI), T0: (2 * Math.PI) / w0, zeta: p.c / cCrit, cCrit }
}

/** Rata-rata aritmetika–geometri. */
export function agm(a: number, b: number): number {
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)]
  return (a + b) / 2
}

/**
 * Periode eksak bandul tanpa redaman untuk amplitudo θ₀ (rad):
 * T = 4·√(I/mgd)·K(sin(θ₀/2)) = T₀ / AGM(1, cos(θ₀/2)).
 */
export function periodLarge(T0: number, amp: number): number {
  const a = Math.abs(amp)
  if (a >= Math.PI) return Infinity
  return T0 / agm(1, Math.cos(a / 2))
}

/** Energi: kinetik ½Iω², potensial terhadap posisi terendah. */
export function pend1Energy(p: Pend1, y: number[]) {
  const ep = p.linear ? 0.5 * p.mgd * y[0] * y[0] : p.mgd * (1 - Math.cos(y[0]))
  return { ek: 0.5 * p.I * y[1] * y[1], ep }
}

export const simpleSystem = (m: number, L: number, g: number, c: number): Pend1 => ({ I: m * L * L, mgd: m * g * L, c })

export const rodInertia = (m: number, L: number, d: number) => m * (L * L / 12 + d * d)
export const rodSystem = (m: number, L: number, d: number, g: number, c: number): Pend1 => ({ I: rodInertia(m, L, d), mgd: m * g * d, c })

/** Panjang bandul sederhana ekivalen (pusat osilasi) bandul fisik: Leq = I / (m·d). */
export const rodLeq = (L: number, d: number) => (L * L) / 12 / d + d

// ---------------- 2 DOF (bandul ganda) ----------------

export interface Pend2 {
  m1: number
  m2: number
  L1: number
  L2: number
  g: number
  c: number
}

/** Percepatan sudut [θ̈₁, θ̈₂] dari persamaan Lagrange (matriks massa 2×2 diselesaikan langsung). y = [θ₁, θ₂, ω₁, ω₂] */
export function pend2Accel(p: Pend2, y: number[]): [number, number] {
  const [t1, t2, w1, w2] = y
  const { m1, m2, L1, L2, g, c } = p
  const d = t1 - t2
  const cd = Math.cos(d)
  const sd = Math.sin(d)
  const a = (m1 + m2) * L1 * L1
  const b = m2 * L1 * L2 * cd
  const e = m2 * L2 * L2
  const rel = w2 - w1
  const r1 = -m2 * L1 * L2 * w2 * w2 * sd - (m1 + m2) * g * L1 * Math.sin(t1) - c * w1 + c * rel
  const r2 = m2 * L1 * L2 * w1 * w1 * sd - m2 * g * L2 * Math.sin(t2) - c * rel
  const det = a * e - b * b
  return [(r1 * e - b * r2) / det, (a * r2 - b * r1) / det]
}

export const pend2Deriv = (p: Pend2) => (y: number[]) => {
  const [a1, a2] = pend2Accel(p, y)
  return [y[2], y[3], a1, a2]
}

/** Energi kinetik & potensial (terhadap posisi terendah kedua massa). */
export function pend2Energy(p: Pend2, y: number[]) {
  const [t1, t2, w1, w2] = y
  const { m1, m2, L1, L2, g } = p
  const ek = 0.5 * (m1 + m2) * L1 * L1 * w1 * w1 + 0.5 * m2 * L2 * L2 * w2 * w2 + m2 * L1 * L2 * w1 * w2 * Math.cos(t1 - t2)
  const ep = (m1 + m2) * g * L1 * (1 - Math.cos(t1)) + m2 * g * L2 * (1 - Math.cos(t2))
  return { ek, ep }
}

export interface Modes2 {
  w: [number, number]
  T: [number, number]
  /** rasio bentuk mode φ₂/φ₁ untuk mode 1 (sefase) dan mode 2 (berlawanan fase) */
  shape: [number, number]
}

/** Mode normal sudut kecil: K·φ = ω²·M·φ dengan M = [[(m1+m2)L1², m2L1L2],[m2L1L2, m2L2²]], K = diag((m1+m2)gL1, m2gL2). */
export function pend2Modes(p: Pend2): Modes2 {
  const { m1, m2, L1, L2, g } = p
  const a = (m1 + m2) * L1 * L1
  const b = m2 * L1 * L2
  const e = m2 * L2 * L2
  const k1 = (m1 + m2) * g * L1
  const k2 = m2 * g * L2
  const A = a * e - b * b
  const B = a * k2 + e * k1
  const Cc = k1 * k2
  const disc = Math.sqrt(Math.max(0, B * B - 4 * A * Cc))
  const l1 = (B - disc) / (2 * A)
  const l2 = (B + disc) / (2 * A)
  const ratio = (l: number) => (k1 - l * a) / (l * b)
  const w1 = Math.sqrt(l1)
  const w2 = Math.sqrt(l2)
  return { w: [w1, w2], T: [(2 * Math.PI) / w1, (2 * Math.PI) / w2], shape: [ratio(l1), ratio(l2)] }
}
