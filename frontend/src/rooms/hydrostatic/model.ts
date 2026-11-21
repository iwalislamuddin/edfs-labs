// Model Room Hydrostatic: setup, parameter, rentang slider, geometri pintu & busur, query URL.
import type { Arc, Gate, GateShape, GateSystem, Hinge, Layer, Vessel } from './hydro'

export type Setup = 'tekanan' | 'pintu' | 'lengkung'
export type Curve = 'radial' | 'cekung' | 'cembung' | 'gantung'

export interface Params {
  /** gravitasi m/s², rapat massa fluida utama (air) kg/m³ */
  g: number
  rho: number
  // --- Tekanan ---
  /** tekanan di atas muka (kPa, relatif; ≠ 0 = tangki tertutup) */
  p0: number
  /** fluida atas (mis. minyak): rapat massa dan tebal (m; 0 = satu fluida) */
  rho1: number
  h1: number
  /** tebal fluida utama di bawah (m) */
  h2: number
  ves: Vessel
  /** kedalaman probe dari muka teratas (m) dan posisi mendatar (−1…1 dari tengah) */
  pd: number
  px: number
  // --- Pintu bidang ---
  gs: GateShape
  L: number
  b: number
  al: number
  /** muka air hulu & hilir di atas ambang (m) */
  hu: number
  hd: number
  hinge: Hinge
  piv: number
  /** berat pintu (kN) */
  W: number
  // --- Permukaan lengkung ---
  kind: Curve
  R: number
  H: number
  bw: number
  /** pintu radial: tinggi poros dan tinggi pintu di atas ambang (m) */
  zp: number
  hg: number
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'tekanan', label: 'Tekanan', hint: 'p = p0 + Σγh, fluida berlapis, piezometer, paradoks hidrostatis' },
  { id: 'pintu', label: 'Pintu Bidang', hint: 'F = γ·hc·A, pusat tekanan, engsel, pintu otomatis' },
  { id: 'lengkung', label: 'Permukaan Lengkung', hint: 'FH proyeksi tegak, FV badan tekanan, pintu radial' },
]

export const VESSELS: { id: Vessel; label: string }[] = [
  { id: 'tegak', label: 'Tegak' },
  { id: 'melebar', label: 'Melebar' },
  { id: 'menyempit', label: 'Leher sempit' },
]
export const GATE_SHAPES: { id: GateShape; label: string }[] = [
  { id: 'persegi', label: 'Persegi' },
  { id: 'lingkaran', label: 'Lingkaran' },
  { id: 'segitiga', label: 'Segitiga' },
]
export const HINGES: { id: Hinge; label: string; title: string }[] = [
  { id: 'atas', label: 'Engsel atas', title: 'berputar di tepi atas, ditahan di tepi bawah' },
  { id: 'bawah', label: 'Engsel bawah', title: 'berputar di tepi bawah, ditahan di tepi atas' },
  { id: 'poros', label: 'Poros (otomatis)', title: 'berputar di poros, ditahan stop di tepi bawah — membuka sendiri bila muka air tinggi' },
]
export const CURVES: { id: Curve; label: string; title: string }[] = [
  { id: 'radial', label: 'Pintu radial', title: 'pintu Tainter: busur dengan poros di hilir, air di sisi cembung' },
  { id: 'cekung', label: 'Kuadran cekung', title: 'air di sisi pusat lingkaran (di atas busur)' },
  { id: 'cembung', label: 'Kuadran cembung', title: 'busur menonjol ke arah air' },
  { id: 'gantung', label: 'Kuadran menggantung', title: 'permukaan menghadap ke bawah: FV ke atas (badan tekanan khayal)' },
]

export const FLUIDS: { label: string; rho: number }[] = [
  { label: 'Air tawar', rho: 1000 },
  { label: 'Air laut', rho: 1025 },
  { label: 'Minyak', rho: 850 },
  { label: 'Bensin', rho: 720 },
  { label: 'Gliserin', rho: 1260 },
  { label: 'Raksa', rho: 13600 },
]

/** Bejana Room Tekanan: lebar dasar B (m) dan tinggi Hv (m). */
export const VB = 2
export const VH = 6

export const DEFAULTS: Params = {
  g: 9.81,
  rho: 1000,
  p0: 0,
  rho1: 850,
  h1: 1.5,
  h2: 3,
  ves: 'tegak',
  pd: 3,
  px: 0,
  gs: 'persegi',
  L: 3,
  b: 2,
  al: 60,
  hu: 5,
  hd: 0,
  hinge: 'atas',
  piv: 0.6,
  W: 0,
  kind: 'radial',
  R: 6,
  H: 4,
  bw: 4,
  zp: 3,
  hg: 5,
}

export interface Range {
  min: number
  max: number
  step: number
}
type Num = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params]

