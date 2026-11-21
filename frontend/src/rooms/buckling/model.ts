// Model Room Buckling: setup, tumpuan, penampang (dipinjam dari Room Section), parameter, rentang, query URL.
import { buildParts, clampParams as clampSec, defaults as secDefaults, DIM_LABEL, type Params as SecParams, type Shape } from '../section/model'
import { hull, props, type Part, type Props } from '../section/section'
import { quarters, SUPPORTS, type Support } from './buckling'

export type Setup = 'euler' | 'imperfeksi' | 'kurva' | 'elastica'
export type Axis = 'min' | 'x' | 'y'
export { DIM_LABEL, type SecParams, type Shape }

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'euler', label: 'Euler', hint: 'beban kritis, panjang efektif, mode tekuk 1–3' },
  { id: 'imperfeksi', label: 'Imperfeksi', hint: 'lengkung awal & eksentrisitas, uji tekan, plot Southwell' },
  { id: 'kurva', label: 'Kurva Kolom', hint: 'Euler vs SNI 1729 vs Perry–Robertson, tekuk inelastis' },
  { id: 'elastica', label: 'Elastica', hint: 'pasca-tekuk lendutan besar (integral eliptik)' },
]

export const SHAPES: { id: Shape; label: string }[] = [
  { id: 'wf', label: 'I / WF' },
  { id: 'kotak', label: 'Kotak' },
  { id: 'pipa', label: 'Pipa / bulat' },
  { id: 'persegi', label: 'Persegi' },
  { id: 'siku', label: 'Siku L' },
  { id: 'kanal', label: 'Kanal C' },
]
export const SHAPE_DIMS: Record<string, (keyof SecParams)[]> = {
  persegi: ['b', 'h'],
  kotak: ['b', 'h', 't'],
  wf: ['b', 'h', 'tf', 'tw'],
  kanal: ['b', 'h', 'tf', 'tw'],
  siku: ['b', 'h', 't'],
  pipa: ['D', 't'],
}

const DIMS: Record<string, Partial<SecParams>> = {
  wf: { b: 100, h: 200, tf: 8, tw: 5.5 }, // WF 200·100·5,5·8
  kotak: { b: 100, h: 100, t: 4 },
  pipa: { D: 114.3, t: 4.5 },
  persegi: { b: 40, h: 80 },
  siku: { b: 70, h: 70, t: 7 },
  kanal: { b: 50, h: 100, tf: 7.5, tw: 5 },
}

export const AXES: { id: Axis; label: string; title: string }[] = [
  { id: 'min', label: 'Terlemah', title: 'sumbu utama dengan I minimum (yang menentukan)' },
  { id: 'x', label: 'Sumbu x', title: 'tekuk ke arah y (lentur terhadap sumbu x)' },
  { id: 'y', label: 'Sumbu y', title: 'tekuk ke arah x (lentur terhadap sumbu y)' },
]

/**
 * L panjang (m) · E modulus (GPa) · fy (MPa) · P beban tekan (kN) · n nomor mode (1–3)
 * e0 lengkung awal di titik maks (mm) · e eksentrisitas beban (mm) · r = P/Pcr (Elastica) · kr pakai K rekomendasi (0/1)
 */
export interface Params {
  L: number
  E: number
  fy: number
  P: number
  n: number
  e0: number
  e: number
  r: number
  kr: number
}

export const KEYS: Record<Setup, (keyof Params)[]> = {
  euler: ['L', 'E', 'fy', 'P', 'n'],
  imperfeksi: ['L', 'E', 'fy', 'P', 'e0', 'e'],
  kurva: ['L', 'E', 'fy', 'kr'],
  elastica: ['L', 'E', 'r'],
}

export const BASE: Params = { L: 3, E: 200, fy: 250, P: 150, n: 1, e0: 3, e: 0, r: 1.2, kr: 0 }

export interface Range {
  min: number
  max: number
  step: number
}
export const RANGES: Record<keyof Params, Range> = {
  L: { min: 0.3, max: 12, step: 0.05 },
  E: { min: 5, max: 250, step: 1 },
  fy: { min: 100, max: 600, step: 5 },
  P: { min: 0, max: 1e6, step: 0.5 },
  n: { min: 1, max: 3, step: 1 },
  e0: { min: 0, max: 50, step: 0.1 },
  e: { min: 0, max: 100, step: 0.5 },
  r: { min: 0, max: 3.5, step: 0.005 },
  kr: { min: 0, max: 1, step: 1 },
}

export const MATERIALS = [
  { label: 'Baja', E: 200, fy: 250 },
  { label: 'Aluminium', E: 70, fy: 240 },
  { label: 'Kayu', E: 10, fy: 40 },
]

