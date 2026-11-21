// Model Room Tensile Test: setup, parameter, rentang, material bawaan, query URL.
import { clampSteel, presetById, STEELS, type Steel } from './material'

export type Setup = 'tarik' | 'siklus' | 'banding' | 'beton'
export type ConcMode = 'tekan' | 'belah'

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'tarik', label: 'Uji Tarik', hint: 'kurva tegangan–regangan sampai putus: leleh, pengerasan, necking' },
  { id: 'siklus', label: 'Bongkar-Muat', hint: 'bongkar di tengah uji: pemulihan elastis, regangan permanen, pengerasan dingin' },
  { id: 'banding', label: 'Bandingkan', hint: 'baja struktur, tulangan, mutu tinggi, aluminium, besi cor' },
  { id: 'beton', label: 'Beton', hint: 'uji tekan silinder dan uji tarik belah' },
]

/**
 * E (GPa) · fy, fu (MPa) · eu regangan seragam (%) · A perpanjangan putus pada L0 = 5d0 (%) · Z reduksi luas (%)
 * d diameter benda uji (mm) · k = L0/d0 · v laju uji (×) · fc kuat tekan beton (MPa)
 */
export interface Params {
  E: number
  fy: number
  fu: number
  eu: number
  A: number
  Z: number
  d: number
  k: number
  v: number
  fc: number
}

export const STEEL_KEYS: (keyof Params)[] = ['E', 'fy', 'fu', 'eu', 'A', 'Z']
export const KEYS: Record<Setup, (keyof Params)[]> = {
  tarik: [...STEEL_KEYS, 'd', 'k', 'v'],
  siklus: [...STEEL_KEYS, 'd', 'k', 'v'],
  banding: ['k'],
  beton: ['fc', 'v'],
}

export interface Range {
  min: number
  max: number
  step: number
}
export const RANGES: Record<keyof Params, Range> = {
  E: { min: 50, max: 250, step: 1 },
  fy: { min: 100, max: 900, step: 5 },
  fu: { min: 120, max: 1000, step: 5 },
  eu: { min: 0.5, max: 30, step: 0.1 },
  A: { min: 0.3, max: 45, step: 0.1 },
  Z: { min: 0, max: 85, step: 1 },
  d: { min: 5, max: 25, step: 0.5 },
  k: { min: 2, max: 20, step: 0.1 },
  v: { min: 0.25, max: 4, step: 0.25 },
  fc: { min: 15, max: 80, step: 1 },
}

export function fromPreset(id: string): Pick<Params, 'E' | 'fy' | 'fu' | 'eu' | 'A' | 'Z'> {
  const m = presetById(id).m
  return { E: m.E / 1000, fy: m.fy, fu: m.fu, eu: m.eu * 100, A: m.A5 * 100, Z: m.Z * 100 }
}

export const BASE: Params = { ...fromPreset('bj41'), d: 10, k: 5, v: 1, fc: 30 }

const clamp = (v: number, r: Range) => Math.min(r.max, Math.max(r.min, v))
export function clampParams(p: Params): Params {
  const o = { ...p }
  for (const k of Object.keys(RANGES) as (keyof Params)[]) o[k] = clamp(o[k], RANGES[k])
  return o
}

/** Material baja efektif: sifat bawaan preset (jenis kurva, leleh atas, εsh, Esh) + nilai slider, lalu dijaga konsisten. */
export function steelOf(mat: string, p: Params): Steel {
  const base = presetById(mat).m
  const m: Steel = { ...base, E: p.E * 1000, fy: p.fy, fu: p.fu, eu: p.eu / 100, A5: p.A / 100, Z: p.Z / 100 }
  // clampSteel menggeser εsh dan εu bila fy/fu dari slider membuat urutan regangan tidak konsisten
  return clampSteel(m)
}

/** Panjang ukur standar (EN ISO 6892-1 / SNI 8389): L0 = 5,65√S0 = 5d0, L0 = 11,3√S0 = 10d0, tulangan 200 mm. */
export const GAUGES = (d: number) => [
  { label: '5d0', k: 5, title: 'L0 = 5,65√S0 (proporsional pendek)' },
  { label: '10d0', k: 10, title: 'L0 = 11,3√S0 (proporsional panjang)' },
  { label: '200 mm', k: Math.min(20, 200 / d), title: 'panjang ukur tetap 200 mm (mis. ASTM A370 untuk tulangan)' },
]

// ---- URL ----

export interface State {
  setup: Setup
  mat: string
  mode: ConcMode
  p: Params
}

export function parseQuery(q: string): State {
  const sp = new URLSearchParams(q)
  const rs = sp.get('setup') as Setup | null
  const setup: Setup = rs && SETUPS.some((x) => x.id === rs) ? rs : 'tarik'
  const rm = sp.get('mat')
  const mat = rm && STEELS.some((x) => x.id === rm) ? rm : 'bj41'
  const mode: ConcMode = sp.get('mode') === 'belah' ? 'belah' : 'tekan'
  const p: Params = { ...BASE, ...fromPreset(mat) }
  for (const k of KEYS[setup]) {
    const v = Number(sp.get(k))
    if (sp.has(k) && Number.isFinite(v)) p[k] = v
  }
  return { setup, mat, mode, p: clampParams(p) }
}

export function toQuery(s: State): string {
  const q = new URLSearchParams({ setup: s.setup })
  if (s.setup !== 'beton') q.set('mat', s.mat)
  else q.set('mode', s.mode)
  for (const k of KEYS[s.setup]) q.set(k, String(Math.round(s.p[k] * 1e4) / 1e4))
  return q.toString()
}
