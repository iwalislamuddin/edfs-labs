// Fisika Room Resonance: SDOF linear dengan eksitasi harmonik.
//   Gaya harmonik:  m·ü + c·u̇ + k·u = p0·sin ψ,            ψ' = ω
//   Eksitasi dasar: m·ü + c·u̇ + k·u = −m·üg = m·ω²·ug0·sin ψ   (u relatif terhadap tanah, ug = ug0·sin ψ)
// Fase gaya ψ diintegrasikan (bukan ω·t) supaya ω bisa diubah saat berjalan tanpa loncatan gaya.
// Fisika murni tanpa DOM, diuji di physics.test.ts.

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

// ---- rumus teori (bentuk tak berdimensi) ----

/** Faktor amplifikasi dinamis (deformasi) Rd = u0 / ust. */
export const Rd = (beta: number, zeta: number) => 1 / Math.hypot(1 - beta * beta, 2 * zeta * beta)

/** Sudut fase φ (rad, 0..π): simpangan tertinggal φ dari gaya. */
export const phase = (beta: number, zeta: number) => Math.atan2(2 * zeta * beta, 1 - beta * beta)

/** Transmisibilitas TR = x0 / ug0 (perpindahan total terhadap gerak tanah) = gaya transmisi / p0. */
export const TR = (beta: number, zeta: number) => Math.hypot(1, 2 * zeta * beta) * Rd(beta, zeta)

/** Fase perpindahan total x terhadap ug pada eksitasi dasar (rad, 0..π). */
export function phaseTR(beta: number, zeta: number) {
  // x/ug = (1 + i·2ζβ) / (1 − β² + i·2ζβ)
  return phase(beta, zeta) - Math.atan(2 * zeta * beta)
}

/** Rasio frekuensi puncak Rd dan nilai puncaknya (ζ < 1/√2); di atas itu Rd turun monoton dari β = 0. */
export function rdPeak(zeta: number): { beta: number; value: number } {
  if (zeta <= 0) return { beta: 1, value: Infinity }
  if (zeta >= Math.SQRT1_2) return { beta: 0, value: 1 }
  return { beta: Math.sqrt(1 - 2 * zeta * zeta), value: 1 / (2 * zeta * Math.sqrt(1 - zeta * zeta)) }
}

/** β batas isolasi getaran: TR < 1 untuk β > √2 (semua ζ). */
export const ISOLATION_BETA = Math.SQRT2

/**
 * Solusi analitis lengkap gaya harmonik dari keadaan diam (u = v = 0, ψ = 0), 0 ≤ ζ < 1.
 * u = up(t) + e^(−ζωn t)·(A cos ωd t + B sin ωd t); kasus khusus ζ = 0, β = 1 (resonansi murni).
 */
export function analytic(s: Forced, t: number): number {
  const wn = Math.sqrt(s.k / s.m)
  const zeta = s.c / (2 * Math.sqrt(s.k * s.m))
  const ust = s.p0 / s.k
  const beta = s.w / wn
  if (zeta === 0 && Math.abs(beta - 1) < 1e-12) return (ust / 2) * (Math.sin(wn * t) - wn * t * Math.cos(wn * t))
  const u0 = ust * Rd(beta, zeta)
  const ph = phase(beta, zeta)
  const wd = wn * Math.sqrt(1 - zeta * zeta)
  // up = u0 sin(ωt − φ); up(0) = −u0 sin φ, up'(0) = u0 ω cos φ
  const A = u0 * Math.sin(ph)
  const B = (-u0 * s.w * Math.cos(ph) + zeta * wn * A) / wd
  return u0 * Math.sin(s.w * t - ph) + Math.exp(-zeta * wn * t) * (A * Math.cos(wd * t) + B * Math.sin(wd * t))
}

/** Keadaan tunak (u, v) pada fase gaya ψ: u = u0 sin(ψ − φ). */
export function steadyState(s: Forced, psi: number): FState {
  const wn = Math.sqrt(s.k / s.m)
  const zeta = s.c / (2 * Math.sqrt(s.k * s.m))
  const beta = s.w / wn
  const u0 = (s.p0 / s.k) * Rd(beta, zeta)
  const ph = phase(beta, zeta)
  return { u: u0 * Math.sin(psi - ph), v: u0 * s.w * Math.cos(psi - ph), psi }
}

/** Mengubah sudut ke rentang [0, 2π). */
export const wrap2pi = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

// ---- "pengukuran": simulasi sampai tunak, lalu baca amplitudo & fase dari puncak ----

export type Excite = 'force' | 'base'

export interface Measured {
  beta: number
  ratio: number // Rd (gaya) atau TR (dasar)
  phase: number // rad
}

/**
 * Mengukur respons tunak dengan integrasi numerik dari keadaan diam (bentuk tak berdimensi: m = 1, ωn = 1).
 * Tunak = tiga puncak berturut-turut berbeda < tol relatif. Mengembalikan null bila tidak tunak (mis. ζ = 0).
 */
export function measure(beta: number, zeta: number, excite: Excite, tol = 2e-4): Measured | null {
  const w = beta
  const s: Forced = { m: 1, k: 1, c: 2 * zeta, p0: excite === 'force' ? 1 : w * w, w }
  const Tf = (2 * Math.PI) / Math.max(w, 1e-6)
  const h = Math.min(2 * Math.PI, Tf) / 400
  const tMax = Math.max(60 * Tf, zeta > 0 ? 14 / zeta : 0, 200)
  let x: FState = { u: 0, v: 0, psi: 0 }
  let t = 0
  let prevY = 0
  let prevDy = 0
  const amps: number[] = []
  while (t < tMax) {
    const n = step(s, x, h)
    t += h
    // besaran yang diukur: u (gaya) atau x = u + ug (dasar)
    const y = excite === 'force' ? n.u : n.u + Math.sin(n.psi)
    const dy = y - prevY
    if (prevDy > 0 && dy <= 0 && t > h * 3) {
      // puncak: interpolasi parabola tiga titik (yPrev2, prevY, y)
      const y0 = prevY - prevDy
      const y1 = prevY
      const y2 = y
      const den = y0 - 2 * y1 + y2
      const d = den !== 0 ? (0.5 * (y0 - y2)) / den : 0
      const peak = y1 - 0.25 * (y0 - y2) * d
      const psiPeak = x.psi + d * h * w // fase gaya di puncak (x = keadaan sebelum n = titik tengah)
      amps.push(peak)
      const k = amps.length
      if (k >= 4) {
        const a = amps[k - 1]
        const ok = [amps[k - 2], amps[k - 3]].every((b) => Math.abs(a - b) <= tol * Math.abs(a))
        if (ok) {
          // puncak y saat ψ − φ = π/2  →  φ = ψ − π/2
          let ph = wrap2pi(psiPeak - Math.PI / 2)
          if (ph > 1.5 * Math.PI) ph -= 2 * Math.PI // galat kecil di sekitar 0
          return { beta, ratio: a, phase: ph }
        }
      }
    }
    prevDy = dy
    prevY = y
    x = n
  }
  return null
}
