// Fisika Room Hydrostatic: tekanan fluida berlapis, gaya pada pintu bidang (rumus γ·hc·A + Ic) vs integrasi pias,
// gaya pada permukaan lengkung busur lingkaran (FH proyeksi, FV badan tekanan) vs integrasi p·n·ds.
// Satuan SI: m, kg/m³, Pa, N. Tekanan relatif (gauge) terhadap atmosfer.

export interface Layer {
  rho: number
  /** tebal lapisan (m), dari atas ke bawah */
  h: number
}

/** Tekanan relatif (Pa) pada kedalaman d (m) dari muka bebas teratas. p0 = tekanan di atas muka (Pa). */
export function pressure(p0: number, layers: Layer[], g: number, d: number): number {
  let p = p0
  let top = 0
  for (const L of layers) {
    const t = Math.min(Math.max(d - top, 0), L.h)
    p += L.rho * g * t
    top += L.h
    if (d <= top) break
  }
  return p
}

/** Rapat massa di kedalaman d (lapisan terakhir bila di bawah dasar). */
export function rhoAt(layers: Layer[], d: number): number {
  let top = 0
  for (const L of layers) {
    top += L.h
    if (d <= top + 1e-12) return L.rho
  }
  return layers[layers.length - 1].rho
}

/** "Terukur": berat kolom fluida di atas titik dijumlahkan per pias tipis (∫ρ g dz) + p0. */
export function columnIntegral(p0: number, layers: Layer[], g: number, d: number, n = 2000): number {
  if (d <= 0) return p0
  const dz = d / n
  let p = p0
  for (let i = 0; i < n; i++) p += rhoAt(layers, (i + 0.5) * dz) * g * dz
  return p
}

/** Tinggi kolom piezometer di atas titik sadap (m): p / (ρ_lokal·g). */
export const piezoRise = (p: number, rho: number, g: number) => p / (rho * g)

// ---------------- bejana (paradoks hidrostatis) ----------------

export type Vessel = 'tegak' | 'melebar' | 'menyempit'

/** Lebar bejana (m, per 1 m tegak lurus bidang gambar) pada ketinggian z dari dasar. B = lebar dasar, Hv = tinggi bejana. */
export function vesselWidth(v: Vessel, B: number, Hv: number, z: number): number {
  const t = Math.min(1, Math.max(0, z / Hv))
  if (v === 'melebar') return B * (1 + 1.6 * t)
  if (v === 'menyempit') {
    const a = 0.3
    const b = 0.42
    if (t <= a) return B
    if (t >= b) return 0.22 * B
    return B * (1 - ((t - a) / (b - a)) * 0.78)
  }
  return B
}

/** Berat fluida di dalam bejana (N per m tebal), integrasi pias horizontal. */
export function vesselWeight(v: Vessel, B: number, Hv: number, layers: Layer[], g: number, n = 4000): number {
  const H = layers.reduce((s, L) => s + L.h, 0)
  const dz = H / n
  let W = 0
  for (let i = 0; i < n; i++) {
    const z = (i + 0.5) * dz
    W += rhoAt(layers, H - z) * g * vesselWidth(v, B, Hv, z) * dz
  }
  return W
}

// ---------------- pintu bidang ----------------

export type GateShape = 'persegi' | 'lingkaran' | 'segitiga'

export interface Gate {
  shape: GateShape
  /** panjang pintu sepanjang kemiringan (m); untuk lingkaran = diameter */
  L: number
  /** lebar pintu (m); segitiga: lebar alas (di bawah, puncak di atas); lingkaran: tidak dipakai */
  b: number
  /** sudut kemiringan terhadap horizontal (°), 90 = tegak */
  alpha: number
}

/** Lebar pintu pada koordinat s (m) sepanjang kemiringan, diukur dari tepi atas ke bawah. */
export function gateWidth(g: Gate, s: number): number {
  if (s < 0 || s > g.L) return 0
  if (g.shape === 'persegi') return g.b
  if (g.shape === 'segitiga') return (g.b * s) / g.L
  const R = g.L / 2
  const u = s - R
  return 2 * Math.sqrt(Math.max(0, R * R - u * u))
}

