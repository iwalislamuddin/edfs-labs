// Model Room Element: setup, parameter, rentang slider, query URL.
import type { Stress } from './mohr'

export type Setup = 'tegangan' | 'regangan' | 'tiga'

/**
 * sx, sy, txy, sz tegangan (MPa) · th sudut putar elemen θ (derajat, berlawanan jarum jam)
 * E modulus elastisitas (GPa) · nu rasio Poisson · k faktor pembesar gambar deformasi
 */
export interface Params {
  sx: number
  sy: number
  txy: number
  sz: number
  th: number
  E: number
  nu: number
  k: number
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'tegangan', label: 'Tegangan & Mohr', hint: 'rotasi elemen, tegangan utama, lingkaran Mohr' },
  { id: 'regangan', label: 'Regangan & Poisson', hint: 'deformasi elemen, hukum Hooke, strain gauge' },
  { id: 'tiga', label: 'Tiga Dimensi', hint: 'σz, tiga lingkaran Mohr, geser maks mutlak' },
]

export const KEYS: Record<Setup, (keyof Params)[]> = {
  tegangan: ['sx', 'sy', 'txy', 'th'],
  regangan: ['sx', 'sy', 'txy', 'th', 'E', 'nu', 'k'],
  tiga: ['sx', 'sy', 'txy', 'sz'],
}

const BASE: Params = { sx: 80, sy: -40, txy: 30, sz: 0, th: 0, E: 200, nu: 0.3, k: 200 }

export function defaults(s: Setup): Params {
  switch (s) {
    case 'tegangan':
      return { ...BASE }
    case 'regangan':
      return { ...BASE, sx: 120, sy: 0, txy: 0 }
    case 'tiga':
      return { ...BASE, sx: 40, sy: 80, txy: 0, sz: 0 }
  }
}

export interface Range {
  min: number
  max: number
  step: number
}

export const RANGES: Record<keyof Params, Range> = {
  sx: { min: -200, max: 200, step: 1 },
  sy: { min: -200, max: 200, step: 1 },
  txy: { min: -150, max: 150, step: 1 },
  sz: { min: -200, max: 200, step: 1 },
  th: { min: -90, max: 90, step: 0.5 },
  E: { min: 1, max: 250, step: 1 },
  nu: { min: 0, max: 0.5, step: 0.01 },
  k: { min: 10, max: 2000, step: 10 },
}

/** Sudut ke (−90, 90]: elemen yang diputar 180° identik. */
export function wrapTheta(d: number) {
  let x = ((d + 90) % 180 + 180) % 180 - 90
  if (x <= -90) x += 180
  return x
}

export function clampParams(p: Params): Params {
  const out = { ...p }
  for (const k of Object.keys(RANGES) as (keyof Params)[]) {
    const r = RANGES[k]
    if (k === 'th') out.th = wrapTheta(out.th)
    else out[k] = Math.min(r.max, Math.max(r.min, out[k]))
  }
  return out
}

export const stressOf = (p: Params): Stress => ({ sx: p.sx, sy: p.sy, txy: p.txy })

export function parseQuery(q: string): { setup: Setup; params: Params } {
  const sp = new URLSearchParams(q)
  const raw = sp.get('setup') as Setup | null
  const setup: Setup = raw && SETUPS.some((x) => x.id === raw) ? raw : 'tegangan'
  const p = defaults(setup)
  for (const key of KEYS[setup]) {
    const v = Number(sp.get(key))
    if (sp.has(key) && Number.isFinite(v)) p[key] = v
  }
  return { setup, params: clampParams(p) }
}

export function toQuery(setup: Setup, p: Params): string {
  const sp = new URLSearchParams({ setup })
  for (const key of KEYS[setup]) sp.set(key, String(Math.round(p[key] * 1e4) / 1e4))
  return sp.toString()
}
