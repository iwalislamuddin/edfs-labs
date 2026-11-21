// Model Room Section: bentuk penampang, dimensi (mm), beban, rentang slider, query URL.
import { props, type Part } from './section'

export type Setup = 'properti' | 'lentur' | 'geser'
export type Shape = 'persegi' | 'kotak' | 'wf' | 'tee' | 'kanal' | 'siku' | 'zee' | 'pipa'

/**
 * Dimensi (mm): b lebar (sayap), h tinggi, tf tebal sayap, tw tebal badan, t tebal dinding/kaki, D diameter.
 * th sudut sumbu u (°) · fy tegangan leleh (MPa) · N gaya aksial (kN, tarik +) · Mx, My momen (kN·m)
 * V gaya lintang vertikal (kN) · cut posisi potongan geser (0 = bawah, 1 = atas) · kern tampilkan inti (0/1)
 */
export interface Params {
  b: number
  h: number
  tf: number
  tw: number
  t: number
  D: number
  th: number
  fy: number
  N: number
  Mx: number
  My: number
  V: number
  cut: number
  kern: number
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'properti', label: 'Properti', hint: 'titik berat, momen inersia, Steiner, sumbu utama, modulus plastis' },
  { id: 'lentur', label: 'Tegangan Normal', hint: 'aksial + lentur dua arah, garis netral, inti penampang' },
  { id: 'geser', label: 'Tegangan Geser', hint: 'τ = VQ/(Ib), aliran geser, sayap vs badan' },
]

export const SHAPES: { id: Shape; label: string; dims: (keyof Params)[] }[] = [
  { id: 'persegi', label: 'Persegi', dims: ['b', 'h'] },
  { id: 'kotak', label: 'Kotak', dims: ['b', 'h', 't'] },
  { id: 'wf', label: 'I / WF', dims: ['b', 'h', 'tf', 'tw'] },
  { id: 'tee', label: 'T', dims: ['b', 'h', 'tf', 'tw'] },
  { id: 'kanal', label: 'Kanal C', dims: ['b', 'h', 'tf', 'tw'] },
  { id: 'siku', label: 'Siku L', dims: ['b', 'h', 't'] },
  { id: 'zee', label: 'Z', dims: ['b', 'h', 'tf', 'tw'] },
  { id: 'pipa', label: 'Pipa / bulat', dims: ['D', 't'] },
]

const DIMS: Record<Shape, Partial<Params>> = {
  persegi: { b: 300, h: 500 },
  kotak: { b: 200, h: 300, t: 12 },
  wf: { b: 200, h: 400, tf: 13, tw: 8 },
  tee: { b: 250, h: 300, tf: 20, tw: 12 },
  kanal: { b: 90, h: 300, tf: 14, tw: 9 },
  siku: { b: 100, h: 150, t: 12 },
  zee: { b: 80, h: 250, tf: 12, tw: 8 },
  pipa: { D: 300, t: 10 },
}

const BASE: Params = { b: 200, h: 400, tf: 13, tw: 8, t: 12, D: 300, th: 0, fy: 250, N: 0, Mx: 0, My: 0, V: 0, cut: 0.5, kern: 1 }


export const KEYS: Record<Setup, (keyof Params)[]> = {
  properti: ['th', 'fy'],
  lentur: ['N', 'Mx', 'My', 'kern', 'fy'],
  geser: ['V', 'cut'],
}

export function defaults(setup: Setup, shape: Shape): Params {
  return withLoads(setup, shape, { ...BASE, ...DIMS[shape] })
}

/** Dua angka penting (mis. 1234 → 1200) supaya beban bawaan enak dibaca. */
const nice = (v: number) => {
  if (v <= 0) return 0
  const p = 10 ** (Math.floor(Math.log10(v)) - 1)
  return Math.round(v / p) * p
}

/**
 * Skala beban sesuai ukuran penampang: N ≈ 0,3·fy·A, M ≈ 0,4·fy·S, V ≈ 0,15·fy·A — tegangan yang dihasilkan
 * selalu dalam orde fy, berapa pun bentuk dan dimensinya.
 */
export function loadScale(shape: Shape, p: Params) {
  const pr = props(buildParts(shape, p))
  const S = Math.min(pr.Sxt, pr.Sxb)
  return { N: nice((0.3 * p.fy * pr.A) / 1e3), M: nice((0.4 * p.fy * S) / 1e6), V: nice((0.15 * p.fy * pr.A) / 1e3) }
}

export function withLoads(setup: Setup, shape: Shape, p: Params): Params {
  const s = loadScale(shape, p)
  const o = { ...p, N: 0, Mx: 0, My: 0, V: 0 }
  if (setup === 'lentur') {
    o.N = -s.N
    o.Mx = s.M
  }
  if (setup === 'geser') o.V = s.V
  return o
}

export interface Range {
  min: number
  max: number
  step: number
}

