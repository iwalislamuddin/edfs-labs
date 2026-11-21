// Fisika Room Buckling: tekuk kolom Euler (4 kondisi tumpuan, mode tinggi), elemen hingga balok-kolom (kekakuan
// elastis + geometrik → eigen), kolom tak sempurna (lengkung awal e0 + eksentrisitas beban e), plot Southwell,
// kurva kolom SNI 1729 (E3) dan Perry–Robertson, serta elastica pasca-tekuk (integral eliptik vs RK4).
// Satuan internal: N, mm, MPa (N/mm²). x = koordinat sepanjang kolom dari dasar, w = lendutan lateral.
import { agm } from '../pendulum/physics'
import { jacobiEigen, solve, type Mat } from '../../lab/mdof'
import { rk4Vec } from '../../lab/ode'

export type Support = 'sendi' | 'jepit-bebas' | 'jepit-sendi' | 'jepit'

/** Dasar selalu di x = 0. base/top: 'fix' (w = 0, θ = 0), 'pin' (w = 0), 'free'. */
export const SUPPORTS: { id: Support; label: string; base: 'fix' | 'pin'; top: 'fix' | 'pin' | 'free'; K: number; Krec: number }[] = [
  { id: 'sendi', label: 'Sendi–sendi', base: 'pin', top: 'pin', K: 1, Krec: 1 },
  { id: 'jepit-bebas', label: 'Jepit–bebas', base: 'fix', top: 'free', K: 2, Krec: 2.1 },
  { id: 'jepit-sendi', label: 'Jepit–sendi', base: 'fix', top: 'pin', K: Math.PI / 4.493409457909064, Krec: 0.8 },
  { id: 'jepit', label: 'Jepit–jepit', base: 'fix', top: 'fix', K: 0.5, Krec: 0.65 },
]
export const support = (s: Support) => SUPPORTS.find((x) => x.id === s)!

// ---------------------------------------------------------------- Euler analitis

/** Persamaan karakteristik f(βL) = 0 untuk w'''' + β²w'' = 0 (β² = P/EI). */
function charEq(s: Support, z: number) {
  switch (s) {
    case 'sendi':
      return Math.sin(z)
    case 'jepit-bebas':
      return Math.cos(z)
    case 'jepit-sendi':
      return Math.sin(z) - z * Math.cos(z)
    case 'jepit':
      return 2 - 2 * Math.cos(z) - z * Math.sin(z)
  }
}

/** n akar positif pertama βL (dipindai lalu dibagi dua). */
export function betaL(s: Support, n: number): number[] {
  const out: number[] = []
  const dz = 0.01
  let z0 = 0.05
  let f0 = charEq(s, z0)
  while (out.length < n && z0 < 200) {
    const z1 = z0 + dz
    const f1 = charEq(s, z1)
    if (f0 === 0 || f0 * f1 < 0) {
      let a = z0
      let b = z1
      let fa = f0
      for (let i = 0; i < 80; i++) {
        const m = (a + b) / 2
        const fm = charEq(s, m)
        if (fa * fm <= 0) b = m
        else {
          a = m
          fa = fm
        }
      }
      out.push((a + b) / 2)
    }
    z0 = z1
    f0 = f1
  }
  return out
}

/** Beban kritis mode n (N): Pcr = (βL)²·EI/L². */
export const pcr = (s: Support, EI: number, L: number, n = 1) => {
  const z = betaL(s, n)[n - 1]
  return (z * z * EI) / (L * L)
}

/** Faktor panjang efektif mode n: Le = π/β → K = π/(βL). */
export const kEff = (s: Support, n = 1) => Math.PI / betaL(s, n)[n - 1]

/** Bentuk mode w = A sin βx + B cos βx + C x + D (koefisien untuk x dalam satuan L = 1). */
export interface ModeShape {
  A: number
  B: number
  C: number
  D: number
  beta: number // per satuan panjang L = 1
  scale: number // 1 / maks|w|
}

