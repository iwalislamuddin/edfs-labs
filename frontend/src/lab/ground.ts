// Gerak tanah & spektrum respons.
// - Rekaman gempa SINTETIS (bukan rekaman nyata): derau putih tersaring Kanai–Tajimi × fungsi selubung,
//   pulsa dekat sesar (Mavroeidis–Papageorgiou), dan sinus terbatas. Deterministik lewat seed.
// - Integrasi SDOF eksak untuk eksitasi linier sepotong-sepotong (Nigam–Jennings / "piecewise exact", Chopra §5.2).
// - Spektrum respons Sd, PSv, PSa dan spektrum desain SNI 1726.
// Fisika murni tanpa DOM, diuji di ground.test.ts.

export const G = 9.81

/** Rekaman percepatan tanah dengan langkah sampel tetap. */
export interface Record {
  dt: number
  /** Percepatan tanah (m/s²). */
  a: number[]
}

export const duration = (r: Record) => (r.a.length - 1) * r.dt

/** Percepatan tanah pada waktu t (interpolasi linier, 0 di luar rekaman). */
export function agAt(r: Record, t: number): number {
  if (t <= 0) return r.a[0] ?? 0
  const x = t / r.dt
  const i = Math.floor(x)
  if (i >= r.a.length - 1) return 0
  const f = x - i
  return r.a[i] * (1 - f) + r.a[i + 1] * f
}

/** PRNG mulberry32 (deterministik). */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Derau normal baku (Box–Muller). */
function gauss(r: () => number) {
  const u = Math.max(r(), 1e-12)
  const v = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ---- integrasi eksak SDOF untuk input linier sepotong-sepotong ----

export interface NJCoef {
  A: number
  B: number
  C: number
  D: number
  A1: number
  B1: number
  C1: number
  D1: number
}

/**
 * Koefisien rekursi u'' + 2ζω u' + ω² u = p(t)/m (m = 1, k = ω²) dengan p linier di tiap langkah Δt, 0 ≤ ζ < 1.
 * u_{i+1} = A u + B v + C p_i + D p_{i+1};  v_{i+1} = A1 u + B1 v + C1 p_i + D1 p_{i+1}.
 */
export function njCoef(w: number, zeta: number, dt: number): NJCoef {
  const k = w * w
  const sq = Math.sqrt(1 - zeta * zeta)
  const wd = w * sq
  const e = Math.exp(-zeta * w * dt)
  const s = Math.sin(wd * dt)
  const c = Math.cos(wd * dt)
  const z = zeta / sq
  return {
    A: e * (z * s + c),
    B: e * (s / wd),
    C: (1 / k) * ((2 * zeta) / (w * dt) + e * (((1 - 2 * zeta * zeta) / (wd * dt) - z) * s - (1 + (2 * zeta) / (w * dt)) * c)),
    D: (1 / k) * (1 - (2 * zeta) / (w * dt) + e * (((2 * zeta * zeta - 1) / (wd * dt)) * s + ((2 * zeta) / (w * dt)) * c)),
    A1: -e * ((w / sq) * s),
    B1: e * (c - z * s),
    C1: (1 / k) * (-1 / dt + e * ((w / sq + zeta / (dt * sq)) * s + (1 / dt) * c)),
    D1: (1 / (k * dt)) * (1 - e * (z * s + c)),
  }
}

export interface SdofPeaks {
  /** Simpangan relatif maksimum |u| (m). */
  Sd: number
  /** Percepatan mutlak maksimum |ü + ag| (m/s²). */
  amax: number
  /** Waktu saat |u| maksimum (s). */
  tPeak: number
}

/** Respons SDOF (periode T, redaman ζ) terhadap rekaman; opsional riwayat u. Mulai dari diam. */
export function sdofResponse(rec: Record, T: number, zeta: number, out?: number[]): SdofPeaks {
  const w = (2 * Math.PI) / T
  const c = njCoef(w, zeta, rec.dt)
  let u = 0
  let v = 0
  let Sd = 0
  let amax = 0
  let tPeak = 0
  out?.push(0)
  for (let i = 0; i < rec.a.length - 1; i++) {
    const p0 = -rec.a[i]
    const p1 = -rec.a[i + 1]
    const un = c.A * u + c.B * v + c.C * p0 + c.D * p1
    const vn = c.A1 * u + c.B1 * v + c.C1 * p0 + c.D1 * p1
    u = un
    v = vn
    out?.push(u)
    if (Math.abs(u) > Sd) {
      Sd = Math.abs(u)
      tPeak = (i + 1) * rec.dt
    }
    amax = Math.max(amax, Math.abs(2 * zeta * w * v + w * w * u))
  }
  return { Sd, amax, tPeak }
}

export interface SpectrumPoint {
  T: number
  Sd: number // m
  PSv: number // m/s
  PSa: number // m/s²
  amax: number // m/s² (percepatan mutlak sesungguhnya)
}

/** Periode untuk spektrum: rapat di periode pendek. */
export function spectrumPeriods(tMax = 4, n = 120): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(0.02 + (tMax - 0.02) * Math.pow(i / (n - 1), 1.6))
  return out
}

