// Model material Room Tensile Test.
// Baja: kurva teknik (engineering) σ–ε dengan leleh atas/bawah + plateau (pita Lüders) atau Ramberg–Osgood (tanpa
// plateau), pengerasan regangan sampai Rm di εu, lalu necking: leher mengikuti kurva sebenarnya Hollomon
// σt = K·εt^n dengan n = ln(1+εu) (kriteria Considère), bagian seragam membongkar elastis. Panjang zona leher
// λ·d0 dikalibrasi dari perpanjangan putus A5 (L0 = 5d0), sehingga perpanjangan putus bergantung panjang ukur L0.
// Beton: kurva tekan Popovics–Thorenfeldt–Collins, Hognestad, modulus chord ASTM C469, uji belah (Brazil).
// Satuan: MPa, mm, regangan tak berdimensi.

export type Kind = 'plateau' | 'round'

export interface Steel {
  E: number // MPa
  /** ReL (leleh bawah) untuk 'plateau', Rp0,2 untuk 'round' */
  fy: number
  /** ReH/ReL (1 = tanpa leleh atas) */
  up: number
  fu: number // Rm
  /** regangan awal pengerasan (plateau) */
  esh: number
  /** kemiringan awal pengerasan (MPa) */
  Esh: number
  /** regangan teknik total saat Rm (regangan seragam) */
  eu: number
  /** perpanjangan putus plastis pada L0 = 5·d0 */
  A5: number
  /** reduksi luas penampang di patahan */
  Z: number
  kind: Kind
}

const DROP = 0.0004 // lebar regangan penurunan leleh atas → bawah

// ---------- bagian seragam (sebelum necking) ----------

/** Eksponen pengerasan plateau: σ = fu + (fy − fu)·((εu − ε)/(εu − εsh))^p, kemiringan awal Esh, datar di εu. */
export const hardP = (m: Steel) => Math.max(1, (m.Esh * (m.eu - m.esh)) / (m.fu - m.fy))
/** Eksponen Ramberg–Osgood ε = σ/E + 0,002(σ/fy)^n yang melewati (εu, fu). */
export const roN = (m: Steel) => Math.log((m.eu - m.fu / m.E) / 0.002) / Math.log(m.fu / m.fy)

/** Regangan ujung leleh atas (awal penurunan). */
export const eUpper = (m: Steel) => (m.up * m.fy) / m.E