export const RANGES: Record<Num, Range> = {
  g: { min: 1, max: 25, step: 0.01 },
  rho: { min: 500, max: 14000, step: 5 },
  p0: { min: -60, max: 200, step: 0.5 },
  rho1: { min: 500, max: 14000, step: 5 },
  h1: { min: 0, max: 5, step: 0.05 },
  h2: { min: 0.2, max: 5.5, step: 0.05 },
  pd: { min: 0, max: 5.5, step: 0.01 },
  px: { min: -1, max: 1, step: 0.01 },
  L: { min: 0.5, max: 6, step: 0.05 },
  b: { min: 0.5, max: 6, step: 0.05 },
  al: { min: 20, max: 90, step: 1 },
  hu: { min: 0, max: 15, step: 0.05 },
  hd: { min: 0, max: 15, step: 0.05 },
  piv: { min: 0.05, max: 0.95, step: 0.01 },
  W: { min: 0, max: 500, step: 1 },
  R: { min: 0.5, max: 10, step: 0.05 },
  H: { min: 0.05, max: 18, step: 0.05 },
  bw: { min: 0.5, max: 10, step: 0.05 },
  zp: { min: 0, max: 10, step: 0.05 },
  hg: { min: 0.3, max: 18, step: 0.05 },
}

export const KEYS: Record<Setup, (keyof Params)[]> = {
  tekanan: ['g', 'rho', 'p0', 'rho1', 'h1', 'h2', 'ves', 'pd', 'px'],
  pintu: ['g', 'rho', 'gs', 'L', 'b', 'al', 'hu', 'hd', 'hinge', 'piv', 'W'],
  lengkung: ['g', 'rho', 'kind', 'R', 'H', 'bw', 'zp', 'hg'],
}

const clamp = (v: number, r: Range) => Math.min(r.max, Math.max(r.min, v))

export function clampParams(p: Params): Params {
  const o = { ...p }
  for (const k of Object.keys(RANGES) as Num[]) o[k] = clamp(o[k], RANGES[k])
  // tekanan: fluida total tidak melebihi bejana
  o.h1 = Math.max(0, Math.min(o.h1, VH - 0.5 - o.h2))
  o.pd = Math.min(o.pd, o.h1 + o.h2)
  // radial: poros tidak lebih tinggi dari R, puncak pintu dalam jangkauan busur, muka air tidak melimpas
  if (o.kind === 'radial') {
    o.zp = Math.min(o.zp, o.R * 0.95)
    o.hg = Math.min(Math.max(o.hg, o.zp + 0.1 * o.R), o.zp + o.R * 0.95)
    o.H = Math.min(o.H, o.hg)
  }
  return o
}

export const gammaOf = (p: Params) => p.rho * p.g

export function layers(p: Params): Layer[] {
  const out: Layer[] = []
  if (p.h1 > 1e-9) out.push({ rho: p.rho1, h: p.h1 })
  out.push({ rho: p.rho, h: p.h2 })
  return out
}

export const gateOf = (p: Params): Gate => ({ shape: p.gs, L: p.L, b: p.b, alpha: p.al })

export const gateSystem = (p: Params): GateSystem => ({
  gate: gateOf(p),
  gamma: gammaOf(p),
  h1: p.hu,
  h2: p.hd,
  hinge: p.hinge,
  pivot: p.piv,
  W: p.W * 1e3,
})

/** Busur per jenis. Batas dilalui dari bawah ke atas, air di kiri. Untuk kuadran juga dinding tegak di ujung atas. */
export function arcOf(p: Params): { arc: Arc; wallX: number | null } {
  const R = p.R
  switch (p.kind) {
    case 'radial':
      return {
        arc: { cx: 0, cz: p.zp, R, p0: Math.PI + Math.asin(p.zp / R), p1: Math.PI - Math.asin((p.hg - p.zp) / R) },
        wallX: null,
      }
    case 'cekung':
      return { arc: { cx: 0, cz: R, R, p0: 1.5 * Math.PI, p1: 2 * Math.PI }, wallX: R }
    case 'cembung':
      return { arc: { cx: R, cz: 0, R, p0: Math.PI, p1: Math.PI / 2 }, wallX: R }
    case 'gantung':
      return { arc: { cx: -R, cz: 0, R, p0: 0, p1: Math.PI / 2 }, wallX: -R }
  }
}

/** Nilai bawaan saat berganti jenis permukaan lengkung. */
export function curveDefaults(kind: Curve, old: Params): Params {
  if (kind === 'radial') return { ...old, kind, R: 6, zp: 3, hg: 5, H: 4, bw: 4 }
  return { ...old, kind, R: 2, H: 5, bw: 3 }
}

export function parseQuery(q: string): { setup: Setup; params: Params } {
  const sp = new URLSearchParams(q)
  const rs = sp.get('setup') as Setup | null
  const setup: Setup = rs && SETUPS.some((x) => x.id === rs) ? rs : 'tekanan'
  const p: Params = { ...DEFAULTS }
  const pick = <T extends string>(key: keyof Params, list: { id: T }[]) => {
    const v = sp.get(key)
    if (v && list.some((x) => x.id === v)) (p as unknown as Record<string, unknown>)[key] = v
  }
  pick('ves', VESSELS)
  pick('gs', GATE_SHAPES)
  pick('hinge', HINGES)
  pick('kind', CURVES)
  if (p.kind !== 'radial' && !sp.has('R')) Object.assign(p, curveDefaults(p.kind, p))
  for (const key of KEYS[setup]) {
    if (typeof DEFAULTS[key] !== 'number' || !sp.has(key)) continue
    const v = Number(sp.get(key))
    if (Number.isFinite(v)) (p as unknown as Record<string, number>)[key] = v
  }
  return { setup, params: clampParams(p) }
}

export function toQuery(setup: Setup, p: Params): string {
  const sp = new URLSearchParams({ setup })
  for (const key of KEYS[setup]) {
    const v = p[key]
    sp.set(key, typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : v)
  }
  return sp.toString()
}