export function modeShape(s: Support, n = 1): ModeShape {
  const z = betaL(s, n)[n - 1]
  let A = 0
  let B = 0
  let C = 0
  let D = 0
  switch (s) {
    case 'sendi':
      A = 1
      break
    case 'jepit-bebas':
      B = -1
      D = 1
      break
    case 'jepit-sendi':
      A = 1
      B = -z
      C = -z
      D = z
      break
    case 'jepit':
      A = Math.cos(z) - 1
      B = -(Math.sin(z) - z)
      C = -A * z
      D = -B
      break
  }
  const m: ModeShape = { A, B, C, D, beta: z, scale: 1 }
  let mx = 0
  let sgn = 1
  for (let i = 0; i <= 400; i++) {
    const v = shapeAt(m, i / 400)
    if (Math.abs(v) > mx) {
      mx = Math.abs(v)
      sgn = Math.sign(v)
    }
  }
  m.scale = sgn / (mx || 1)
  return m
}

/** w(ξ) dengan ξ = x/L, ternormalisasi (maks = +1). */
export const shapeAt = (m: ModeShape, xi: number) =>
  (m.A * Math.sin(m.beta * xi) + m.B * Math.cos(m.beta * xi) + m.C * xi + m.D) * m.scale

/** d²w/dξ² (ternormalisasi). */
export const curvAt = (m: ModeShape, xi: number) =>
  -m.beta * m.beta * (m.A * Math.sin(m.beta * xi) + m.B * Math.cos(m.beta * xi)) * m.scale

/** Titik belok (w'' = 0) di dalam bentang, ξ ∈ (0, 1). Ujung sendi/bebas tidak dihitung. */
export function inflections(m: ModeShape): number[] {
  const out: number[] = []
  const N = 2000
  let c0 = curvAt(m, 1e-6)
  for (let i = 1; i <= N; i++) {
    const xi = i / N
    const c1 = curvAt(m, xi)
    if (c0 * c1 < 0 && xi > 1e-3 && xi < 1 - 1e-3) {
      let a = (i - 1) / N
      let b = xi
      for (let k = 0; k < 50; k++) {
        const mid = (a + b) / 2
        if (curvAt(m, a) * curvAt(m, mid) <= 0) b = mid
        else a = mid
      }
      out.push((a + b) / 2)
    }
    c0 = c1
  }
  return out
}

// ---------------------------------------------------------------- elemen hingga balok-kolom

export interface FE {
  n: number // jumlah elemen
  L: number
  EI: number
  free: number[] // indeks DOF bebas (dari 2(n+1)): 2i = w, 2i+1 = θ
  K: Mat // tereduksi
  G: Mat // kekakuan geometrik tereduksi per satuan P (tekan +)
}

export function buildFE(s: Support, EI: number, L: number, n = 24): FE {
  const h = L / n
  const N = 2 * (n + 1)
  const K: Mat = Array.from({ length: N }, () => new Array(N).fill(0))
  const G: Mat = Array.from({ length: N }, () => new Array(N).fill(0))
  const k = EI / h ** 3
  const ke = [
    [12, 6 * h, -12, 6 * h],
    [6 * h, 4 * h * h, -6 * h, 2 * h * h],
    [-12, -6 * h, 12, -6 * h],
    [6 * h, 2 * h * h, -6 * h, 4 * h * h],
  ]
  const g = 1 / (30 * h)
  const ge = [
    [36, 3 * h, -36, 3 * h],
    [3 * h, 4 * h * h, -3 * h, -h * h],
    [-36, -3 * h, 36, -3 * h],
    [3 * h, -h * h, -3 * h, 4 * h * h],
  ]
  for (let e = 0; e < n; e++) {
    const d = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3]
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        K[d[i]][d[j]] += k * ke[i][j]
        G[d[i]][d[j]] += g * ge[i][j]
      }
  }
  const sp = support(s)
  const fixed = new Set<number>([0])
  if (sp.base === 'fix') fixed.add(1)
  if (sp.top !== 'free') fixed.add(2 * n)
  if (sp.top === 'fix') fixed.add(2 * n + 1)
  const free = [...Array(N).keys()].filter((i) => !fixed.has(i))
  return { n, L, EI, free, K: free.map((i) => free.map((j) => K[i][j])), G: free.map((i) => free.map((j) => G[i][j])) }
}

function cholesky(A: Mat): Mat {
  const n = A.length
  const Lm: Mat = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= Lm[i][k] * Lm[j][k]
      Lm[i][j] = i === j ? Math.sqrt(s) : s / Lm[j][j]
    }
  return Lm
}

