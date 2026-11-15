// Model Room Spring: memetakan setup + parameter ke SDOF.
import type { Sdof } from '../../lab/sdof'

export type Setup = 'tarik' | 'tekan' | 'horizontal' | 'rotasi'

export interface Params {
  m: number // kg (rotasi: massa piringan)
  k: number // N/m (rotasi: N·m/rad)
  c: number // N·s/m (rotasi: N·m·s/rad)
  g: number // m/s²
}

/** Panjang bebas pegas linear (m). */
export const L0 = 0.5
/** Jari-jari piringan setup rotasi (m). */
export const R_DISK = 0.2

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'tarik', label: 'Pegas Tarik', hint: 'massa digantung di bawah pegas' },
  { id: 'tekan', label: 'Pegas Tekan', hint: 'massa diletakkan di atas pegas' },
  { id: 'horizontal', label: 'Horizontal', hint: 'massa di lantai licin, tanpa gravitasi' },
  { id: 'rotasi', label: 'Rotasi', hint: 'piringan dengan pegas spiral (torsi)' },
]

export const isLinear = (s: Setup) => s !== 'rotasi'
export const isVertical = (s: Setup) => s === 'tarik' || s === 'tekan'

export interface Range {
  min: number
  max: number
  step: number
}

export function ranges(s: Setup): Record<'m' | 'k' | 'c' | 'g', Range> {
  if (s === 'rotasi')
    return {
      m: { min: 0.5, max: 20, step: 0.5 },
      k: { min: 0.2, max: 20, step: 0.1 },
      c: { min: 0, max: 2, step: 0.005 },
      g: { min: 0, max: 25, step: 0.01 },
    }
  return {
    m: { min: 0.1, max: 20, step: 0.1 },
    k: { min: 10, max: 2000, step: 5 },
    c: { min: 0, max: 100, step: 0.1 },
    g: { min: 0, max: 25, step: 0.01 },
  }
}

export function defaults(s: Setup): Params {
  switch (s) {
    case 'tarik':
      return { m: 2, k: 80, c: 0, g: 9.81 }
    case 'tekan':
      return { m: 2, k: 200, c: 0, g: 9.81 }
    case 'horizontal':
      return { m: 2, k: 80, c: 0, g: 9.81 }
    case 'rotasi':
      return { m: 4, k: 1.6, c: 0, g: 9.81 }
  }
}

export const inertia = (m: number) => 0.5 * m * R_DISK * R_DISK

export function toSdof(s: Setup, p: Params): Sdof {
  if (s === 'rotasi') return { M: inertia(p.m), K: p.k, C: p.c, F: 0 }
  return { M: p.m, K: p.k, C: p.c, F: isVertical(s) ? p.m * p.g : 0 }
}

/** Batas q saat benda di-drag. */
export function dragLimits(s: Setup, qeq: number): [number, number] {
  switch (s) {
    case 'tarik':
      return [-0.6 * L0, qeq + 0.35]
    case 'tekan':
      return [-0.35, 0.92 * L0]
    case 'horizontal':
      return [-0.6 * L0, 0.45]
    case 'rotasi':
      return [-Math.PI * 0.95, Math.PI * 0.95]
  }
}

/** Satuan tampilan simpangan: linear dalam cm, rotasi dalam derajat. */
export const display = (s: Setup) =>
  s === 'rotasi' ? { unit: '°', factor: 180 / Math.PI, name: 'θ' } : { unit: 'cm', factor: 100, name: 'u' }

export const units = (s: Setup) =>
  s === 'rotasi'
    ? { m: 'kg', k: 'N·m/rad', c: 'N·m·s/rad' }
    : { m: 'kg', k: 'N/m', c: 'N·s/m' }

// ---- URL (bagikan eksperimen) ----

export function parseQuery(q: string): { setup: Setup; params: Params } {
  const sp = new URLSearchParams(q)
  const raw = sp.get('setup') as Setup | null
  const setup: Setup = raw && SETUPS.some((x) => x.id === raw) ? raw : 'tarik'
  const d = defaults(setup)
  const r = ranges(setup)
  const num = (key: keyof Params) => {
    const v = Number(sp.get(key))
    if (!sp.has(key) || !Number.isFinite(v)) return d[key]
    return Math.min(r[key].max, Math.max(r[key].min, v))
  }
  return { setup, params: { m: num('m'), k: num('k'), c: num('c'), g: num('g') } }
}

export function toQuery(setup: Setup, p: Params): string {
  const sp = new URLSearchParams({ setup, m: String(p.m), k: String(p.k), c: String(p.c) })
  if (isVertical(setup) && p.g !== 9.81) sp.set('g', String(p.g))
  return sp.toString()
}