/** Momen luas eksak ∫ b(s)·s^k ds, k = 0, 1, 2, pada [s1, s2] (bentuk tertutup). */
export function gateMoments(g: Gate, s1: number, s2: number): [number, number, number] {
  const a = Math.max(0, Math.min(s1, s2))
  const c = Math.min(g.L, Math.max(s1, s2))
  if (c <= a) return [0, 0, 0]
  if (g.shape === 'persegi') {
    const b = g.b
    return [b * (c - a), (b * (c * c - a * a)) / 2, (b * (c ** 3 - a ** 3)) / 3]
  }
  if (g.shape === 'segitiga') {
    const k = g.b / g.L
    return [(k * (c * c - a * a)) / 2, (k * (c ** 3 - a ** 3)) / 3, (k * (c ** 4 - a ** 4)) / 4]
  }
  const R = g.L / 2
  const F0 = (u: number) => {
    const q = Math.sqrt(Math.max(0, R * R - u * u))
    return u * q + R * R * Math.asin(Math.max(-1, Math.min(1, u / R)))
  }
  const F1 = (u: number) => (-2 / 3) * Math.max(0, R * R - u * u) ** 1.5
  const F2 = (u: number) => {
    const q = Math.sqrt(Math.max(0, R * R - u * u))
    return (u * (2 * u * u - R * R) * q) / 4 + (R ** 4 * Math.asin(Math.max(-1, Math.min(1, u / R)))) / 4
  }
  const ua = a - R
  const uc = c - R
  const I0 = F0(uc) - F0(ua)
  const J1 = F1(uc) - F1(ua)
  const J2 = F2(uc) - F2(ua)
  return [I0, J1 + R * I0, J2 + 2 * R * J1 + R * R * I0]
}

/** Titik berat seluruh pintu dari tepi atas (m) dan luas penuh. */
export function gateCentroid(g: Gate) {
  const [A, M1] = gateMoments(g, 0, g.L)
  return { A, s: M1 / A }
}

export interface PlaneForce {
  /** luas basah, m² */
  A: number
  /** koordinat s titik berat luas basah (dari tepi atas, m) */
  sc: number
  /** jarak miring muka air → titik berat (m) */
  yc: number
  /** kedalaman titik berat (m) */
  hc: number
  /** momen inersia luas basah terhadap sumbu berat sejajar muka air, m⁴ */
  Ic: number
  /** gaya resultan, N (tegak lurus pintu) */
  F: number
  /** jarak miring muka air → pusat tekanan (m) */
  yp: number
  /** koordinat s pusat tekanan (m) */
  sp: number
  /** kedalaman pusat tekanan (m) */
  hp: number
}

const EMPTY: PlaneForce = { A: 0, sc: 0, yc: 0, hc: 0, Ic: 0, F: 0, yp: 0, sp: 0, hp: 0 }

/**
 * Gaya air pada pintu: muka air memotong garis pintu di s = sw (boleh negatif = di atas tepi atas).
 * Rumus buku: F = γ·hc·A, yp = yc + Ic/(yc·A), dengan A, titik berat, Ic dari luas basah (bentuk tertutup).
 */
export function planeForce(g: Gate, gamma: number, sw: number): PlaneForce {
  const sin = Math.sin((g.alpha * Math.PI) / 180)
  const [A, M1, M2] = gateMoments(g, sw, g.L)
  if (A <= 1e-12) return EMPTY
  const sc = M1 / A
  const Ic = M2 - (M1 * M1) / A
  const yc = sc - sw
  const hc = yc * sin
  const F = gamma * hc * A
  const yp = yc + Ic / (yc * A)
  return { A, sc, yc, hc, Ic, F, yp, sp: sw + yp, hp: yp * sin }
}

/** "Terukur": pintu dibagi n pias sejajar muka air, Σ p·b·ds dan momennya. */
export function planeStrips(g: Gate, gamma: number, sw: number, n = 800) {
  const sin = Math.sin((g.alpha * Math.PI) / 180)
  const ds = g.L / n
  let F = 0
  let M = 0
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * ds
    if (s <= sw) continue
    const dF = gamma * (s - sw) * sin * gateWidth(g, s) * ds
    F += dF
    M += dF * s
  }
  return { F, sp: F > 0 ? M / F : 0 }
}

export type Hinge = 'atas' | 'bawah' | 'poros'

export interface GateSystem {
  gate: Gate
  gamma: number
  /** kedalaman air hulu dan hilir di atas ambang (tepi bawah pintu di z = 0), m */
  h1: number
  h2: number
  hinge: Hinge
  /** letak poros sebagai pecahan L dari tepi atas (hinge = poros) */
  pivot: number
  /** berat sendiri pintu, N */
  W: number
}