/** Selesaikan L·x = b (segitiga bawah). */
function fwd(Lm: Mat, b: number[]) {
  const x = b.slice()
  for (let i = 0; i < x.length; i++) {
    for (let k = 0; k < i; k++) x[i] -= Lm[i][k] * x[k]
    x[i] /= Lm[i][i]
  }
  return x
}
/** Selesaikan Lᵀ·x = b. */
function bwd(Lm: Mat, b: number[]) {
  const x = b.slice()
  for (let i = x.length - 1; i >= 0; i--) {
    for (let k = i + 1; k < x.length; k++) x[i] -= Lm[k][i] * x[k]
    x[i] /= Lm[i][i]
  }
  return x
}

/** Vektor penuh 2(n+1) dari vektor tereduksi. */
export function expand(fe: FE, v: number[]): number[] {
  const out = new Array(2 * (fe.n + 1)).fill(0)
  fe.free.forEach((i, k) => (out[i] = v[k]))
  return out
}

/**
 * Masalah eigen K·φ = P·G·φ. Dengan K = LLᵀ: (L⁻¹ G L⁻ᵀ) y = (1/P) y → simetris standar (Jacobi).
 * Mengembalikan `count` beban kritis terkecil dan bentuk modenya (w di tiap simpul, maks = +1).
 */
export function feBuckling(fe: FE, count = 3): { P: number[]; w: number[][] } {
  const Lm = cholesky(fe.K)
  const m = fe.K.length
  const X = fe.G.map((_, j) => fwd(Lm, fe.G.map((r) => r[j]))) // X[j] = L⁻¹·G[:, j]
  const A: Mat = Array.from({ length: m }, () => new Array(m).fill(0))
  // A = L⁻¹ (L⁻¹ G)ᵀ … kolom j dari (L⁻¹G) adalah X[j]; A[:, i] = L⁻¹ · (baris i dari L⁻¹G)
  for (let i = 0; i < m; i++) {
    const row = X.map((col) => col[i])
    const c = fwd(Lm, row)
    for (let r = 0; r < m; r++) A[r][i] = c[r]
  }
  for (let i = 0; i < m; i++)
    for (let j = i + 1; j < m; j++) {
      const v = (A[i][j] + A[j][i]) / 2
      A[i][j] = v
      A[j][i] = v
    }
  const { vals, vecs } = jacobiEigen(A)
  const idx = vals
    .map((v, i) => [v, i] as const)
    .filter(([v]) => v > 1e-300)
    .sort((a, b) => b[0] - a[0])
    .slice(0, count)
  const P: number[] = []
  const w: number[][] = []
  for (const [mu, i] of idx) {
    P.push(1 / mu)
    const phi = expand(fe, bwd(Lm, vecs.map((r) => r[i])))
    const ws = phi.filter((_, k) => k % 2 === 0)
    let mx = 0
    for (const v of ws) if (Math.abs(v) > Math.abs(mx)) mx = v
    w.push(ws.map((v) => v / (mx || 1)))
  }
  return { P, w }
}

// ---------------------------------------------------------------- kolom tak sempurna

/**
 * Lengkung awal w0 = e0·φ1(ξ) (bentuk mode 1 analitis) dan beban eksentris e di ujung yang bebas berputar
 * (momen ujung P·e, searah lengkung awal). Persamaan: (K − P·G)·w = P·(G·w0 + e·m).
 * w = lendutan tambahan; M(x) = −EI·w'' dari elemen (momen total akibat lendutan + eksentrisitas).
 */
export interface Imperfect {
  w: number[] // lendutan tambahan di simpul (mm)
  w0: number[] // lengkung awal di simpul (mm)
  dMax: number // maks |w| (mm)
  M: number[] // momen di simpul (N·mm), nilai mutlak
  Mmax: number
}

/** Vektor momen satuan di ujung yang bebas berputar (sendi atau bebas), arah membuat lendutan + (searah lengkung). */
export function endMoments(fe: FE, s: Support): number[] {
  const sp = support(s)
  const full = new Array(2 * (fe.n + 1)).fill(0)
  if (sp.base === 'pin') full[1] = 1
  if (sp.top !== 'fix') full[2 * fe.n + 1] = sp.base === 'pin' ? -1 : 1
  return fe.free.map((i) => full[i])
}