export function sigmaUniform(m: Steel, e: number): number {
  if (e <= 0) return m.E * e
  if (m.kind === 'plateau') {
    const eH = eUpper(m)
    if (e <= eH) return m.E * e
    if (m.up > 1 && e < eH + DROP) return m.up * m.fy + ((m.fy - m.up * m.fy) * (e - eH)) / DROP
    if (e <= m.esh) return m.fy
    if (e >= m.eu) return m.fu
    return m.fu + (m.fy - m.fu) * ((m.eu - e) / (m.eu - m.esh)) ** hardP(m)
  }
  const n = roN(m)
  const f = (s: number) => s / m.E + 0.002 * (s / m.fy) ** n - e
  let lo = 0
  let hi = Math.min(m.E * e, m.fu * 1.0001)
  if (f(hi) <= 0) return hi
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

// ---------- necking ----------

/** Regangan seragam plastis Ag (perpanjangan saat Rm, setelah bongkar elastis). */
export const Ag = (m: Steel) => m.eu - m.fu / m.E
export const hasNeck = (m: Steel) => m.A5 > Ag(m) + 1e-4 && 1 / (1 - m.Z) > 1 + m.eu + 1e-6

export interface Neck {
  n: number // eksponen Hollomon = εt,u
  K: number // MPa
  etu: number
  etf: number // regangan sebenarnya di patahan = −ln(1 − Z)
  lam: number // panjang zona leher / d0
}

export function neck(m: Steel): Neck {
  const etu = Math.log(1 + m.eu)
  const n = etu
  const K = (m.fu * (1 + m.eu)) / etu ** n
  const etf = -Math.log(1 - m.Z)
  const lam = (5 * (m.A5 - Ag(m))) / (Math.exp(etf) - (1 + m.eu))
  return { n, K, etu, etf, lam }
}

/** Tegangan teknik dari leher dengan regangan sebenarnya t: σ = K·t^n·e^(−t). */
export const neckSigma = (nk: Neck, t: number) => nk.K * t ** nk.n * Math.exp(-t)

/** Regangan teknik total (pada L0 = k·d0) saat regangan leher t. */
export function neckStrain(m: Steel, nk: Neck, k: number, t: number) {
  return m.eu - (m.fu - neckSigma(nk, t)) / m.E + (nk.lam / k) * (Math.exp(t) - (1 + m.eu))
}

/** Regangan total saat putus pada L0 = k·d0. */
export function eFracture(m: Steel, k: number) {
  if (!hasNeck(m)) return m.eu
  const nk = neck(m)
  return neckStrain(m, nk, k, nk.etf)
}

/** Perpanjangan putus plastis teori (setelah patah, pegas elastis kembali) pada L0 = k·d0. */
export function elongation(m: Steel, k: number) {
  if (!hasNeck(m)) return Ag(m)
  const nk = neck(m)
  return eFracture(m, k) - neckSigma(nk, nk.etf) / m.E
}

export interface Point {
  /** tegangan teknik P/A0 */
  s: number
  /** regangan seragam bagian luar leher */
  eu: number
  /** regangan sebenarnya leher (null = belum necking) */
  t: number | null
  /** fraksi panjang ukur yang sudah leleh (pita Lüders), 0–1 */
  luders: number
  broken: boolean
}

/** Kurva selubung monoton (pembebanan pertama) di regangan teknik total e. */
export function envelope(m: Steel, k: number, e: number): Point {
  const lud = (x: number) =>
    m.kind === 'plateau' && x > eUpper(m) ? Math.min(1, (x - eUpper(m)) / Math.max(1e-6, m.esh - eUpper(m))) : m.kind === 'round' && x > m.fy / m.E ? 1 : 0
  if (e <= m.eu) return { s: sigmaUniform(m, e), eu: e, t: null, luders: lud(e), broken: false }
  if (!hasNeck(m)) return { s: 0, eu: m.eu, t: null, luders: 1, broken: true }
  const nk = neck(m)
  if (e >= neckStrain(m, nk, k, nk.etf)) return { s: 0, eu: m.eu - m.fu / m.E, t: nk.etf, luders: 1, broken: true }
  let lo = nk.etu
  let hi = nk.etf
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (neckStrain(m, nk, k, mid) > e) hi = mid
    else lo = mid
  }
  const t = (lo + hi) / 2
  const s = neckSigma(nk, t)
  return { s, eu: m.eu - (m.fu - s) / m.E, t, luders: 1, broken: false }
}

/**
 * Respons dengan bongkar–muat: emax = regangan maksimum yang pernah dicapai pada selubung.
 * Di bawah emax, garis elastis kemiringan E dari (emax, σ(emax)); tegangan tidak negatif (benda uji tidak ditekan).
 */
export function respond(m: Steel, k: number, emax: number, e: number): Point {
  if (e >= emax) return envelope(m, k, e)
  const top = envelope(m, k, emax)
  if (top.broken) return top
  const s = Math.max(0, top.s - m.E * (emax - e))
  const de = (top.s - s) / m.E
  return { ...top, s, eu: top.eu - de, t: top.t }
}

/** Regangan permanen setelah bongkar penuh dari emax. */
export const permanentSet = (m: Steel, k: number, emax: number) => emax - envelope(m, k, emax).s / m.E

/** Kurva sebenarnya: sebelum necking σt = σ(1+ε), εt = ln(1+ε); setelahnya nilai di leher. */
export function trueCurve(p: Point, e: number): [number, number] {
  if (p.t === null) return [Math.log(1 + e), p.s * (1 + e)]
  return [p.t, p.s * Math.exp(p.t)]
}

/** Kurva teori dari 0 sampai putus (sampel tak seragam: rapat di daerah elastis/leleh). */
export function theoryCurve(m: Steel, k: number, n = 400): [number, number][] {
  const ef = eFracture(m, k)
  const out: [number, number][] = []
  const ez = Math.min(ef, Math.max(m.kind === 'plateau' ? m.esh * 1.5 : 0, 4 * (m.fy / m.E + 0.002)))
  for (let i = 0; i <= 120; i++) {
    const e = (ez * i) / 120
    out.push([e, envelope(m, k, e).s])
  }
  for (let i = 1; i <= n; i++) {
    const e = ez + ((ef - ez) * i) / n
    out.push([e, envelope(m, k, Math.min(e, ef - 1e-9)).s])
  }
  return out
}

