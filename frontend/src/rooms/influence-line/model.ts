// Model Room Influence Line: setup + parameter → geometri jalur beban, struktur (Frame) untuk solver kekakuan,
// daftar fungsi respons, beban kendaraan, query URL. Satuan kN, m. Beban berjalan selalu ke bawah.
import { analyze, type Frame, type FMember, type FPointLoad, type FSupport } from '../../lab/frame2d'
import { build as buildStructure, defaults as structDefaults, TRUSS_TYPES } from '../structure/model'

export type Setup = 'sederhana' | 'menerus' | 'truss'
export type Vehicle = 'satuan' | 'truk' | 'lajur'

/**
 * L bentang (menerus: bentang 1; rangka: panjang total) · L2, L3 bentang 2 dan 3 · nb jumlah bentang (2|3)
 * c1, c2 panjang kantilever kiri/kanan (balok sederhana) · xs posisi potongan V/M dari ujung kiri
 * n jumlah panel · tp tipe rangka (0 Pratt, 1 Howe, 2 Warren) · h tinggi rangka · mem batang rangka yang diamati
 * g jarak gandar belakang truk (4–9 m) · q beban merata lajur · pk beban garis lajur
 */
export interface Params {
  L: number
  L2: number
  L3: number
  nb: number
  c1: number
  c2: number
  xs: number
  n: number
  tp: number
  h: number
  mem: number
  g: number
  q: number
  pk: number
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'sederhana', label: 'Balok Sederhana', hint: 'sendi – rol, kantilever ujung opsional (statis tertentu)' },
  { id: 'menerus', label: 'Balok Menerus', hint: '2–3 bentang, statis tak tentu: garis pengaruh melengkung' },
  { id: 'truss', label: 'Rangka Batang', hint: 'Pratt, Howe, Warren — lantai kendaraan di batang bawah' },
]

export const VEHICLES: { id: Vehicle; label: string; title: string }[] = [
  { id: 'satuan', label: 'Beban satuan', title: 'Satu beban 1 kN berjalan: nilainya = ordinat garis pengaruh' },
  { id: 'truk', label: 'Truk T', title: 'Truk tiga gandar 50 / 225 / 225 kN (pola SNI 1725)' },
  { id: 'lajur', label: 'Beban lajur', title: 'Beban merata parsial q + beban garis p (pola BTR + BGT)' },
]

export const KEYS: Record<Setup, (keyof Params)[]> = {
  sederhana: ['L', 'c1', 'c2', 'xs', 'g', 'q', 'pk'],
  menerus: ['L', 'L2', 'L3', 'nb', 'xs', 'g', 'q', 'pk'],
  truss: ['L', 'h', 'n', 'tp', 'mem', 'g', 'q', 'pk'],
}

const BASE: Params = { L: 10, L2: 8, L3: 8, nb: 2, c1: 0, c2: 0, xs: 4, n: 6, tp: 0, h: 3, mem: 0, g: 5, q: 9, pk: 49 }

export function defaults(s: Setup): Params {
  switch (s) {
    case 'sederhana':
      return { ...BASE }
    case 'menerus':
      return { ...BASE, L: 8, L2: 8, L3: 8, nb: 2, xs: 3.2 }
    case 'truss': {
      const p = { ...BASE, L: 24, h: 3, n: 6, tp: 0 }
      const g = trussGeom(p)
      p.mem = Math.max(0, g.names.indexOf('D2'))
      return p
    }
  }
}

export const defaultResp = (s: Setup) => (s === 'truss' ? 'N' : 'M')

export interface Range {
  min: number
  max: number
  step: number
}

/** Panjang jalur beban (m), dari x = 0 di ujung kiri. */
export function trackLength(s: Setup, p: Params) {
  if (s === 'sederhana') return p.c1 + p.L + p.c2
  if (s === 'menerus') return p.L + p.L2 + (p.nb >= 3 ? p.L3 : 0)
  return p.L
}

/** Posisi tumpuan (m) di sepanjang jalur, kiri → kanan. */
export function supportsX(s: Setup, p: Params): number[] {
  if (s === 'sederhana') return [p.c1, p.c1 + p.L]
  if (s === 'menerus') {
    const xs = [0, p.L, p.L + p.L2]
    if (p.nb >= 3) xs.push(p.L + p.L2 + p.L3)
    return xs
  }
  return [0, p.L]
}

export function ranges(s: Setup, p: Params): Record<keyof Params, Range> {
  const Lt = trackLength(s, p)
  const names = s === 'truss' ? trussGeom(p).names.length : 1
  return {
    L: { min: s === 'truss' ? 6 : 2, max: s === 'truss' ? 60 : s === 'menerus' ? 20 : 30, step: 0.1 },
    L2: { min: 2, max: 20, step: 0.1 },
    L3: { min: 2, max: 20, step: 0.1 },
    nb: { min: 2, max: 3, step: 1 },
    c1: { min: 0, max: 8, step: 0.1 },
    c2: { min: 0, max: 8, step: 0.1 },
    xs: { min: 0, max: Math.max(0, Lt - 0.05), step: 0.05 },
    n: { min: 2, max: 12, step: 2 },
    tp: { min: 0, max: 2, step: 1 },
    h: { min: 0.5, max: 8, step: 0.1 },
    mem: { min: 0, max: names - 1, step: 1 },
    g: { min: 4, max: 9, step: 0.5 },
    q: { min: 0, max: 50, step: 0.5 },
    pk: { min: 0, max: 200, step: 1 },
  }
}

