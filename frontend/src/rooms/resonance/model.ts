// Model Room Resonance: setup + parameter → sistem SDOF dengan eksitasi harmonik.
import { phase, phaseTR, Rd, TR, type Excite, type Forced } from './physics'

export type Setup = 'gaya' | 'dasar'

export interface Params {
  m: number // kg
  k: number // N/m
  z: number // rasio redaman ζ
  f: number // frekuensi eksitasi (Hz)
  p0: number // amplitudo gaya (N) — setup gaya
  ug: number // amplitudo gerak tanah (m) — setup dasar
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'gaya', label: 'Gaya Harmonik', hint: 'gaya p₀·sin ωt bekerja langsung pada massa (mesin, angin berkala)' },
  { id: 'dasar', label: 'Eksitasi Dasar', hint: 'tanah/meja getar bergerak ug₀·sin ωt (gempa, lalu lintas)' },
]

export const excite = (s: Setup): Excite => (s === 'gaya' ? 'force' : 'base')

export interface Range {
  min: number
  max: number
  step: number
}

export const RANGES: Record<keyof Params, Range> = {
  m: { min: 0.5, max: 20, step: 0.1 },
  k: { min: 10, max: 500, step: 1 },
  z: { min: 0, max: 1, step: 0.005 },
  f: { min: 0.02, max: 6, step: 0.01 },
  p0: { min: 0.1, max: 20, step: 0.1 },
  ug: { min: 0.002, max: 0.05, step: 0.001 },
}

export const defaults = (): Params => ({ m: 2, k: 80, z: 0.05, f: 0.8, p0: 2, ug: 0.02 })

export const wnOf = (p: Params) => Math.sqrt(p.k / p.m)
export const cOf = (p: Params) => 2 * p.z * Math.sqrt(p.k * p.m)

/** Sistem SDOF yang diintegrasikan (u relatif terhadap tanah). */
export function toForced(s: Setup, p: Params): Forced {
  const w = 2 * Math.PI * p.f
  return { m: p.m, k: p.k, c: cOf(p), w, p0: s === 'gaya' ? p.p0 : p.m * w * w * p.ug }
}

export interface Theory {
  wn: number
  fn: number
  beta: number
  w: number
  /** Besaran acuan: ust = p0/k (gaya) atau ug0 (dasar), m. */
  ref: number
  /** Rasio amplitudo tunak: Rd (gaya) atau TR (dasar). */
  ratio: number
  /** Amplitudo tunak besaran yang digambar: u0 (gaya) atau x0 total (dasar), m. */
  amp: number
  /** Fase tertinggal terhadap eksitasi (rad). */
  phi: number
  c: number
  /** Amplitudo simpangan relatif u0 = ug0·β²·Rd (dasar) — regangan pegas. */
  uRel: number
}

export function theory(s: Setup, p: Params): Theory {
  const wn = wnOf(p)
  const w = 2 * Math.PI * p.f
  const beta = w / wn
  const ref = s === 'gaya' ? p.p0 / p.k : p.ug
  const ratio = s === 'gaya' ? Rd(beta, p.z) : TR(beta, p.z)
  return {
    wn,
    fn: wn / (2 * Math.PI),
    beta,
    w,
    ref,
    ratio,
    amp: ref * ratio,
    phi: s === 'gaya' ? phase(beta, p.z) : phaseTR(beta, p.z),
    c: cOf(p),
    uRel: s === 'gaya' ? ref * ratio : p.ug * beta * beta * Rd(beta, p.z),
  }
}

// ---- URL (bagikan eksperimen) ----

export function parseQuery(q: string): { setup: Setup; params: Params } {
  const sp = new URLSearchParams(q)
  const raw = sp.get('setup') as Setup | null
  const setup: Setup = raw && SETUPS.some((x) => x.id === raw) ? raw : 'gaya'
  const d = defaults()
  const num = (key: keyof Params, scale = 1) => {
    const v = Number(sp.get(key)) * scale
    if (!sp.has(key) || !Number.isFinite(v)) return d[key]
    return Math.min(RANGES[key].max, Math.max(RANGES[key].min, v))
  }
  return { setup, params: { m: num('m'), k: num('k'), z: num('z'), f: num('f'), p0: num('p0'), ug: num('ug', 0.01) } }
}

export function toQuery(setup: Setup, p: Params): string {
  const sp = new URLSearchParams({ setup, m: String(p.m), k: String(p.k), z: String(p.z), f: String(p.f) })
  if (setup === 'gaya') sp.set('p0', String(p.p0))
  else sp.set('ug', String(Number((p.ug * 100).toFixed(2)))) // cm
  return sp.toString()
}
