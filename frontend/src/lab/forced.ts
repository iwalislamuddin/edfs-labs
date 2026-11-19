// SDOF linear dengan gaya harmonik p0·sin ψ, ψ' = ω (fase diintegrasikan supaya ω bisa diubah saat berjalan).
// Dipakai Room Resonance (langsung) dan Room Shear Building (per koordinat modal).

export interface Forced {
  m: number
  k: number
  c: number
  /** Amplitudo gaya efektif (N): p0, atau m·ω²·ug0 untuk eksitasi dasar. */
  p0: number
  w: number // rad/s
}

export interface FState {
  u: number
  v: number
  psi: number // fase gaya (rad)
}

const acc = (s: Forced, u: number, v: number, psi: number) => (s.p0 * Math.sin(psi) - s.k * u - s.c * v) / s.m

/** Satu langkah RK4 untuk keadaan (u, v, ψ). ψ linear terhadap waktu, jadi nilainya di tiap tahap eksak. */
export function step(s: Forced, x: FState, h: number): FState {
  const p0 = x.psi
  const p1 = x.psi + 0.5 * h * s.w
  const p2 = x.psi + h * s.w
  const k1u = x.v
  const k1v = acc(s, x.u, x.v, p0)
  const k2u = x.v + 0.5 * h * k1v
  const k2v = acc(s, x.u + 0.5 * h * k1u, x.v + 0.5 * h * k1v, p1)
  const k3u = x.v + 0.5 * h * k2v
  const k3v = acc(s, x.u + 0.5 * h * k2u, x.v + 0.5 * h * k2v, p1)
  const k4u = x.v + h * k3v
  const k4v = acc(s, x.u + h * k3u, x.v + h * k3v, p2)
  let psi = p2
  if (psi > 1e4) psi -= Math.floor(psi / (2 * Math.PI)) * 2 * Math.PI
  return {
    u: x.u + (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u),
    v: x.v + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v),
    psi,
  }
}