export interface Resp {
  id: string
  label: string
  unit: string // satuan ordinat garis pengaruh (per kN beban)
}

const SUP = ['A', 'B', 'C', 'D']

export function responses(s: Setup, p: Params): Resp[] {
  const r: Resp[] = supportsX(s, p).map((_, i) => ({ id: `R${i}`, label: `R${SUP[i]}`, unit: 'kN/kN' }))
  if (s === 'truss') r.push({ id: 'N', label: 'Gaya batang', unit: 'kN/kN' })
  else r.push({ id: 'V', label: 'Geser V', unit: 'kN/kN' }, { id: 'M', label: 'Momen M', unit: 'kN·m/kN' })
  return r
}

export const respLabel = (s: Setup, p: Params, resp: string) => {
  if (resp === 'N' && s === 'truss') return `N ${trussGeom(p).names[p.mem] ?? ''}`
  if (resp === 'V') return 'V'
  if (resp === 'M') return 'M'
  return `R${SUP[Number(resp.slice(1))] ?? ''}`
}
export const respUnit = (resp: string) => (resp === 'M' ? 'm' : '–')
export const supLabel = (i: number) => SUP[i] ?? String(i)

/** Titik patah garis pengaruh (ujung, tumpuan, potongan, simpul panel). */
export function kinks(s: Setup, p: Params): number[] {
  const Lt = trackLength(s, p)
  const set = new Set<number>([0, Lt, ...supportsX(s, p)])
  if (s !== 'truss') set.add(p.xs)
  else {
    const dx = p.L / p.n
    for (let i = 0; i <= p.n; i++) set.add(i * dx)
  }
  return [...set].sort((a, b) => a - b)
}

// ---------- rangka batang ----------

export interface TrussGeom {
  frame: Frame
  names: string[]
  n: number
  dx: number
}

const trussCache = new Map<string, TrussGeom>()

/** Geometri rangka dipinjam dari Room Structure (Pratt/Howe/Warren, simpul bawah 0..n, tumpuan sendi kiri & rol kanan). */
export function trussGeom(p: Params): TrussGeom {
  const n = Math.max(2, Math.round(p.n / 2) * 2)
  const key = `${p.L}|${p.h}|${n}|${Math.round(p.tp)}`
  const hit = trussCache.get(key)
  if (hit) return hit
  const sp = { ...structDefaults('truss'), L: p.L, h: p.h, n, tp: Math.round(p.tp), P: 0, w: 0, EA: 200000 }
  const b = buildStructure('truss', sp)
  const g = { frame: b.frame, names: b.names, n, dx: p.L / n }
  if (trussCache.size > 64) trussCache.clear()
  trussCache.set(key, g)
  return g
}

export const trussType = (p: Params) => TRUSS_TYPES[Math.round(p.tp)] ?? 'Pratt'

// ---------- beban ----------

export interface Load {
  x: number // posisi di jalur (m)
  P: number // besar, ke bawah (kN)
}

export interface Axle {
  off: number // posisi relatif terhadap gandar depan (m)
  P: number
}

/** Truk T tiga gandar 50 / 225 / 225 kN, jarak 5 m dan g (4–9 m). dir = +1 bergerak ke kanan, −1 ke kiri. */
export function truckAxles(g: number, dir: 1 | -1): Axle[] {
  return [
    { off: 0, P: 50 },
    { off: -dir * 5, P: 225 },
    { off: -dir * (5 + g), P: 225 },
  ]
}

/** Rentang posisi gandar depan X agar minimal satu gandar berada di jalur. */
export function truckRange(Lt: number, axles: Axle[]) {
  const offs = axles.map((a) => a.off)
  return { min: -Math.max(...offs), max: Lt - Math.min(...offs) }
}

export const truckLoads = (X: number, axles: Axle[]): Load[] => axles.map((a) => ({ x: X + a.off, P: a.P }))

// ---------- solver kekakuan (nilai "terukur") ----------

const EI = 1e4
const EA = 3e6

interface BeamModel {
  frame: Frame
  bp: number[] // titik batas batang
  secMember: number // batang yang berawal di potongan xs
}

