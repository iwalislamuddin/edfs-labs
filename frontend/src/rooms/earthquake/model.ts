// Model Room Earthquake: setup + parameter (tersimpan di URL).
import { MOTIONS, type MotionKind } from '../../lab/ground'

export type Setup = 'spektrum' | 'isolasi'

export interface Params {
  rec: MotionKind
  pga: number // g
  seed: number
  T: number // periode struktur (s)
  z: number // redaman struktur
  SDS: number // g
  SD1: number // g
  Tiso: number // s
  zi: number // redaman isolator
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'spektrum', label: 'Spektrum Respons', hint: 'SDOF di atas tanah bergempa — bangun spektrum titik demi titik' },
  { id: 'isolasi', label: 'Isolasi Dasar', hint: 'bandingkan gedung terjepit dan gedung di atas isolator' },
]

export interface Range {
  min: number
  max: number
  step: number
}

export const RANGES: Record<Exclude<keyof Params, 'rec'>, Range> = {
  pga: { min: 0.05, max: 1, step: 0.01 },
  seed: { min: 1, max: 999, step: 1 },
  T: { min: 0.05, max: 4, step: 0.01 },
  z: { min: 0, max: 0.2, step: 0.005 },
  SDS: { min: 0.1, max: 1.5, step: 0.01 },
  SD1: { min: 0.05, max: 1, step: 0.01 },
  Tiso: { min: 1, max: 4, step: 0.05 },
  zi: { min: 0.05, max: 0.3, step: 0.01 },
}

export const defaults = (): Params => ({ rec: 'keras', pga: 0.3, seed: 1, T: 0.5, z: 0.05, SDS: 0.8, SD1: 0.5, Tiso: 2.5, zi: 0.15 })

/** Massa struktur untuk konversi gaya (ton) dan tinggi tingkat (m). */
export const MASS_T = 100
export const STORY_H = 3.5
/** Waktu tambahan setelah rekaman habis (getaran bebas), s. */
export const TAIL = 4

export function parseQuery(q: string): { setup: Setup; params: Params } {
  const sp = new URLSearchParams(q)
  const raw = sp.get('setup') as Setup | null
  const setup: Setup = raw && SETUPS.some((x) => x.id === raw) ? raw : 'spektrum'
  const d = defaults()
  const rec = (sp.get('rec') as MotionKind | null) ?? d.rec
  const num = (key: Exclude<keyof Params, 'rec'>) => {
    const v = Number(sp.get(key))
    if (!sp.has(key) || !Number.isFinite(v)) return d[key]
    return Math.min(RANGES[key].max, Math.max(RANGES[key].min, v))
  }
  return {
    setup,
    params: {
      rec: MOTIONS.some((m) => m.id === rec) ? rec : d.rec,
      pga: num('pga'),
      seed: Math.round(num('seed')),
      T: num('T'),
      z: num('z'),
      SDS: num('SDS'),
      SD1: num('SD1'),
      Tiso: num('Tiso'),
      zi: num('zi'),
    },
  }
}

export function toQuery(setup: Setup, p: Params): string {
  const sp = new URLSearchParams({ setup, rec: p.rec, pga: String(p.pga), seed: String(p.seed), T: String(p.T), z: String(p.z) })
  sp.set('SDS', String(p.SDS))
  sp.set('SD1', String(p.SD1))
  if (setup === 'isolasi') {
    sp.set('Tiso', String(p.Tiso))
    sp.set('zi', String(p.zi))
  }
  return sp.toString()
}