export function imperfect(fe: FE, s: Support, P: number, e0: number, e: number): Imperfect {
  const ms = modeShape(s, 1)
  const nn = fe.n + 1
  const w0full = new Array(2 * nn).fill(0)
  for (let i = 0; i < nn; i++) {
    const xi = i / fe.n
    w0full[2 * i] = e0 * shapeAt(ms, xi)
    // θ0 = dw0/dx
    const d = ms.beta * (ms.A * Math.cos(ms.beta * xi) - ms.B * Math.sin(ms.beta * xi)) + ms.C
    w0full[2 * i + 1] = (e0 * d * ms.scale) / fe.L
  }
  const w0r = fe.free.map((i) => w0full[i])
  const em = endMoments(fe, s)
  const rhs = fe.G.map((row, i) => P * (row.reduce((a, g, j) => a + g * w0r[j], 0) + e * em[i]))
  const A = fe.K.map((row, i) => row.map((k, j) => k - P * fe.G[i][j]))
  const sol = P > 0 ? solve(A, rhs) : new Array(rhs.length).fill(0)
  const full = expand(fe, sol)
  const h = fe.L / fe.n
  const curv = new Array(nn).fill(0)
  const cnt = new Array(nn).fill(0)
  for (let k = 0; k < fe.n; k++) {
    const [w1, t1, w2, t2] = [full[2 * k], full[2 * k + 1], full[2 * k + 2], full[2 * k + 3]]
    const a = (6 * (w2 - w1)) / (h * h)
    curv[k] += a - (4 * t1 + 2 * t2) / h
    curv[k + 1] += -a + (2 * t1 + 4 * t2) / h
    cnt[k]++
    cnt[k + 1]++
  }
  const M = curv.map((c, i) => Math.abs((fe.EI * c) / cnt[i]))
  const w = full.filter((_, i) => i % 2 === 0)
  return {
    w,
    w0: w0full.filter((_, i) => i % 2 === 0),
    dMax: w.reduce((a, v) => Math.max(a, Math.abs(v)), 0),
    M,
    Mmax: M.reduce((a, v) => Math.max(a, v), 0),
  }
}

/** Apakah rumus tertutup tersedia (lengkung = mode 1 untuk semua tumpuan; eksentrisitas hanya sendi–sendi/jepit–bebas/jepit–jepit). */
export const theoryAvailable = (s: Support, e: number) => !(s === 'jepit-sendi' && e > 0)

/**
 * Teori kolom tak sempurna di titik lendutan maksimum (tengah / puncak):
 * δ = e0·α/(1−α) + e·(sec(kLe/2) − 1), Mmaks = EI·e0·α/(1−α)·maks|φ''| + P·e·sec(kLe/2), α = P/Pcr, k = √(P/EI).
 * (jepit–jepit: eksentrisitas dipikul tumpuan → suku e hilang.)
 */
export function imperfectTheory(s: Support, EI: number, L: number, P: number, e0: number, e: number) {
  const P1 = pcr(s, EI, L)
  const a = P / P1
  const amp = a / (1 - a)
  const ms = modeShape(s, 1)
  let c2 = 0
  for (let i = 0; i <= 400; i++) c2 = Math.max(c2, Math.abs(curvAt(ms, i / 400)))
  const Le = support(s).K * L
  const ee = s === 'jepit' ? 0 : e
  const sec = 1 / Math.cos((Math.sqrt(P / EI) * Le) / 2)
  return {
    a,
    amp: 1 / (1 - a),
    d: e0 * amp + ee * (sec - 1),
    M: (EI * e0 * amp * c2) / (L * L) + P * ee * sec,
  }
}

/** Garis lurus kuadrat terkecil y = a·x + b. */
export function fitLine(xs: number[], ys: number[]) {
  const n = xs.length
  if (n < 2) return null
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += xs[i]
    sy += ys[i]
    sxx += xs[i] * xs[i]
    sxy += xs[i] * ys[i]
  }
  const d = n * sxx - sx * sx
  if (Math.abs(d) < 1e-300) return null
  const a = (n * sxy - sx * sy) / d
  return { a, b: (sy - a * sx) / n }
}

/**
 * Plot Southwell: δ = Pcr·(δ/P) − e0 → kemiringan garis δ terhadap δ/P adalah Pcr, titik potong −e0.
 * Masukan: pasangan (P, δ tambahan).
 */
export function southwell(pts: { P: number; d: number }[]) {
  const use = pts.filter((q) => q.P > 0 && q.d > 1e-9)
  const f = fitLine(
    use.map((q) => q.d / q.P),
    use.map((q) => q.d),
  )
  return f ? { Pcr: f.a, e0: -f.b } : null
}