/** Tumpuan yang tersedia per setup (Elastica hanya yang tersusun dari seperempat gelombang). */
export const supportsFor = (s: Setup) => SUPPORTS.filter((x) => s !== 'elastica' || quarters(x.id) > 0)

const clamp = (v: number, r: Range) => Math.min(r.max, Math.max(r.min, v))
export function clampParams(p: Params): Params {
  const o = { ...p }
  for (const k of Object.keys(RANGES) as (keyof Params)[]) o[k] = clamp(o[k], RANGES[k])
  o.n = Math.round(o.n)
  o.kr = o.kr ? 1 : 0
  return o
}

export function secDefault(shape: Shape): SecParams {
  return { ...secDefaults('properti', shape), ...DIMS[shape] }
}

// ---- properti kolom terhadap sumbu tekuk ----

export interface Column {
  parts: Part[]
  pr: Props
  A: number // mm²
  I: number // mm⁴ (sumbu tekuk)
  r: number // mm
  c: number // jarak serat terjauh dari sumbu (mm)
  S: number // I/c (mm³)
  /** arah sumbu lentur (derajat dari sumbu x); lendutan tegak lurus sumbu ini */
  angle: number
  Imin: number
  rmin: number
}

export function column(shape: Shape, sp: SecParams, ax: Axis): Column {
  const parts = buildParts(shape, sp)
  const pr = props(parts)
  const angle = ax === 'x' ? 0 : ax === 'y' ? 90 : pr.thP + 90
  const I = ax === 'x' ? pr.Ix : ax === 'y' ? pr.Iy : pr.I2
  const ph = (angle * Math.PI) / 180
  let c = 0
  const pts = parts.some((q) => q.kind === 'circ') ? circPts(parts) : hull(parts)
  for (const [x, y] of pts) c = Math.max(c, Math.abs(-(x - pr.xc) * Math.sin(ph) + (y - pr.yc) * Math.cos(ph)))
  return { parts, pr, A: pr.A, I, r: Math.sqrt(I / pr.A), c, S: I / c, angle, Imin: pr.I2, rmin: Math.sqrt(pr.I2 / pr.A) }
}

function circPts(parts: Part[]): [number, number][] {
  const out: [number, number][] = []
  for (const q of parts) {
    if (q.kind !== 'circ' || q.sign < 0) continue
    for (let i = 0; i < 72; i++) out.push([q.x + q.r * Math.cos((i * Math.PI) / 36), q.y + q.r * Math.sin((i * Math.PI) / 36)])
  }
  return out
}

// ---- URL ----

export interface State {
  setup: Setup
  sup: Support
  shape: Shape
  ax: Axis
  sec: SecParams
  p: Params
}

export function fixSupport(setup: Setup, sup: Support): Support {
  return supportsFor(setup).some((x) => x.id === sup) ? sup : 'sendi'
}

export function parseQuery(q: string): State {
  const sp = new URLSearchParams(q)
  const rs = sp.get('setup') as Setup | null
  const setup: Setup = rs && SETUPS.some((x) => x.id === rs) ? rs : 'euler'
  const rsup = sp.get('sup') as Support | null
  const sup = fixSupport(setup, rsup && SUPPORTS.some((x) => x.id === rsup) ? rsup : 'sendi')
  const rsh = sp.get('shape') as Shape | null
  const shape: Shape = rsh && SHAPES.some((x) => x.id === rsh) ? rsh : 'wf'
  const rax = sp.get('ax') as Axis | null
  const ax: Axis = rax && AXES.some((x) => x.id === rax) ? rax : 'min'
  const sec = secDefault(shape)
  for (const k of SHAPE_DIMS[shape]) {
    const v = Number(sp.get(k))
    if (sp.has(k) && Number.isFinite(v)) sec[k] = v
  }
  const p = { ...BASE }
  for (const k of KEYS[setup]) {
    const v = Number(sp.get(k))
    if (sp.has(k) && Number.isFinite(v)) p[k] = v
  }
  return { setup, sup, shape, ax, sec: clampSec(shape, sec), p: clampParams(p) }
}

export function toQuery(s: State): string {
  const q = new URLSearchParams({ setup: s.setup, sup: s.sup, shape: s.shape })
  if (s.setup !== 'elastica') q.set('ax', s.ax)
  for (const k of SHAPE_DIMS[s.shape]) q.set(k, String(Math.round(s.sec[k] * 1e3) / 1e3))
  for (const k of KEYS[s.setup]) q.set(k, String(Math.round(s.p[k] * 1e4) / 1e4))
  return q.toString()
}

export { clampSec }
