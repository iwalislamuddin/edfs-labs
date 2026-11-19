// Fisika Room Element: transformasi tegangan/regangan bidang, tegangan utama, lingkaran Mohr, kriteria leleh.
// Konvensi: tarik +, τxy + bila bekerja ke arah +y pada muka +x. Sudut θ diukur berlawanan jarum jam dari sumbu x.
// Satuan: tegangan MPa, E dalam GPa (→ regangan = MPa / (1000·E)), regangan tanpa satuan.

export interface Stress {
  sx: number
  sy: number
  txy: number
}

const RAD = Math.PI / 180

/** Tegangan pada elemen yang diputar θ (derajat): σx', σy', τx'y'. */
export function transform(s: Stress, thetaDeg: number): Stress {
  const c = Math.cos(2 * thetaDeg * RAD)
  const n = Math.sin(2 * thetaDeg * RAD)
  const avg = (s.sx + s.sy) / 2
  const dif = (s.sx - s.sy) / 2
  return {
    sx: avg + dif * c + s.txy * n,
    sy: avg - dif * c - s.txy * n,
    txy: -dif * n + s.txy * c,
  }
}

export interface Principal {
  C: number // pusat lingkaran Mohr (σ rata-rata)
  R: number // jari-jari = τmaks bidang
  s1: number
  s2: number
  /** Sudut bidang utama σ1 (derajat, −90 < θp ≤ 90). */
  thetaP: number
  /** Sudut bidang geser maksimum (θp − 45°, dinormalkan ke (−90, 90]). */
  thetaS: number
}

const norm90 = (d: number) => {
  let x = ((d + 90) % 180 + 180) % 180 - 90
  if (x <= -90 + 1e-12) x += 180
  return x
}

export function principal(s: Stress): Principal {
  const C = (s.sx + s.sy) / 2
  const dif = (s.sx - s.sy) / 2
  const R = Math.hypot(dif, s.txy)
  // θp memaksimalkan σx': tan 2θp = 2τ / (σx − σy), cabang yang memberi σ1
  const thetaP = R < 1e-12 ? 0 : norm90(0.5 * Math.atan2(s.txy, dif) / RAD)
  return { C, R, s1: C + R, s2: C - R, thetaP, thetaS: norm90(thetaP - 45) }
}

/** Tiga tegangan utama terurut (σ1 ≥ σ2 ≥ σ3) bila σz juga utama (τxz = τyz = 0). */
export function principal3(s: Stress, sz: number): [number, number, number] {
  const p = principal(s)
  return [p.s1, p.s2, sz].sort((a, b) => b - a) as [number, number, number]
}

/** Tegangan geser maksimum mutlak (3D) = (σmaks − σmin)/2. */
export const tauAbs = (s: Stress, sz = 0) => {
  const [a, , c] = principal3(s, sz)
  return (a - c) / 2
}

/** Von Mises dari tiga tegangan utama. */
export function vonMises(s: Stress, sz = 0): number {
  const [a, b, c] = principal3(s, sz)
  return Math.sqrt(((a - b) ** 2 + (b - c) ** 2 + (c - a) ** 2) / 2)
}

/** Tegangan ekivalen Tresca = σmaks − σmin. */
export const tresca = (s: Stress, sz = 0) => 2 * tauAbs(s, sz)

// ---------- regangan ----------

export interface Strain {
  ex: number
  ey: number
  gxy: number // regangan geser teknik γ = 2·εxy
}

/** Hukum Hooke tegangan bidang (σz = 0) atau umum dengan σz. E dalam GPa, tegangan MPa. */
export function hooke(s: Stress, E: number, nu: number, sz = 0): Strain & { ez: number; G: number; ev: number } {
  const e = E * 1000 // MPa
  const G = e / (2 * (1 + nu))
  const ex = (s.sx - nu * (s.sy + sz)) / e
  const ey = (s.sy - nu * (s.sx + sz)) / e
  const ez = (sz - nu * (s.sx + s.sy)) / e
  return { ex, ey, gxy: s.txy / G, ez, G: G / 1000, ev: ex + ey + ez }
}

/** Regangan pada arah yang diputar θ — bentuk sama dengan tegangan dengan τ → γ/2. */
export function transformStrain(e: Strain, thetaDeg: number): Strain {
  const t = transform({ sx: e.ex, sy: e.ey, txy: e.gxy / 2 }, thetaDeg)
  return { ex: t.sx, ey: t.sy, gxy: 2 * t.txy }
}

export function principalStrain(e: Strain): Principal {
  return principal({ sx: e.ex, sy: e.ey, txy: e.gxy / 2 })
}

/** Regangan normal yang dibaca strain gauge pada sudut θ (derajat). */
export const gauge = (e: Strain, thetaDeg: number) => transformStrain(e, thetaDeg).ex

// ---------- kasus bawaan ----------

export interface Preset {
  id: string
  label: string
  hint: string
  s: Stress
  sz?: number
}

export const PRESETS: Preset[] = [
  { id: 'umum', label: 'Umum', hint: 'σx, σy, τ sembarang', s: { sx: 80, sy: -40, txy: 30 } },
  { id: 'uniaksial', label: 'Tarik uniaksial', hint: 'batang tarik: geser maks = σ/2 pada 45°', s: { sx: 100, sy: 0, txy: 0 } },
  { id: 'geser', label: 'Geser murni', hint: 'torsi poros: σ1 = −σ2 = τ pada 45°', s: { sx: 0, sy: 0, txy: 60 } },
  { id: 'pipa', label: 'Pipa bertekanan', hint: 'σ keliling = 2 × σ memanjang (pr/t, pr/2t)', s: { sx: 40, sy: 80, txy: 0 } },
  { id: 'hidro', label: 'Hidrostatik bidang', hint: 'σx = σy, τ = 0: lingkaran Mohr menjadi titik', s: { sx: 50, sy: 50, txy: 0 } },
  { id: 'balok', label: 'Balok (lentur + geser)', hint: 'serat balok: σx dari M, τ dari V, σy ≈ 0', s: { sx: -60, sy: 0, txy: 25 } },
]