/** s muka air untuk kedalaman h di atas ambang: z(s) = (L − s)·sin α. */
export const surfaceS = (g: Gate, h: number) => g.L - h / Math.sin((g.alpha * Math.PI) / 180)

export interface GateResult {
  up: PlaneForce
  down: PlaneForce
  /** letak engsel/poros dan titik tumpuan penahan (koordinat s) */
  sh: number
  sP: number
  /** momen terhadap engsel (N·m), + = cenderung membuka ke hilir pada sisi tumpuan */
  M: number
  Mw: number
  /** gaya penahan tegak lurus pintu di tumpuan (N); < 0: tumpuan harus menarik / pintu poros membuka */
  P: number
  /** reaksi engsel tegak lurus pintu (N) */
  Rn: number
  open: boolean
}

export function gateSolve(sys: GateSystem): GateResult {
  const { gate: g, gamma } = sys
  const up = planeForce(g, gamma, surfaceS(g, sys.h1))
  const down = planeForce(g, gamma, surfaceS(g, sys.h2))
  const sh = sys.hinge === 'atas' ? 0 : sys.hinge === 'bawah' ? g.L : sys.pivot * g.L
  const sP = sys.hinge === 'bawah' ? 0 : g.L
  const cos = Math.cos((g.alpha * Math.PI) / 180)
  const Wn = sys.W * cos // komponen berat tegak lurus pintu (searah dorongan air hulu)
  const sc = gateCentroid(g).s
  const Mw = (sc - sh) * Wn
  const M = (up.sp - sh) * up.F - (down.sp - sh) * down.F + Mw
  const P = M / (sP - sh)
  const Rn = up.F - down.F + Wn - P
  return { up, down, sh, sP, M, Mw, P, Rn, open: sys.hinge === 'poros' && P < 0 }
}

/** Muka air hulu saat pintu poros tepat membuka (P = 0), bisection; null bila tidak terjadi di [lo, hi]. */
export function openingLevel(sys: GateSystem, lo = 1e-3, hi = 60): number | null {
  const f = (h: number) => gateSolve({ ...sys, h1: h }).P
  let a = Math.max(lo, sys.h2 + 1e-6)
  let b = hi
  let fa = f(a)
  const fb = f(b)
  if (fa * fb > 0) {
    // cari perubahan tanda dengan sapuan kasar
    let found = false
    const n = 240
    for (let i = 1; i <= n; i++) {
      const x = a + ((b - a) * i) / n
      const fx = f(x)
      if (fa * fx <= 0) {
        b = x
        found = true
        break
      }
      a = x
      fa = fx
    }
    if (!found) return null
  }
  for (let k = 0; k < 80; k++) {
    const m = (a + b) / 2
    const fm = f(m)
    if (fa * fm <= 0) b = m
    else {
      a = m
      fa = fm
    }
  }
  return (a + b) / 2
}

// ---------------- permukaan lengkung ----------------

export interface Arc {
  cx: number
  cz: number
  R: number
  /** sudut awal (bawah) dan akhir (atas), rad; batas dilalui dari bawah ke atas, air di sisi kiri arah jalan */
  p0: number
  p1: number
}

export const arcPoint = (a: Arc, phi: number): [number, number] => [a.cx + a.R * Math.cos(phi), a.cz + a.R * Math.sin(phi)]

