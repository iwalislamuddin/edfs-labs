// Inti MDOF bangunan geser (shear building): massa terpusat per lantai, kekakuan geser per tingkat.
//   M ü + C u̇ + K u = −M·1·üg   (u relatif terhadap tanah, lantai 1 = terbawah)
// Redaman klasik (rasio ζ sama untuk semua mode) → persamaan terurai menjadi N SDOF modal.
// Fisika murni tanpa DOM, diuji di mdof.test.ts. Dipakai Room Shear Building (dan nanti Earthquake).

import { step, type FState } from './forced'

export type Mat = number[][]

/** Matriks kekakuan tridiagonal dari kekakuan tingkat ks (ks[0] = tingkat dasar). */
export function stiffness(ks: number[]): Mat {
  const n = ks.length
  const K: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    K[i][i] = ks[i] + (i + 1 < n ? ks[i + 1] : 0)
    if (i + 1 < n) {
      K[i][i + 1] = -ks[i + 1]
      K[i + 1][i] = -ks[i + 1]
    }
  }
  return K
}

/** Nilai & vektor eigen matriks simetris (metode Jacobi siklik). Kolom vecs[:, i] ↔ vals[i]. */
export function jacobiEigen(A0: Mat): { vals: number[]; vecs: Mat } {
  const n = A0.length
  const A = A0.map((r) => r.slice())
  const V: Mat = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q]
    if (off < 1e-30) break
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = A[k][p]
          const akq = A[k][q]
          A[k][p] = c * akp - s * akq
          A[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k]
          const aqk = A[q][k]
          A[p][k] = c * apk - s * aqk
          A[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p]
          const vkq = V[k][q]
          V[k][p] = c * vkp - s * vkq
          V[k][q] = s * vkp + c * vkq
        }
      }
  }
  return { vals: A.map((r, i) => r[i]), vecs: V }
}

export interface Modes {
  n: number
  ms: number[]
  ks: number[]
  /** Frekuensi sudut ωn (rad/s), naik. */
  w: number[]
  T: number[]
  /** phi[n][j]: komponen lantai j pada mode n, ternormalisasi massa (φᵀMφ = 1), atap positif. */
  phi: Mat
  /** Faktor partisipasi Γn = φnᵀ·M·1. */
  gamma: number[]
  /** Massa efektif modal Γn² (kg) — jumlahnya = massa total. */
  meff: number[]
}

/** Analisis modal bangunan geser: K φ = ω² M φ (M diagonal). */
export function modes(ms: number[], ks: number[]): Modes {
  const n = ms.length
  const K = stiffness(ks)
  const r = ms.map((m) => 1 / Math.sqrt(m))
  const A = K.map((row, i) => row.map((v, j) => v * r[i] * r[j]))
  const { vals, vecs } = jacobiEigen(A)
  const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b])
  const w: number[] = []
  const phi: Mat = []
  for (const i of order) {
    w.push(Math.sqrt(Math.max(vals[i], 0)))
    const v = vecs.map((row, j) => row[i] * r[j])
    const sgn = v[n - 1] < 0 ? -1 : 1
    phi.push(v.map((x) => x * sgn))
  }
  const gamma = phi.map((p) => p.reduce((s, x, j) => s + x * ms[j], 0))
  return { n, ms, ks, w, T: w.map((x) => (2 * Math.PI) / x), phi, gamma, meff: gamma.map((g) => g * g) }
}

/** Bentuk mode dinormalisasi atap = 1 (untuk gambar dan tabel). */
export const shapeRoof = (md: Modes, k: number) => md.phi[k].map((x) => x / md.phi[k][md.n - 1])

/** Koordinat modal qn = φnᵀ·M·u. */
export const toModal = (md: Modes, u: number[]) => md.phi.map((p) => p.reduce((s, x, j) => s + x * md.ms[j] * u[j], 0))

/** u = Σ φn·qn. */
export function fromModal(md: Modes, q: number[]): number[] {
  const u = new Array<number>(md.n).fill(0)
  for (let k = 0; k < md.n; k++) for (let j = 0; j < md.n; j++) u[j] += md.phi[k][j] * q[k]
  return u
}

/** Penyelesaian sistem linear kecil (eliminasi Gauss dengan pivot parsial). */
export function solve(A0: Mat, b0: number[]): number[] {
  const n = b0.length
  const A = A0.map((r) => r.slice())
  const b = b0.slice()
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    ;[b[c], b[p]] = [b[p], b[c]]
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]
    x[r] = s / A[r][r]
  }
  return x
}

