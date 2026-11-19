// Model Room Machine Foundation: setup (jenis mesin) + jenis pondasi + parameter (tersimpan di URL).
import { lysmer, massRatio, type Foundation, type Machine, type MachineKind } from './physics'

export type Setup = MachineKind
export type FndKind = 'tanah' | 'meja'

export interface Params {
  fd: FndKind
  Mm: number // massa mesin (ton)
  me: number // ketidakseimbangan (kg·mm) — rotasi
  mRec: number // kg — torak
  mRot: number // kg — torak
  r: number // jari-jari engkol (cm)
  lr: number // l/r
  rpm: number // putaran kerja (rpm)
  rate: number // laju start/stop (rpm/s)
  Mb: number // massa blok / pelat meja (ton)
  A: number // luas dasar blok (m²)
  G: number // modulus geser tanah (MPa)
  nu: number
  k: number // kekakuan meja (MN/m)
  z: number // redaman meja
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'rotasi', label: 'Mesin Rotasi', hint: 'turbin, pompa, motor, kipas: gaya akibat massa tak seimbang m·e·ω²' },
  { id: 'torak', label: 'Mesin Torak', hint: 'kompresor/genset torak: gaya bolak-balik primer (ω) dan sekunder (2ω)' },
]

export const FNDS: { id: FndKind; label: string; hint: string }[] = [
  { id: 'tanah', label: 'Blok di atas tanah', hint: 'pegas & peredam tanah (analog Lysmer): redaman radiasi' },
  { id: 'meja', label: 'Meja / struktur', hint: 'pelat beton di atas kolom (table-top): redaman struktur kecil' },
]

export interface Range {
  min: number
  max: number
  step: number
}

export const RANGES: Record<Exclude<keyof Params, 'fd'>, Range> = {
  Mm: { min: 1, max: 50, step: 0.5 },
  me: { min: 10, max: 5000, step: 10 },
  mRec: { min: 10, max: 1000, step: 5 },
  mRot: { min: 0, max: 500, step: 5 },
  r: { min: 3, max: 30, step: 0.5 },
  lr: { min: 3, max: 8, step: 0.1 },
  rpm: { min: 0, max: 3600, step: 10 },
  rate: { min: 50, max: 2000, step: 10 },
  Mb: { min: 5, max: 400, step: 1 },
  A: { min: 4, max: 80, step: 0.5 },
  G: { min: 10, max: 200, step: 1 },
  nu: { min: 0.25, max: 0.45, step: 0.01 },
  k: { min: 10, max: 3000, step: 10 },
  z: { min: 0.01, max: 0.1, step: 0.005 },
}

export const RPM_MAX: Record<Setup, number> = { rotasi: 3600, torak: 1200 }

export function defaults(s: Setup): Params {
  return {
    fd: 'tanah',
    Mm: 10,
    me: 300,
    mRec: 100,
    mRot: 50,
    r: 10,
    lr: 4,
    rpm: s === 'rotasi' ? 1500 : 600,
    rate: s === 'rotasi' ? 300 : 120,
    Mb: 60,
    A: 20,
    G: 40,
    nu: 0.35,
    k: 400,
    z: 0.02,
  }
}

export const RHO = 1800 // kg/m³ tanah

export function machineOf(s: Setup, p: Params): Machine {
  return { kind: s, me: p.me / 1000, mRec: p.mRec, mRot: p.mRot, r: p.r / 100, l: (p.r / 100) * p.lr }
}

export function foundationOf(p: Params): Foundation & { r0: number; Bz: number | null } {
  const M = (p.Mm + p.Mb) * 1000
  if (p.fd === 'tanah') {
    const soil = { G: p.G * 1e6, nu: p.nu, rho: RHO }
    const r0 = Math.sqrt(p.A / Math.PI)
    const { k, c } = lysmer(soil, r0)
    return { M, k, c, r0, Bz: massRatio(soil, r0, M) }
  }
  const k = p.k * 1e6
  return { M, k, c: 2 * p.z * Math.sqrt(k * M), r0: 0, Bz: null }
}

/** Kategori getaran indikatif dari kecepatan puncak (mm/s) — bukan pengganti kriteria pabrikan/standar. */
export function severity(vPeak: number): { label: string; color: string } {
  if (vPeak <= 2.5) return { label: 'baik', color: 'var(--green)' }
  if (vPeak <= 6.3) return { label: 'dapat diterima', color: '#8a9a3a' }
  if (vPeak <= 16) return { label: 'kurang baik', color: 'var(--orange)' }
  return { label: 'berbahaya', color: '#b5452f' }
}

// ---- URL ----

export function parseQuery(q: string): { setup: Setup; params: Params } {
  const sp = new URLSearchParams(q)
  const raw = sp.get('setup') as Setup | null
  const setup: Setup = raw && SETUPS.some((x) => x.id === raw) ? raw : 'rotasi'
  const d = defaults(setup)
  const fd = (sp.get('fd') as FndKind | null) ?? d.fd
  const num = (key: Exclude<keyof Params, 'fd'>) => {
    const v = Number(sp.get(key))
    if (!sp.has(key) || !Number.isFinite(v)) return d[key]
    return Math.min(RANGES[key].max, Math.max(RANGES[key].min, v))
  }
  const params: Params = { ...d, fd: FNDS.some((f) => f.id === fd) ? fd : d.fd }
  for (const key of Object.keys(RANGES) as Exclude<keyof Params, 'fd'>[]) params[key] = num(key)
  params.rpm = Math.min(params.rpm, RPM_MAX[setup])
  return { setup, params }
}

export function toQuery(setup: Setup, p: Params): string {
  const keys: Exclude<keyof Params, 'fd'>[] = ['Mm', 'rpm', 'rate', 'Mb']
  if (setup === 'rotasi') keys.push('me')
  else keys.push('mRec', 'mRot', 'r', 'lr')
  if (p.fd === 'tanah') keys.push('A', 'G', 'nu')
  else keys.push('k', 'z')
  const sp = new URLSearchParams({ setup, fd: p.fd })
  for (const k of keys) sp.set(k, String(p[k]))
  return sp.toString()
}