/** Sudut tempat busur memotong muka air z = H (z monoton sepanjang busur); p1 bila busur seluruhnya terendam. */
export function wetEnd(a: Arc, H: number): number | null {
  const z = (phi: number) => a.cz + a.R * Math.sin(phi)
  if (z(a.p0) >= H) return null
  if (z(a.p1) <= H) return a.p1
  let lo = a.p0
  let hi = a.p1
  for (let k = 0; k < 80; k++) {
    const m = (lo + hi) / 2
    if (z(m) < H) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

export interface CurvedForce {
  /** komponen gaya air pada permukaan (N); x + ke kanan (hilir), z + ke atas */
  Fx: number
  Fz: number
  /** rumus buku: FH = γ·hc·Aproj, letak garis kerja (kedalaman) */
  Aproj: number
  hcProj: number
  hFH: number
  /** luas badan tekanan (m², per m lebar) dan absis titik beratnya → garis kerja FV */
  Abody: number
  xFV: number
  /** rentang basah */
  zLo: number
  zHi: number
  phiWet: number
}

/**
 * Bentuk tertutup. Gaya air mendorong ke sisi kanan arah jalan (sisi kering): bila φ bertambah (berlawanan jarum jam),
 * arah = +e_r (air di sisi pusat, cekung); bila φ berkurang, arah = −e_r (air di sisi cembung).
 */
export function curvedForce(a: Arc, gamma: number, b: number, H: number): CurvedForce | null {
  const pe = wetEnd(a, H)
  if (pe === null) return null
  const dir = Math.sign(a.p1 - a.p0)
  const lo = Math.min(a.p0, pe)
  const hi = Math.max(a.p0, pe)
  const D = H - a.cz
  const R = a.R
  // ∫ d·cosφ R dφ dan ∫ d·sinφ R dφ dengan d = D − R sinφ
  const Ix = (p: number) => R * (D * Math.sin(p) - (R * Math.sin(p) ** 2) / 2)
  const Iz = (p: number) => R * (-D * Math.cos(p) - R * (p / 2 - Math.sin(2 * p) / 4))
  const Fx = dir * gamma * b * (Ix(hi) - Ix(lo))
  const Fz = dir * gamma * b * (Iz(hi) - Iz(lo))
  const z0 = a.cz + R * Math.sin(a.p0)
  const z1 = a.cz + R * Math.sin(pe)
  const zLo = Math.min(z0, z1)
  const zHi = Math.max(z0, z1)
  const dz = zHi - zLo
  const hc = H - (zLo + zHi) / 2
  const Aproj = b * dz
  const hFH = dz > 0 ? hc + (b * dz ** 3) / 12 / (hc * Aproj) : 0
  // badan tekanan: ∫(H − z) dx sepanjang busur (bertanda), titik berat x̄ = ∫x(H − z)dx / ∫(H − z)dx
  // dengan x = cx + R cosφ, z = cz + R sinφ, dx = −R sinφ dφ
  const A1 = (p: number) => R * D * Math.cos(p) + R * R * (p / 2 - Math.sin(2 * p) / 4) // ∫ (D − R sinφ)(−R sinφ) dφ
  const Abody = A1(pe) - A1(a.p0)
  // ∫ x (H − z) dx = ∫ (cx + R cosφ)(D − R sinφ)(−R sinφ) dφ
  const X1 = (p: number) => {
    const s = Math.sin(p)
    // cx·A1 + ∫ R cosφ (D − R sinφ)(−R sinφ) dφ = cx·A1 + [−R² D s²/2 + R³ s³/3]
    return a.cx * A1(p) + (-R * R * D * s * s) / 2 + (R ** 3 * s ** 3) / 3
  }
  const Mx = X1(pe) - X1(a.p0)
  return { Fx, Fz, Aproj, hcProj: hc, hFH, Abody: Math.abs(Abody), xFV: Abody !== 0 ? Mx / Abody : a.cx, zLo, zHi, phiWet: pe }
}

/** "Terukur": busur basah dibagi n segmen, Σ p·n·ds, beserta momen terhadap pusat busur dan terhadap titik (ox, oz). */
export function curvedStrips(a: Arc, gamma: number, b: number, H: number, n = 3000, ox = 0, oz = 0) {
  const pe = wetEnd(a, H)
  if (pe === null) return { Fx: 0, Fz: 0, Mc: 0, Mo: 0 }
  let Fx = 0
  let Fz = 0
  let Mc = 0
  let Mo = 0
  for (let i = 0; i < n; i++) {
    const [x1, z1] = arcPoint(a, a.p0 + ((pe - a.p0) * i) / n)
    const [x2, z2] = arcPoint(a, a.p0 + ((pe - a.p0) * (i + 1)) / n)
    const xm = (x1 + x2) / 2
    const zm = (z1 + z2) / 2
    const p = gamma * Math.max(0, H - zm)
    // normal kanan arah jalan (tz, −tx) × panjang segmen
    const fx = p * b * (z2 - z1)
    const fz = -p * b * (x2 - x1)
    Fx += fx
    Fz += fz
    Mc += (xm - a.cx) * fz - (zm - a.cz) * fx
    Mo += (xm - ox) * fz - (zm - oz) * fx
  }
  return { Fx, Fz, Mc, Mo }
}