function beamModel(s: Setup, p: Params, loads: Load[]): BeamModel {
  const Lt = trackLength(s, p)
  const sx = supportsX(s, p)
  const bp = [...new Set([0, Lt, ...sx, Math.min(p.xs, Lt)])].sort((a, b) => a - b).filter((v, k, a) => k === 0 || v - a[k - 1] > 1e-9)
  const nodes = bp.map((x) => ({ x, y: 0 }))
  const members: FMember[] = []
  for (let k = 0; k < bp.length - 1; k++) members.push({ i: k, j: k + 1, EA, EI })
  const nodeOf = (x: number) => bp.findIndex((v) => Math.abs(v - x) < 1e-9)
  const supports: FSupport[] = sx.map((x, k) => (k === 0 ? { node: nodeOf(x), ux: true, uy: true } : { node: nodeOf(x), uy: true }))
  const pointLoads: FPointLoad[] = []
  for (const l of loads) {
    if (l.x < -1e-9 || l.x > Lt + 1e-9 || !l.P) continue
    let m = 0
    while (m < members.length - 1 && l.x > bp[m + 1]) m++
    pointLoads.push({ member: m, a: Math.max(0, l.x - bp[m]), fy: -l.P })
  }
  const secMember = Math.min(members.length - 1, Math.max(0, nodeOf(Math.min(p.xs, Lt))))
  return { frame: { nodes, members, supports, pointLoads }, bp, secMember }
}

/** Beban di lantai rangka diteruskan gelagar memanjang (sederhana antar simpul panel) ke simpul bawah. */
export function deckNodeLoads(p: Params, loads: Load[]): { node: number; P: number }[] {
  const g = trussGeom(p)
  const out = new Map<number, number>()
  for (const l of loads) {
    if (l.x < -1e-9 || l.x > p.L + 1e-9 || !l.P) continue
    const u = Math.min(g.n, Math.max(0, l.x / g.dx))
    const j = Math.min(g.n - 1, Math.floor(u))
    const t = u - j
    out.set(j, (out.get(j) ?? 0) + l.P * (1 - t))
    out.set(j + 1, (out.get(j + 1) ?? 0) + l.P * t)
  }
  return [...out].map(([node, P]) => ({ node, P }))
}

/** Respons dari analisis langsung (metode kekakuan) untuk sekumpulan beban sekaligus. null bila labil. */
export function matrixEffect(s: Setup, p: Params, resp: string, loads: Load[]): number | null {
  if (s === 'truss') {
    const g = trussGeom(p)
    const frame: Frame = { ...g.frame, nodeLoads: deckNodeLoads(p, loads).map((l) => ({ node: l.node, fy: -l.P })) }
    const r = analyze(frame, 1)
    if (!r.ok) return null
    if (resp[0] === 'R') return r.reactions[Number(resp.slice(1))]?.ry ?? 0
    return r.members[p.mem]?.stations[0]?.N ?? 0
  }
  const bm = beamModel(s, p, loads)
  const r = analyze(bm.frame, 2)
  if (!r.ok) return null
  if (resp[0] === 'R') return r.reactions[Number(resp.slice(1))]?.ry ?? 0
  const st = r.members[bm.secMember].stations[0]
  return resp === 'V' ? st.V : st.M
}

// ---------- URL ----------

export function clampParams(s: Setup, p: Params): Params {
  const out = { ...p }
  const order: (keyof Params)[] = ['L', 'L2', 'L3', 'nb', 'c1', 'c2', 'n', 'tp', 'h', 'g', 'q', 'pk', 'xs', 'mem']
  for (const k of order) {
    const r = ranges(s, out)[k]
    out[k] = Math.min(r.max, Math.max(r.min, out[k]))
  }
  out.nb = Math.round(out.nb)
  out.n = Math.max(2, Math.round(out.n / 2) * 2)
  out.tp = Math.round(out.tp)
  out.mem = Math.round(out.mem)
  return out
}

export interface QueryState {
  setup: Setup
  params: Params
  resp: string
  veh: Vehicle
  dir: 1 | -1
}

export function parseQuery(q: string): QueryState {
  const sp = new URLSearchParams(q)
  const raw = sp.get('setup') as Setup | null
  const setup: Setup = raw && SETUPS.some((x) => x.id === raw) ? raw : 'sederhana'
  const p = defaults(setup)
  for (const key of KEYS[setup]) {
    const v = Number(sp.get(key))
    if (sp.has(key) && Number.isFinite(v)) p[key] = v
  }
  const params = clampParams(setup, p)
  const r = sp.get('r') ?? ''
  const resp = responses(setup, params).some((x) => x.id === r) ? r : defaultResp(setup)
  const v = sp.get('veh') as Vehicle | null
  const veh: Vehicle = v && VEHICLES.some((x) => x.id === v) ? v : 'satuan'
  return { setup, params, resp, veh, dir: sp.get('dir') === '-1' ? -1 : 1 }
}

export function toQuery(st: QueryState): string {
  const sp = new URLSearchParams({ setup: st.setup, r: st.resp })
  for (const key of KEYS[st.setup]) sp.set(key, String(Math.round(st.params[key] * 1e4) / 1e4))
  if (st.veh !== 'satuan') sp.set('veh', st.veh)
  if (st.dir === -1) sp.set('dir', '-1')
  return sp.toString()
}
