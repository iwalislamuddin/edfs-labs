// Model Room Pendulum: setup + parameter → sistem fisika, rentang slider, query URL.
import { pend1Modal, rodSystem, simpleSystem, type Pend1, type Pend2 } from './physics'

export type Setup = 'sederhana' | 'ganda' | 'fisik'

/**
 * Satu objek parameter untuk semua setup; tiap setup hanya memakai sebagian kunci (lihat KEYS).
 * sederhana: L, m, c, a, g · ganda: L (=L₁), L2, m (=m₁), m2, a (=θ₁₀), a2 (=θ₂₀), c, g · fisik: L (batang), d, m, c, a, g
 */
export interface Params {
  L: number // m
  L2: number // m
  m: number // kg
  m2: number // kg
  c: number // N·m·s/rad (peredam rotasi di sendi)
  a: number // derajat, sudut awal
  a2: number // derajat
  d: number // m, jarak sendi ke titik berat (bandul fisik)
  g: number // m/s²
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'sederhana', label: 'Bandul Sederhana', hint: 'massa titik pada tali ringan' },
  { id: 'ganda', label: 'Bandul Ganda', hint: 'dua massa bersambung — gerak kacau (chaos)' },
  { id: 'fisik', label: 'Bandul Fisik', hint: 'batang kaku berayun pada sendi' },
]

export const KEYS: Record<Setup, (keyof Params)[]> = {
  sederhana: ['L', 'm', 'c', 'a', 'g'],
  ganda: ['L', 'L2', 'm', 'm2', 'a', 'a2', 'c', 'g'],
  fisik: ['L', 'd', 'm', 'c', 'a', 'g'],
}

const BASE: Params = { L: 1, L2: 1, m: 1, m2: 1, c: 0, a: 20, a2: 0, d: 0.3, g: 9.81 }

export function defaults(s: Setup): Params {
  switch (s) {
    case 'sederhana':
      return { ...BASE }
    case 'ganda':
      return { ...BASE, a: 110, a2: 150 }
    case 'fisik':
      return { ...BASE, L: 1, d: 0.3 }
  }
}

export interface Range {
  min: number
  max: number
  step: number
}

export function ranges(s: Setup, p: Params): Record<keyof Params, Range> {
  let cMax = 2
  let cStep = 0.005
  if (s !== 'ganda') {
    const cc = pend1Modal(toPend1(s, p)).cCrit
    cMax = Math.max(1, Math.ceil(cc * 1.5))
    cStep = cMax > 20 ? 0.1 : 0.01
  }
  return {
    L: { min: s === 'fisik' ? 0.2 : 0.1, max: 3, step: 0.01 },
    L2: { min: 0.1, max: 3, step: 0.01 },
    m: { min: 0.1, max: 10, step: 0.1 },
    m2: { min: 0.1, max: 10, step: 0.1 },
    c: { min: 0, max: cMax, step: cStep },
    a: { min: -179, max: 179, step: 0.1 },
    a2: { min: -179, max: 179, step: 0.1 },
    d: { min: 0.01, max: Math.round((p.L / 2) * 1000) / 1000, step: 0.005 },
    g: { min: 0, max: 25, step: 0.01 },
  }
}

export const is1dof = (s: Setup) => s !== 'ganda'

export function toPend1(s: Setup, p: Params): Pend1 {
  return s === 'fisik' ? rodSystem(p.m, p.L, Math.min(p.d, p.L / 2), p.g, p.c) : simpleSystem(p.m, p.L, p.g, p.c)
}

export const toPend2 = (p: Params): Pend2 => ({ m1: p.m, m2: p.m2, L1: p.L, L2: p.L2, g: p.g, c: p.c })

export const DEG = Math.PI / 180

/** Keadaan awal (dilepas diam) dari sudut awal. */
export const initialState = (s: Setup, p: Params) => (s === 'ganda' ? [p.a * DEG, p.a2 * DEG, 0, 0] : [p.a * DEG, 0])

/** Jangkauan maksimum dari sendi (m) — untuk skala panggung. */
export const reach = (s: Setup, p: Params) => (s === 'ganda' ? p.L + p.L2 : s === 'fisik' ? p.L / 2 + p.d : p.L)

// ---- URL (bagikan eksperimen) ----

export function parseQuery(q: string): { setup: Setup; params: Params } {
  const sp = new URLSearchParams(q)
  const raw = sp.get('setup') as Setup | null
  const setup: Setup = raw && SETUPS.some((x) => x.id === raw) ? raw : 'sederhana'
  const p = defaults(setup)
  for (const key of KEYS[setup]) {
    const v = Number(sp.get(key))
    if (sp.has(key) && Number.isFinite(v)) p[key] = v
  }
  // jepit ke rentang (d bergantung L, c bergantung sistem → L dulu)
  const clamp = (key: keyof Params) => {
    const r = ranges(setup, p)[key]
    p[key] = Math.min(r.max, Math.max(r.min, p[key]))
  }
  for (const key of ['L', 'L2', 'm', 'm2', 'd', 'g', 'a', 'a2', 'c'] as const) clamp(key)
  return { setup, params: p }
}

export function toQuery(setup: Setup, p: Params): string {
  const sp = new URLSearchParams({ setup })
  for (const key of KEYS[setup]) {
    if (key === 'g' && p.g === 9.81) continue
    sp.set(key, String(p[key]))
  }
  return sp.toString()
}