export function spectrum(rec: Record, zeta: number, periods = spectrumPeriods()): SpectrumPoint[] {
  return periods.map((T) => {
    const w = (2 * Math.PI) / T
    const r = sdofResponse(rec, T, zeta)
    return { T, Sd: r.Sd, PSv: w * r.Sd, PSa: w * w * r.Sd, amax: r.amax }
  })
}

// ---- spektrum desain SNI 1726 ----

export interface DesignSpec {
  SDS: number // g
  SD1: number // g
  TL: number // s
}

/** Sa desain (g) SNI 1726:2019 pasal 6.4. */
export function sniSa(s: DesignSpec, T: number): number {
  const T0 = (0.2 * s.SD1) / s.SDS
  const Ts = s.SD1 / s.SDS
  if (T < T0) return s.SDS * (0.4 + (0.6 * T) / T0)
  if (T <= Ts) return s.SDS
  if (T <= s.TL) return s.SD1 / T
  return (s.SD1 * s.TL) / (T * T)
}

// ---- rekaman sintetis ----

export type MotionKind = 'keras' | 'lunak' | 'pulsa' | 'sinus'

export const MOTIONS: { id: MotionKind; label: string; hint: string }[] = [
  { id: 'keras', label: 'Tanah keras', hint: 'pita lebar, dominan 2–3 Hz, guncangan kuat ±8 s' },
  { id: 'lunak', label: 'Tanah lunak', hint: 'pita sempit periode panjang (≈1,7 s), guncangan lama — mirip efek cekungan lunak' },
  { id: 'pulsa', label: 'Pulsa dekat sesar', hint: 'satu pulsa kecepatan besar (Tp ≈ 1,2 s) khas gempa dekat sesar' },
  { id: 'sinus', label: 'Sinus 1 Hz', hint: '8 siklus sinus 1 Hz — resonansi murni di T = 1 s' },
]

const DT = 0.01

/** Selubung trapesium-eksponensial: naik kuadrat sampai t1, rata sampai t2, lalu meluruh. */
function envelope(t: number, t1: number, t2: number, decay: number) {
  if (t < t1) return (t / t1) ** 2
  if (t <= t2) return 1
  return Math.exp(-decay * (t - t2))
}

