// Inti SDOF linear: M q'' + C q' + K q = F (F konstan, mis. berat).
// Fisika murni tanpa DOM, diuji di sdof.test.ts.

export interface Sdof {
  M: number
  K: number
  C: number
  F: number
}

export interface SimState {
  q: number
  v: number
}

export function accel(p: Sdof, q: number, v: number): number {
  return (p.F - p.K * q - p.C * v) / p.M
}

/** Satu langkah Runge-Kutta orde 4. */
export function rk4(p: Sdof, s: SimState, h: number): SimState {
  const k1q = s.v
  const k1v = accel(p, s.q, s.v)
  const k2q = s.v + 0.5 * h * k1v
  const k2v = accel(p, s.q + 0.5 * h * k1q, s.v + 0.5 * h * k1v)
  const k3q = s.v + 0.5 * h * k2v
  const k3v = accel(p, s.q + 0.5 * h * k2q, s.v + 0.5 * h * k2v)
  const k4q = s.v + h * k3v
  const k4v = accel(p, s.q + h * k3q, s.v + h * k3v)
  return {
    q: s.q + (h / 6) * (k1q + 2 * k2q + 2 * k3q + k4q),
    v: s.v + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v),
  }
}

export interface Modal {
  wn: number
  fn: number
  Tn: number
  zeta: number
  wd: number
  Td: number
  qeq: number
  cCrit: number
}

export function modal(p: Sdof): Modal {
  const wn = Math.sqrt(p.K / p.M)
  const cCrit = 2 * Math.sqrt(p.K * p.M)
  const zeta = p.C / cCrit
  const wd = zeta < 1 ? wn * Math.sqrt(1 - zeta * zeta) : 0
  return {
    wn,
    fn: wn / (2 * Math.PI),
    Tn: (2 * Math.PI) / wn,
    zeta,
    wd,
    Td: wd > 0 ? (2 * Math.PI) / wd : Infinity,
    qeq: p.F / p.K,
    cCrit,
  }
}

/** Energi terhadap kesetimbangan (untuk sistem vertikal sudah termasuk potensial gravitasi). */
export function energy(p: Sdof, s: SimState): { ek: number; ep: number } {
  const u = s.q - p.F / p.K
  return { ek: 0.5 * p.M * s.v * s.v, ep: 0.5 * p.K * u * u }
}

export type DampingKind = 'none' | 'under' | 'critical' | 'over'

export function dampingKind(zeta: number): DampingKind {
  if (zeta === 0) return 'none'
  if (Math.abs(zeta - 1) < 0.01) return 'critical'
  return zeta < 1 ? 'under' : 'over'
}
