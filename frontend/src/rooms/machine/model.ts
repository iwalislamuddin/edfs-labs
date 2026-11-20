// Model Room Machine Foundation: setup (jenis mesin) + jenis pondasi + parameter (tersimpan di URL).
import { type Machine, type MachineKind } from './physics'
import { blockSystem, tableSystem, type Sys3 } from './rocking'

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
  L: number // panjang blok / pelat meja tegak lurus poros (m)
  B: number // lebar blok / pelat searah poros (m)
  Hb: number // tebal blok / pelat (m)
  hs: number // tinggi poros di atas muka blok (m)
  ex: number // offset poros dari pusat blok (m)
  G: number // modulus geser tanah (MPa)
  nu: number
  hc: number // tinggi kolom meja (m)
  bc: number // sisi kolom meja persegi (m)
  z: number // redaman meja
  sk: number // skala tampilan simpangan (px per µm); 0 = auto
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'rotasi', label: 'Mesin Rotasi', hint: 'turbin, pompa, motor, kipas: gaya akibat massa tak seimbang m·e·ω²' },
  { id: 'torak', label: 'Mesin Torak', hint: 'kompresor/genset torak: gaya bolak-balik primer (ω) dan sekunder (2ω)' },
]

export const FNDS: { id: FndKind; label: string; hint: string }[] = [
  { id: 'tanah', label: 'Blok di atas tanah', hint: 'pegas & peredam tanah (analog Lysmer): redaman radiasi' },
  { id: 'meja', label: 'Meja / struktur', hint: 'pelat beton di atas 4 kolom jepit–jepit (table-top): sway, vertikal, rocking; redaman struktur kecil' },
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
  L: { min: 2, max: 12, step: 0.1 },
  B: { min: 2, max: 12, step: 0.1 },
  Hb: { min: 0.5, max: 4, step: 0.05 },
  hs: { min: 0.3, max: 3, step: 0.05 },
  ex: { min: -2, max: 2, step: 0.05 },
  G: { min: 10, max: 200, step: 1 },
  nu: { min: 0.25, max: 0.45, step: 0.01 },
  hc: { min: 1.5, max: 10, step: 0.1 },
  bc: { min: 0.3, max: 1.5, step: 0.05 },
  z: { min: 0.01, max: 0.1, step: 0.005 },
  sk: { min: 0, max: 20, step: 0.01 },
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
    L: 5,
    B: 4,
    Hb: 1.25,
    hs: 1,
    ex: 0,
    G: 40,
    nu: 0.35,
    hc: 4,
    bc: 0.6,
    z: 0.02,
    sk: 0,
  }
}

/** Pilihan skala tetap (px per µm simpangan). */
export const SCALES = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20]

/** Skala pilihan terdekat di bawah (atau sama dengan) skala auto saat ini. */
export const snapScale = (pxPerUm: number) => [...SCALES].reverse().find((v) => v <= pxPerUm * 1.0001) ?? SCALES[0]

export const RHO = 1800 // kg/m³ tanah
export const E_C = 30e9 // Pa, modulus elastisitas beton kolom

export function machineOf(s: Setup, p: Params): Machine {
  return { kind: s, me: p.me / 1000, mRec: p.mRec, mRot: p.mRot, r: p.r / 100, l: (p.r / 100) * p.lr }
}

/** Pondasi 3DOF (geser/sway–vertikal–rocking): blok di atas tanah atau pelat meja di atas kolom; massa dari dimensi. */
export function foundationOf(p: Params): Sys3 {
  const blk = { L: p.L, B: p.B, H: p.Hb }
  const pl = { Mm: p.Mm * 1000, hs: p.hs, ex: p.ex }
  if (p.fd === 'tanah') return blockSystem(blk, pl, { G: p.G * 1e6, nu: p.nu, rho: RHO })
  return tableSystem(blk, pl, { hc: p.hc, bc: p.bc, E: E_C }, p.z)
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
  const keys: Exclude<keyof Params, 'fd'>[] = ['Mm', 'rpm', 'rate']
  if (setup === 'rotasi') keys.push('me')
  else keys.push('mRec', 'mRot', 'r', 'lr')
  keys.push('L', 'B', 'Hb', 'hs', 'ex')
  if (p.fd === 'tanah') keys.push('G', 'nu')
  else keys.push('hc', 'bc', 'z')
  if (p.sk > 0) keys.push('sk')
  const sp = new URLSearchParams({ setup, fd: p.fd })
  for (const k of keys) sp.set(k, String(p[k]))
  return sp.toString()
}