/** Beban leleh pertama: P sehingga P/A + Mmaks(P)/S = fy (dibagi dua di 0 < P < Pcr). */
export function firstYield(mmax: (P: number) => number, A: number, S: number, fy: number, Pcr: number) {
  let a = 0
  let b = Pcr * (1 - 1e-9)
  for (let i = 0; i < 100; i++) {
    const m = (a + b) / 2
    if (m / A + mmax(m) / S > fy) b = m
    else a = m
  }
  return (a + b) / 2
}

// ---------------------------------------------------------------- kurva kolom

/** SNI 1729:2020 / AISC 360 pasal E3 (tanpa tekuk lokal): Fcr (MPa) dari KL/r. */
export function sniFcr(slender: number, E: number, fy: number) {
  const Fe = (Math.PI * Math.PI * E) / (slender * slender)
  const inelastic = fy / Fe <= 2.25
  return { Fe, Fcr: inelastic ? 0.658 ** (fy / Fe) * fy : 0.877 * Fe, inelastic }
}

/** Batas inelastis/elastis: KL/r = 4,71·√(E/fy). */
export const sniLimit = (E: number, fy: number) => 4.71 * Math.sqrt(E / fy)

/**
 * Perry–Robertson: kolom sendi dengan lengkung e0 = λ·r/ratio, leleh pertama.
 * (fy − σ)(σe − σ) = η·σ·σe, η = e0·c/r² → akar terkecil.
 */
export function perry(slender: number, E: number, fy: number, eta: number) {
  const se = (Math.PI * Math.PI * E) / (slender * slender)
  const b = fy + (1 + eta) * se
  return (b - Math.sqrt(b * b - 4 * fy * se)) / 2
}

// ---------------------------------------------------------------- elastica

/** Integral eliptik lengkap jenis 1 (AGM) dan 2 (Simpson). */
export const ellipK = (k: number) => Math.PI / (2 * agm(1, Math.sqrt(1 - k * k)))
export function ellipE(k: number) {
  const n = 400
  const h = Math.PI / 2 / n
  let s = 0
  for (let i = 0; i <= n; i++) {
    const f = Math.sqrt(1 - k * k * Math.sin(i * h) ** 2)
    s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * f
  }
  return (s * h) / 3
}

/** Tumpuan yang elastica-nya tersusun dari seperempat gelombang (eksak); jepit–sendi tidak. */
export const quarters = (s: Support) => (s === 'sendi' ? 2 : s === 'jepit-bebas' ? 1 : s === 'jepit' ? 4 : 0)

/** P/Pcr = (2K(k)/π)², k = sin(α/2), α = kemiringan maksimum. */
export const elasticaRatio = (k: number) => (2 * ellipK(k) / Math.PI) ** 2

export function kFromRatio(r: number) {
  if (r <= 1) return 0
  let a = 0
  let b = 1 - 1e-13
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2
    if (elasticaRatio(m) < r) a = m
    else b = m
  }
  return (a + b) / 2
}

/** Teori elastica: δ lateral maks / L dan perpendekan ujung Δ/L. */
export function elasticaTheory(s: Support, k: number) {
  const K = ellipK(k)
  const E = ellipE(k)
  return { d: (s === 'jepit-bebas' ? 2 : 1) * (k / K), short: 2 - (2 * E) / K, alpha: 2 * Math.asin(k) }
}

/**
 * Elastica numerik: EI·θ'' + P·sin θ = 0 sepanjang busur s dari dasar, RK4 (n langkah).
 * Keadaan [θ, θ', x lateral, y aksial] dalam satuan L = 1. Mengembalikan titik bentuk dan ukuran.
 */
export function elastica(s: Support, k: number, n = 600) {
  const q = quarters(s)
  const K = ellipK(k)
  const lam = q * K // λ·L
  const th0 = s === 'sendi' ? 2 * Math.asin(k) : 0
  const kap0 = s === 'sendi' ? 0 : 2 * k * lam
  const f = (y: number[]) => [y[1], -lam * lam * Math.sin(y[0]), Math.sin(y[0]), Math.cos(y[0])]
  let y = [th0, kap0, 0, 0]
  const pts: [number, number][] = [[0, 0]]
  let dMax = 0
  const h = 1 / n
  for (let i = 0; i < n; i++) {
    y = rk4Vec(f, y, h)
    pts.push([y[2], y[3]])
    dMax = Math.max(dMax, Math.abs(y[2]))
  }
  return { pts, d: dMax, short: 1 - y[3], tipX: y[2], ratio: (lam / (q * (Math.PI / 2))) ** 2 }
}