export const RANGES: Record<keyof Params, Range> = {
  b: { min: 20, max: 1000, step: 1 },
  h: { min: 20, max: 1000, step: 1 },
  tf: { min: 2, max: 100, step: 0.5 },
  tw: { min: 2, max: 100, step: 0.5 },
  t: { min: 2, max: 150, step: 0.5 },
  D: { min: 20, max: 1000, step: 1 },
  th: { min: -90, max: 90, step: 0.5 },
  fy: { min: 100, max: 600, step: 5 },
  N: { min: -20000, max: 20000, step: 5 },
  Mx: { min: -2000, max: 2000, step: 0.5 },
  My: { min: -2000, max: 2000, step: 0.5 },
  V: { min: -5000, max: 5000, step: 1 },
  cut: { min: 0, max: 1, step: 0.005 },
  kern: { min: 0, max: 1, step: 1 },
}

export const DIM_LABEL: Partial<Record<keyof Params, [string, string]>> = {
  b: ['Lebar (sayap)', 'b'],
  h: ['Tinggi', 'h'],
  tf: ['Tebal sayap', 'tf'],
  tw: ['Tebal badan', 'tw'],
  t: ['Tebal dinding / kaki', 't'],
  D: ['Diameter luar', 'D'],
}

const clamp = (v: number, r: Range) => Math.min(r.max, Math.max(r.min, v))

/** Rentang aman dimensi + batas geometri (tebal tidak melebihi bentuk). */
export function clampParams(shape: Shape, p: Params): Params {
  const o = { ...p }
  for (const k of Object.keys(RANGES) as (keyof Params)[]) o[k] = clamp(o[k], RANGES[k])
  o.th = clamp(o.th, RANGES.th)
  o.kern = o.kern ? 1 : 0
  switch (shape) {
    case 'kotak':
      o.t = Math.min(o.t, Math.min(o.b, o.h) / 2 - 1)
      break
    case 'wf':
    case 'kanal':
    case 'zee':
      o.tf = Math.min(o.tf, o.h / 2 - 1)
      o.tw = Math.min(o.tw, shape === 'wf' ? o.b : o.b - 1)
      break
    case 'tee':
      o.tf = Math.min(o.tf, o.h - 1)
      o.tw = Math.min(o.tw, o.b)
      break
    case 'siku':
      o.t = Math.min(o.t, Math.min(o.b, o.h) - 1)
      break
    case 'pipa':
      o.t = Math.min(o.t, o.D / 2)
      break
  }
  return o
}

const rect = (name: string, x0: number, y0: number, x1: number, y1: number, sign: 1 | -1 = 1): Part => ({
  kind: 'rect',
  name,
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  w: x1 - x0,
  h: y1 - y0,
  sign,
})

/** Bagian penampang, titik acuan (0, 0) di pojok kiri bawah kotak pembatas. */
export function buildParts(shape: Shape, p: Params): Part[] {
  const { b, h, tf, tw, t, D } = p
  switch (shape) {
    case 'persegi':
      return [rect('Persegi', 0, 0, b, h)]
    case 'kotak':
      return [rect('Kotak luar', 0, 0, b, h), rect('Rongga', t, t, b - t, h - t, -1)]
    case 'wf':
      return [
        rect('Sayap atas', 0, h - tf, b, h),
        rect('Badan', (b - tw) / 2, tf, (b + tw) / 2, h - tf),
        rect('Sayap bawah', 0, 0, b, tf),
      ]
    case 'tee':
      return [rect('Sayap', 0, h - tf, b, h), rect('Badan', (b - tw) / 2, 0, (b + tw) / 2, h - tf)]
    case 'kanal':
      return [rect('Sayap atas', tw, h - tf, b, h), rect('Badan', 0, 0, tw, h), rect('Sayap bawah', tw, 0, b, tf)]
    case 'siku':
      return [rect('Kaki tegak', 0, 0, t, h), rect('Kaki datar', t, 0, b, t)]
    case 'zee':
      return [
        rect('Sayap atas', b, h - tf, 2 * b - tw, h),
        rect('Badan', b - tw, 0, b, h),
        rect('Sayap bawah', 0, 0, b - tw, tf),
      ]
    case 'pipa': {
      const R = D / 2
      const out: Part[] = [{ kind: 'circ', name: 'Lingkaran luar', x: R, y: R, r: R, sign: 1 }]
      if (t < R - 1e-9) out.push({ kind: 'circ', name: 'Rongga', x: R, y: R, r: R - t, sign: -1 })
      return out
    }
  }
}

export function parseQuery(q: string): { setup: Setup; shape: Shape; params: Params } {
  const sp = new URLSearchParams(q)
  const rs = sp.get('setup') as Setup | null
  const setup: Setup = rs && SETUPS.some((x) => x.id === rs) ? rs : 'properti'
  const rsh = sp.get('shape') as Shape | null
  const shape: Shape = rsh && SHAPES.some((x) => x.id === rsh) ? rsh : 'wf'
  const p = defaults(setup, shape)
  const keys = [...SHAPES.find((x) => x.id === shape)!.dims, ...KEYS[setup]]
  for (const key of keys) {
    const v = Number(sp.get(key))
    if (sp.has(key) && Number.isFinite(v)) p[key] = v
  }
  return { setup, shape, params: clampParams(shape, p) }
}

export function toQuery(setup: Setup, shape: Shape, p: Params): string {
  const sp = new URLSearchParams({ setup, shape })
  for (const key of [...SHAPES.find((x) => x.id === shape)!.dims, ...KEYS[setup]]) sp.set(key, String(Math.round(p[key] * 1e4) / 1e4))
  return sp.toString()
}