/** Luas di bawah kurva (trapesium) = energi per volume (MJ/m³ = MPa). */
export function area(pts: [number, number][]) {
  let a = 0
  for (let i = 1; i < pts.length; i++) a += ((pts[i][0] - pts[i - 1][0]) * (pts[i][1] + pts[i - 1][1])) / 2
  return a
}

/** Ketangguhan teori sampai putus (MJ/m³). */
export const toughness = (m: Steel, k: number) => area(theoryCurve(m, k, 1500))
/** Modulus resiliensi fy²/2E (MJ/m³). */
export const resilience = (m: Steel) => (m.fy * m.fy) / (2 * m.E)

export function clampSteel(m: Steel): Steel {
  const o = { ...m }
  o.fu = Math.max(o.fu, 1.02 * o.fy)
  if (o.kind === 'plateau') {
    o.esh = Math.max(o.esh, eUpper(o) + DROP + 0.002)
    o.eu = Math.max(o.eu, o.esh + 0.02)
  } else o.eu = Math.max(o.eu, o.fu / o.E + 0.0025)
  o.A5 = Math.max(o.A5, Ag(o))
  o.Z = Math.min(0.9, Math.max(0, o.Z))
  if (o.A5 > Ag(o) + 1e-4) o.Z = Math.max(o.Z, o.eu / (1 + o.eu) + 0.03)
  return o
}

// ---------- pengolahan data uji (yang "terukur") ----------

export interface Measured {
  E: number | null
  ReH: number | null
  ReL: number | null
  Rp02: number | null
  Rm: number | null
  /** regangan total saat Rm */
  eRm: number | null
  Ag: number | null
  A: number | null
  U: number
}

/** Mengolah data (ε, σ) pembebanan pertama seperti perangkat lunak mesin uji (EN ISO 6892-1). */
export function analyze(raw: [number, number][], broken: boolean): Measured {
  const out: Measured = { E: null, ReH: null, ReL: null, Rp02: null, Rm: null, eRm: null, Ag: null, A: null, U: 0 }
  // hanya cabang pembebanan pertama (selubung): buang titik bongkar–muat ulang di bawah regangan maksimum sebelumnya
  const pts: [number, number][] = []
  let emax = -Infinity
  for (const q of raw)
    if (q[0] >= emax) {
      pts.push(q)
      emax = q[0]
    }
  if (pts.length < 5) return out
  // modulus: regresi titik 10–40% Rm pertama sebelum tegangan pernah turun
  let smax = 0
  let iRm = 0
  pts.forEach(([, s], i) => {
    if (s > smax) {
      smax = s
      iRm = i
    }
  })
  const fit: [number, number][] = []
  for (const [e, s] of pts) {
    if (s > 0.45 * smax) break
    if (s >= 0.1 * smax) fit.push([e, s])
  }
  if (fit.length >= 4) {
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    for (const [x, y] of fit) {
      sx += x
      sy += y
      sxx += x * x
      sxy += x * y
    }
    const n = fit.length
    const E = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    if (E > 0) out.E = E
  }
  out.Rm = smax
  out.eRm = pts[iRm][0]
  if (out.E) {
    const E = out.E
    out.Ag = out.eRm - smax / E
    // Rp0,2: perpotongan garis offset E(ε − 0,002)
    for (let i = 1; i < pts.length; i++) {
      const g0 = pts[i - 1][1] - E * (pts[i - 1][0] - 0.002)
      const g1 = pts[i][1] - E * (pts[i][0] - 0.002)
      if (g0 > 0 && g1 <= 0) {
        const f = g0 / (g0 - g1)
        out.Rp02 = pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1])
        break
      }
    }
    // leleh atas: puncak lokal pertama yang diikuti penurunan > 3%
    let peak = -Infinity
    let iPk = 0
    for (let i = 0; i < pts.length; i++) {
      const s = pts[i][1]
      if (s > peak) {
        peak = s
        iPk = i
      } else if (pts[i][0] > pts[iPk][0] + 0.004) break
      else if (s < 0.97 * peak && s > 0.5 * peak) {
        out.ReH = peak
        break
      }
    }
    if (out.ReH !== null) {
      // leleh bawah: tegangan terendah di plateau sesudah penurunan, abaikan efek transien awal (ISO)
      const e0 = pts[iPk][0]
      let lo = Infinity
      for (const [e, s] of pts) if (e > e0 + 0.0008 && e < e0 + 0.008) lo = Math.min(lo, s)
      if (lo < Infinity) out.ReL = lo
    }
    if (broken) {
      // titik terakhir sebelum jatuh ke nol
      let j = pts.length - 1
      while (j > 0 && pts[j][1] < 0.02 * smax) j--
      out.A = pts[j][0] - pts[j][1] / E
    }
  }
  let j = pts.length
  if (broken) while (j > 1 && pts[j - 1][1] < 0.02 * smax) j--
  out.U = area(pts.slice(0, j))
  return out
}