/** Membangun rekaman sintetis berdurasi `dur` detik dengan PGA tertentu (g). */
export function synth(kind: MotionKind, pga: number, seed: number, dur = 20): Record {
  const n = Math.round(dur / DT) + 1
  const a = new Array<number>(n).fill(0)
  const r = rng(seed)
  if (kind === 'keras' || kind === 'lunak') {
    const wg = kind === 'keras' ? 2 * Math.PI * 2.5 : 2 * Math.PI * 0.6
    const zg = kind === 'keras' ? 0.6 : 0.25
    const [t1, t2, dec] = kind === 'keras' ? [1.5, 8, 0.45] : [3, 14, 0.5]
    // filter Kanai–Tajimi: x'' + 2ζg ωg x' + ωg² x = −w(t); ag = −(2ζg ωg x' + ωg² x)
    const c = njCoef(wg, zg, DT)
    let x = 0
    let v = 0
    let w0 = gauss(r)
    for (let i = 0; i < n; i++) {
      a[i] = -(2 * zg * wg * v + wg * wg * x) * envelope(i * DT, t1, t2, dec)
      const w1 = gauss(r)
      const xn = c.A * x + c.B * v + c.C * -w0 + c.D * -w1
      const vn = c.A1 * x + c.B1 * v + c.C1 * -w0 + c.D1 * -w1
      x = xn
      v = vn
      w0 = w1
    }
    // filter lolos-tinggi orde 1 (Clough–Penzien sederhana) untuk meredam pergeseran frekuensi sangat rendah
    // (dua kali → orde 2, fc 0,2 Hz) supaya perpindahan tanah realistis
    const fc = 0.2
    const al = 1 / (1 + 2 * Math.PI * fc * DT)
    for (let pass = 0; pass < 2; pass++) {
      let prevIn = a[0]
      let prevOut = a[0]
      for (let i = 1; i < n; i++) {
        const out = al * (prevOut + a[i] - prevIn)
        prevIn = a[i]
        a[i] = out
        prevOut = out
      }
    }
  } else if (kind === 'pulsa') {
    // Mavroeidis–Papageorgiou: v = A/2·[1 + cos(2πfp(t−t0)/γ)]·cos(2πfp(t−t0) + ν)
    const fp = 1 / 1.2
    const gam = 2.2
    const nu = Math.PI / 2
    const t0 = 4 + r() * 0.5
    const half = gam / (2 * fp)
    const vel = (t: number) => {
      const x = t - t0
      if (Math.abs(x) > half) return 0
      return 0.5 * (1 + Math.cos((2 * Math.PI * fp * x) / gam)) * Math.cos(2 * Math.PI * fp * x + nu)
    }
    for (let i = 0; i < n; i++) {
      const t = i * DT
      a[i] = (vel(t + DT / 2) - vel(t - DT / 2)) / DT + 0.08 * gauss(r) * envelope(t, 2, 7, 0.8)
    }
  } else {
    const f = 1
    const cyc = 8
    for (let i = 0; i < n; i++) {
      const t = i * DT - 1
      if (t < 0 || t > cyc / f) continue
      const taper = Math.min(1, t * f * 2, (cyc / f - t) * f * 2)
      a[i] = Math.sin(2 * Math.PI * f * t) * taper
    }
  }
  // hilangkan rerata lalu skalakan ke PGA
  let mean = 0
  for (const x of a) mean += x
  mean /= n
  let peak = 0
  for (let i = 0; i < n; i++) {
    a[i] -= kind === 'sinus' ? 0 : mean
    peak = Math.max(peak, Math.abs(a[i]))
  }
  const s = (pga * G) / (peak || 1)
  return { dt: DT, a: a.map((x) => x * s) }
}

/** Kecepatan & perpindahan tanah (trapesium) dengan koreksi garis dasar polinomial orde 2 pada perpindahan (untuk gambar). */
export function groundMotion(rec: Record): { v: number[]; d: number[]; pgv: number; pgd: number } {
  const n = rec.a.length
  const v = new Array<number>(n).fill(0)
  const d = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    v[i] = v[i - 1] + 0.5 * (rec.a[i - 1] + rec.a[i]) * rec.dt
    d[i] = d[i - 1] + 0.5 * (v[i - 1] + v[i]) * rec.dt
  }
  // kuadrat terkecil d ≈ c1 t + c2 t² (melalui titik nol)
  let s2 = 0
  let s3 = 0
  let s4 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < n; i++) {
    const t = i * rec.dt
    s2 += t * t
    s3 += t * t * t
    s4 += t * t * t * t
    b1 += t * d[i]
    b2 += t * t * d[i]
  }
  const det = s2 * s4 - s3 * s3
  const c1 = (b1 * s4 - b2 * s3) / det
  const c2 = (s2 * b2 - s3 * b1) / det
  let pgv = 0
  let pgd = 0
  for (let i = 0; i < n; i++) {
    const t = i * rec.dt
    d[i] -= c1 * t + c2 * t * t
    pgv = Math.max(pgv, Math.abs(v[i]))
    pgd = Math.max(pgd, Math.abs(d[i]))
  }
  return { v, d, pgv, pgd }
}