/** Bentuk lendutan statis akibat gaya lateral di lantai j, diskalakan agar u[j] = d. */
export function pushShape(ks: number[], j: number, d: number): number[] {
  const e = ks.map((_, i) => (i === j ? 1 : 0))
  const x = solve(stiffness(ks), e)
  return x.map((v) => (v / x[j]) * d)
}

/** Matriks redaman klasik C = M·Φ·diag(2ζωn)·Φᵀ·M (ζ sama untuk semua mode). */
export function classicalDamping(md: Modes, zeta: number): Mat {
  const n = md.n
  const C: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let k = 0; k < n; k++) {
    const c = 2 * zeta * md.w[k]
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) C[i][j] += md.ms[i] * md.phi[k][i] * c * md.phi[k][j] * md.ms[j]
  }
  return C
}

/**
 * Amplitudo tunak simpangan relatif tiap lantai akibat gerak tanah ug = ug0·sin ωt (m).
 * u = Σ φn·Γn·ω²·ug0 / (ωn² − ω² + i·2ζωnω)  (superposisi modal kompleks).
 */
export function steadyRel(md: Modes, zeta: number, w: number, ug0: number): number[] {
  const out: number[] = []
  for (let j = 0; j < md.n; j++) {
    let re = 0
    let im = 0
    for (let k = 0; k < md.n; k++) {
      const a = md.w[k] * md.w[k] - w * w
      const b = 2 * zeta * md.w[k] * w
      const den = a * a + b * b
      const g = md.phi[k][j] * md.gamma[k]
      re += (g * a) / den
      im += (-g * b) / den
    }
    out.push(w * w * ug0 * Math.hypot(re, im))
  }
  return out
}

/** Frekuensi alami bangunan geser seragam (m, k sama): ωj = 2·√(k/m)·sin((2j−1)π / (2(2N+1))). */
export const uniformW = (N: number, m: number, k: number, j: number) =>
  2 * Math.sqrt(k / m) * Math.sin(((2 * j - 1) * Math.PI) / (2 * (2 * N + 1)))

// ---- simulasi modal (dipakai Room) ----


/** Satu langkah semua koordinat modal; gerak tanah ug = ug0·sin ψ (ug0 = 0 → getaran bebas). */
export function stepModal(md: Modes, zeta: number, q: FState[], w: number, ug0: number, h: number): FState[] {
  return q.map((s, k) => {
    const wn = md.w[k]
    return step({ m: 1, k: wn * wn, c: 2 * zeta * wn, p0: md.gamma[k] * w * w * ug0, w }, s, h)
  })
}

/** Keadaan modal tunak pada fase tanah ψ (tanpa transien). */
export function steadyModal(md: Modes, zeta: number, w: number, ug0: number, psi: number): FState[] {
  return md.w.map((wn, k) => {
    const a = wn * wn - w * w
    const b = 2 * zeta * wn * w
    const amp = (md.gamma[k] * w * w * ug0) / Math.hypot(a, b)
    const ph = Math.atan2(b, a)
    return { u: amp * Math.sin(psi - ph), v: amp * w * Math.cos(psi - ph), psi }
  })
}

/**
 * Amplitudo tunak atap (relatif) hasil simulasi dari diam: tiga puncak berturut-turut berbeda < tol.
 * null bila tidak tunak dalam batas waktu.
 */
export function measureRoof(md: Modes, zeta: number, w: number, ug0: number, tol = 5e-4): number | null {
  if (zeta <= 0) return null
  const n = md.n
  const Tf = (2 * Math.PI) / w
  const h = Math.min(Tf, md.T[n - 1]) / 60
  const tMax = Math.max(40 * Tf, 12 / (zeta * md.w[0]))
  let q: FState[] = md.w.map(() => ({ u: 0, v: 0, psi: 0 }))
  const roof = (qs: FState[]) => qs.reduce((s, x, k) => s + md.phi[k][n - 1] * x.u, 0)
  let y0 = 0
  let y1 = 0
  const amps: number[] = []
  for (let t = 0; t < tMax; t += h) {
    q = stepModal(md, zeta, q, w, ug0, h)
    const y2 = roof(q)
    if (y1 > y0 && y1 >= y2 && y1 > 0) {
      const den = y0 - 2 * y1 + y2
      const d = den !== 0 ? (0.5 * (y0 - y2)) / den : 0
      amps.push(y1 - 0.25 * (y0 - y2) * d)
      const k = amps.length
      if (k >= 4 && [amps[k - 2], amps[k - 3], amps[k - 4]].every((b) => Math.abs(amps[k - 1] - b) <= tol * amps[k - 1]))
        return amps[k - 1]
    }
    y0 = y1
    y1 = y2
  }
  return null
}
