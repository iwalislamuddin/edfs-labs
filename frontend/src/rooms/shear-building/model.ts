// Model Room Shear Building: parameter → massa & kekakuan tiap lantai.
import { modes, type Modes } from '../../lab/mdof'

export type Setup = 'bebas' | 'tanah'

export interface Params {
  N: number // jumlah lantai (2–5)
  m: number // massa per lantai (ton)
  k: number // kekakuan tingkat (kN/m)
  a1: number // faktor kekakuan tingkat dasar k1/k (lantai lunak bila < 1)
  mr: number // faktor massa atap m_atap/m
  z: number // rasio redaman modal ζ (sama untuk semua mode)
  f: number // frekuensi gerak tanah (Hz) — setup tanah
  ug: number // amplitudo gerak tanah (m) — setup tanah
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'bebas', label: 'Getaran Bebas', hint: 'tarik satu lantai lalu lepas, atau getarkan satu mode' },
  { id: 'tanah', label: 'Gerak Tanah Harmonik', hint: 'tanah bergoyang ug₀·sin ωt — resonansi di setiap mode' },
]

export interface Range {
  min: number
  max: number
  step: number
}

export const RANGES: Record<keyof Params, Range> = {
  N: { min: 2, max: 5, step: 1 },
  m: { min: 10, max: 300, step: 5 },
  k: { min: 5000, max: 200000, step: 1000 },
  a1: { min: 0.2, max: 2, step: 0.05 },
  mr: { min: 0.25, max: 1.5, step: 0.05 },
  z: { min: 0, max: 0.2, step: 0.005 },
  f: { min: 0.05, max: 20, step: 0.01 },
  ug: { min: 0.001, max: 0.05, step: 0.001 },
}

export const defaults = (): Params => ({ N: 3, m: 100, k: 40000, a1: 1, mr: 1, z: 0.02, f: 1.2, ug: 0.01 })

/** Tinggi tingkat untuk gambar (m). */
export const STORY_H = 3.5

export function masses(p: Params): number[] {
  return Array.from({ length: p.N }, (_, i) => p.m * 1000 * (i === p.N - 1 ? p.mr : 1))
}

export function stiffnesses(p: Params): number[] {
  return Array.from({ length: p.N }, (_, i) => p.k * 1000 * (i === 0 ? p.a1 : 1))
}

export const modesOf = (p: Params): Modes => modes(masses(p), stiffnesses(p))

// ---- URL ----

export function parseQuery(q: string): { setup: Setup; params: Params } {
  const sp = new URLSearchParams(q)
  const raw = sp.get('setup') as Setup | null
  const setup: Setup = raw && SETUPS.some((x) => x.id === raw) ? raw : 'bebas'
  const d = defaults()
  const num = (key: keyof Params, scale = 1) => {
    const v = Number(sp.get(key)) * scale
    if (!sp.has(key) || !Number.isFinite(v)) return d[key]
    const r = RANGES[key]
    return Math.min(r.max, Math.max(r.min, v))
  }
  const params: Params = {
    N: Math.round(num('N')),
    m: num('m'),
    k: num('k'),
    a1: num('a1'),
    mr: num('mr'),
    z: num('z'),
    f: num('f'),
    ug: num('ug', 0.01),
  }
  return { setup, params }
}

export function toQuery(setup: Setup, p: Params): string {
  const sp = new URLSearchParams({ setup, N: String(p.N), m: String(p.m), k: String(p.k), z: String(p.z) })
  if (p.a1 !== 1) sp.set('a1', String(p.a1))
  if (p.mr !== 1) sp.set('mr', String(p.mr))
  if (setup === 'tanah') {
    sp.set('f', String(p.f))
    sp.set('ug', String(Number((p.ug * 100).toFixed(2))))
  }
  return sp.toString()
}