/** Derau sel beban deterministik (−1…1). */
export function noise(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return 2 * (x - Math.floor(x)) - 1
}

// ---------- baja bawaan ----------

export interface Preset {
  id: string
  label: string
  short: string
  note: string
  m: Steel
}

export const STEELS: Preset[] = [
  {
    id: 'bj37',
    label: 'BJ 37',
    short: 'BJ37',
    note: 'baja struktur lunak (SNI 1729), leleh atas jelas',
    m: { E: 200000, fy: 240, up: 1.1, fu: 370, esh: 0.018, Esh: 3500, eu: 0.2, A5: 0.3, Z: 0.62, kind: 'plateau' },
  },
  {
    id: 'bj41',
    label: 'BJ 41',
    short: 'BJ41',
    note: 'baja struktur umum',
    m: { E: 200000, fy: 250, up: 1.08, fu: 410, esh: 0.015, Esh: 4000, eu: 0.17, A5: 0.26, Z: 0.58, kind: 'plateau' },
  },
  {
    id: 'bj50',
    label: 'BJ 50',
    short: 'BJ50',
    note: 'baja struktur mutu lebih tinggi',
    m: { E: 200000, fy: 290, up: 1.06, fu: 500, esh: 0.013, Esh: 4500, eu: 0.15, A5: 0.22, Z: 0.55, kind: 'plateau' },
  },
  {
    id: 'bjts420',
    label: 'BjTS 420B',
    short: 'BjTS',
    note: 'tulangan ulir (SNI 2052), syarat gempa fu/fy ≥ 1,25',
    m: { E: 200000, fy: 420, up: 1.0, fu: 560, esh: 0.009, Esh: 6000, eu: 0.11, A5: 0.17, Z: 0.45, kind: 'plateau' },
  },
  {
    id: 'hs',
    label: 'Mutu tinggi',
    short: 'Q&T',
    note: 'baja quenched & tempered, tanpa titik leleh jelas (Rp0,2)',
    m: { E: 205000, fy: 690, up: 1, fu: 790, esh: 0, Esh: 0, eu: 0.07, A5: 0.15, Z: 0.6, kind: 'round' },
  },
  {
    id: 'al',
    label: 'Aluminium',
    short: 'Al',
    note: 'paduan 6061-T6, E sepertiga baja',
    m: { E: 69000, fy: 276, up: 1, fu: 310, esh: 0, Esh: 0, eu: 0.09, A5: 0.13, Z: 0.4, kind: 'round' },
  },
  {
    id: 'ci',
    label: 'Besi cor',
    short: 'Cor',
    note: 'besi cor kelabu: getas, putus tanpa necking',
    m: { E: 100000, fy: 140, up: 1, fu: 200, esh: 0, Esh: 0, eu: 0.006, A5: 0.004, Z: 0, kind: 'round' },
  },
]

export const presetById = (id: string) => STEELS.find((x) => x.id === id) ?? STEELS[1]

// ---------- beton ----------

/** Modulus elastisitas beton normal SNI 2847: Ec = 4700√fc′ (MPa). */
export const concreteEc = (fc: number) => 4700 * Math.sqrt(fc)

export interface Popovics {
  n: number
  e0: number
  k: number // faktor penurunan setelah puncak
}
export function popovicsParams(fc: number): Popovics {
  const n = 0.8 + fc / 17
  const e0 = (fc / concreteEc(fc)) * (n / (n - 1))
  return { n, e0, k: Math.max(1, 0.67 + fc / 62) }
}
/** Kurva tekan Popovics–Thorenfeldt–Collins: σ = fc′·n·(ε/ε0)/(n − 1 + (ε/ε0)^(n·k)). */
export function popovics(fc: number, e: number) {
  if (e <= 0) return 0
  const p = popovicsParams(fc)
  const r = e / p.e0
  const k = r <= 1 ? 1 : p.k
  return (fc * p.n * r) / (p.n - 1 + r ** (p.n * k))
}
/** Hognestad: parabola sampai ε0 = 2fc′/Ec, lalu garis turun ke 0,85fc′ di 0,0038. */
export function hognestad(fc: number, e: number) {
  const e0 = (2 * fc) / concreteEc(fc)
  if (e <= e0) return fc * (2 * (e / e0) - (e / e0) ** 2)
  return Math.max(0, fc * (1 - (0.15 * (e - e0)) / (0.0038 - e0)))
}
/** Regangan akhir uji tekan: 0,0035 atau saat tegangan turun ke 50% fc′ (yang lebih dulu, minimal 1,3ε0). */
export function concreteEnd(fc: number) {
  const p = popovicsParams(fc)
  let e = p.e0
  while (e < 0.006 && popovics(fc, e) > 0.5 * fc) e += 1e-5
  return Math.max(1.3 * p.e0, Math.min(0.0035, e))
}
/** Modulus chord ASTM C469: (S2 − S1)/(ε2 − 0,00005), S2 = 0,4fc′, S1 = σ di ε = 50·10⁻⁶. */
export function chordModulus(curve: (e: number) => number, s2: number) {
  const S1 = curve(5e-5)
  let lo = 5e-5
  let hi = 0.004
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (curve(mid) < s2) lo = mid
    else hi = mid
  }
  const e2 = (lo + hi) / 2
  return { E: (s2 - S1) / (e2 - 5e-5), S1, e2 }
}
/** Modulus chord dari data uji (interpolasi linear). */
export function chordFromData(pts: [number, number][], s2: number) {
  const interp = (e: number) => {
    for (let i = 1; i < pts.length; i++)
      if (pts[i][0] >= e) {
        const [x0, y0] = pts[i - 1]
        const [x1, y1] = pts[i]
        return y0 + ((y1 - y0) * (e - x0)) / Math.max(1e-12, x1 - x0)
      }
    return pts.length ? pts[pts.length - 1][1] : 0
  }
  if (pts.length < 4 || Math.max(...pts.map((p) => p[1])) < s2) return null
  const S1 = interp(5e-5)
  let e2 = 0
  for (let i = 1; i < pts.length; i++)
    if (pts[i][1] >= s2) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      e2 = x0 + ((s2 - y0) * (x1 - x0)) / Math.max(1e-12, y1 - y0)
      break
    }
  return { E: (s2 - S1) / (e2 - 5e-5), S1, e2 }
}

/** Kuat tarik belah teoretis ≈ 0,56√fc′ (penjelasan SNI 2847 / ACI 318), modulus runtuh fr = 0,62√fc′. */
export const splitStrength = (fc: number) => 0.56 * Math.sqrt(fc)
export const ruptureModulus = (fc: number) => 0.62 * Math.sqrt(fc)
/** Kuat tarik belah dari beban: fct = 2P/(π·L·D). */
export const splitFromLoad = (P: number, L: number, D: number) => (2 * P) / (Math.PI * L * D)
/**
 * Tegangan elastis di sepanjang diameter vertikal silinder uji belah (beban garis P/L), y dari titik beban atas (0…D):
 * σx = 2P/(πLD) tarik merata, σy = −2P/(πLD)·(D²/(y(D−y)) − 1) tekan.
 */
export function splitStress(P: number, L: number, D: number, y: number) {
  const s0 = (2 * P) / (Math.PI * L * D)
  return { sx: s0, sy: -s0 * ((D * D) / (y * (D - y)) - 1) }
}
