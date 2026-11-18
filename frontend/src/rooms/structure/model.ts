// Model Room Structure: setup + parameter → struktur (Frame) untuk solver kekakuan, rentang slider, query URL.
import type { Frame, FMember, FSupport } from '../../lab/frame2d'

export type Setup = 'sederhana' | 'kantilever' | 'menerus' | 'portal' | 'gable' | 'truss'

/**
 * Satu objek parameter untuk semua setup (satuan kN, m). Tiap setup memakai sebagian kunci (lihat KEYS).
 * L bentang (menerus: bentang 1) · L2 bentang 2 · h tinggi kolom / rangka · f tinggi puncak (gable)
 * P beban terpusat ke bawah di jarak a dari kiri · q beban merata ke bawah · W beban lateral di puncak kolom kiri
 * EI kekakuan lentur · r = Ib/Ic · bj tumpuan dasar portal (1 jepit, 0 sendi) · n jumlah panel rangka
 * tp tipe rangka (0 Pratt, 1 Howe, 2 Warren) · w beban di tiap simpul bawah rangka · EA kekakuan aksial rangka
 */
export interface Params {
  L: number
  L2: number
  h: number
  f: number
  P: number
  a: number
  q: number
  W: number
  EI: number
  r: number
  bj: number
  n: number
  tp: number
  w: number
  EA: number
}

export const SETUPS: { id: Setup; label: string; hint: string }[] = [
  { id: 'sederhana', label: 'Balok Sederhana', hint: 'sendi – rol' },
  { id: 'kantilever', label: 'Kantilever', hint: 'jepit di kiri, ujung kanan bebas' },
  { id: 'menerus', label: 'Balok Menerus', hint: 'dua bentang, statis tak tentu' },
  { id: 'portal', label: 'Portal', hint: 'portal satu tingkat satu bentang' },
  { id: 'gable', label: 'Gable', hint: 'portal pelana (atap miring)' },
  { id: 'truss', label: 'Truss', hint: 'rangka batang: Pratt, Howe, Warren' },
]

export const KEYS: Record<Setup, (keyof Params)[]> = {
  sederhana: ['L', 'P', 'a', 'q', 'EI'],
  kantilever: ['L', 'P', 'a', 'q', 'EI'],
  menerus: ['L', 'L2', 'P', 'a', 'q', 'EI'],
  portal: ['L', 'h', 'P', 'a', 'q', 'W', 'EI', 'r', 'bj'],
  gable: ['L', 'h', 'f', 'q', 'W', 'EI', 'r', 'bj'],
  truss: ['L', 'h', 'n', 'tp', 'P', 'a', 'w', 'EA'],
}

const BASE: Params = { L: 6, L2: 5, h: 4, f: 2, P: 20, a: 3, q: 5, W: 0, EI: 10000, r: 1, bj: 1, n: 6, tp: 0, w: 0, EA: 200000 }

export function defaults(s: Setup): Params {
  switch (s) {
    case 'sederhana':
      return { ...BASE }
    case 'kantilever':
      return { ...BASE, L: 4, a: 4, P: 10, q: 2 }
    case 'menerus':
      return { ...BASE, L: 5, L2: 5, a: 2.5, P: 20, q: 5 }
    case 'portal':
      return { ...BASE, L: 6, h: 4, P: 0, a: 3, q: 10, W: 10 }
    case 'gable':
      return { ...BASE, L: 12, h: 4, f: 2, q: 5, W: 5, r: 1 }
    case 'truss':
      return { ...BASE, L: 12, h: 2, n: 6, tp: 0, P: 50, a: 6, w: 0 }
  }
}

export interface Range {
  min: number
  max: number
  step: number
}

/** Panjang jalur beban P (dari kiri). */
export const trackLength = (s: Setup, p: Params) => (s === 'menerus' ? p.L + p.L2 : p.L)

export function ranges(s: Setup, p: Params): Record<keyof Params, Range> {
  return {
    L: { min: s === 'truss' || s === 'gable' ? 4 : 1, max: s === 'truss' || s === 'gable' ? 30 : 15, step: 0.1 },
    L2: { min: 1, max: 15, step: 0.1 },
    h: { min: s === 'truss' ? 0.5 : 1, max: s === 'truss' ? 6 : 10, step: 0.1 },
    f: { min: 0, max: 6, step: 0.1 },
    P: { min: 0, max: 200, step: 0.5 },
    a: { min: 0, max: trackLength(s, p), step: s === 'truss' ? p.L / p.n : 0.05 },
    q: { min: 0, max: 50, step: 0.1 },
    W: { min: -100, max: 100, step: 0.5 },
    EI: { min: 500, max: 200000, step: 100 },
    r: { min: 0.1, max: 10, step: 0.1 },
    bj: { min: 0, max: 1, step: 1 },
    n: { min: 2, max: 12, step: 2 },
    tp: { min: 0, max: 2, step: 1 },
    w: { min: 0, max: 100, step: 0.5 },
    EA: { min: 10000, max: 2000000, step: 1000 },
  }
}

/** EA batang portal/balok: dibuat besar relatif EI (≈ profil baja) sehingga deformasi aksial kecil. */
export const frameEA = (EI: number) => EI * 300

export interface Track {
  x0: number
  x1: number
  y: number
  snap: number // 0 = bebas
}

export interface Built {
  frame: Frame
  /** nama tiap batang (untuk tabel & readout) */
  names: string[]
  /** jalur beban P yang bisa digeser (koordinat global, m) */
  track: Track | null
  /** batang yang disorot di tabel teori (rangka: batang bawah tengah) */
  focus: number
}

export const TRUSS_TYPES = ['Pratt', 'Howe', 'Warren'] as const

export function build(s: Setup, p: Params): Built {
  const EI = p.EI
  const EA = frameEA(EI)
  const pin = (node: number): FSupport => ({ node, ux: true, uy: true })
  const roller = (node: number): FSupport => ({ node, uy: true })
  const fix = (node: number): FSupport => ({ node, ux: true, uy: true, rz: true })
  const beam = (i: number, j: number, q = p.q, ei = EI): FMember => ({ i, j, EA: frameEA(ei), EI: ei, qy: -q })

  switch (s) {
    case 'sederhana':
    case 'kantilever': {
      const frame: Frame = {
        nodes: [
          { x: 0, y: 0 },
          { x: p.L, y: 0 },
        ],
        members: [beam(0, 1)],
        supports: s === 'sederhana' ? [pin(0), roller(1)] : [fix(0)],
        pointLoads: p.P ? [{ member: 0, a: p.a, fy: -p.P }] : [],
      }
      return { frame, names: ['Balok'], track: { x0: 0, x1: p.L, y: 0, snap: 0 }, focus: 0 }
    }
    case 'menerus': {
      const onFirst = p.a <= p.L
      const frame: Frame = {
        nodes: [
          { x: 0, y: 0 },
          { x: p.L, y: 0 },
          { x: p.L + p.L2, y: 0 },
        ],
        members: [beam(0, 1), beam(1, 2)],
        supports: [pin(0), roller(1), roller(2)],
        pointLoads: p.P ? [{ member: onFirst ? 0 : 1, a: onFirst ? p.a : p.a - p.L, fy: -p.P }] : [],
      }
      return { frame, names: ['Bentang 1', 'Bentang 2'], track: { x0: 0, x1: p.L + p.L2, y: 0, snap: 0 }, focus: 0 }
    }
    case 'portal': {
      const base = p.bj ? fix : pin
      const frame: Frame = {
        nodes: [
          { x: 0, y: 0 },
          { x: 0, y: p.h },
          { x: p.L, y: p.h },
          { x: p.L, y: 0 },
        ],
        members: [
          { i: 0, j: 1, EA, EI },
          beam(1, 2, p.q, EI * p.r),
          { i: 3, j: 2, EA, EI },
        ],
        supports: [base(0), base(3)],
        nodeLoads: p.W ? [{ node: 1, fx: p.W }] : [],
        pointLoads: p.P ? [{ member: 1, a: p.a, fy: -p.P }] : [],
      }
      return { frame, names: ['Kolom kiri', 'Balok', 'Kolom kanan'], track: { x0: 0, x1: p.L, y: p.h, snap: 0 }, focus: 1 }
    }
    case 'gable': {
      const base = p.bj ? fix : pin
      const half = p.L / 2
      const lr = Math.hypot(half, p.f)
      // beban q per proyeksi horizontal → per panjang kasau: q·(L/2)/Lr
      const qr = (p.q * half) / lr
      const frame: Frame = {
        nodes: [
          { x: 0, y: 0 },
          { x: 0, y: p.h },
          { x: half, y: p.h + p.f },
          { x: p.L, y: p.h },
          { x: p.L, y: 0 },
        ],
        members: [
          { i: 0, j: 1, EA, EI },
          beam(1, 2, qr, EI * p.r),
          beam(2, 3, qr, EI * p.r),
          { i: 4, j: 3, EA, EI },
        ],
        supports: [base(0), base(4)],
        nodeLoads: p.W ? [{ node: 1, fx: p.W }] : [],
      }
      return { frame, names: ['Kolom kiri', 'Kasau kiri', 'Kasau kanan', 'Kolom kanan'], track: null, focus: 1 }
    }
    case 'truss':
      return buildTruss(p)
  }
}

function buildTruss(p: Params): Built {
  const n = Math.max(2, Math.round(p.n / 2) * 2)
  const dx = p.L / n
  const nodes = [] as { x: number; y: number }[]
  for (let i = 0; i <= n; i++) nodes.push({ x: i * dx, y: 0 })
  const bot = (i: number) => i
  const members: FMember[] = []
  const names: string[] = []
  const T = (i: number, j: number, name: string) => {
    members.push({ i, j, kind: 'truss', EA: p.EA, EI: 0 })
    names.push(name)
  }
  for (let i = 0; i < n; i++) T(bot(i), bot(i + 1), `B${i + 1}`)
  let focus = n / 2 - 1 // batang bawah kiri-tengah
  const tp = Math.round(p.tp)
  if (tp === 2) {
    // Warren: simpul atas di tengah panel, tanpa batang tegak
    const top = (i: number) => n + 1 + i
    for (let i = 0; i < n; i++) nodes.push({ x: (i + 0.5) * dx, y: p.h })
    for (let i = 0; i < n - 1; i++) T(top(i), top(i + 1), `A${i + 1}`)
    for (let i = 0; i < n; i++) {
      T(bot(i), top(i), `D${2 * i + 1}`)
      T(top(i), bot(i + 1), `D${2 * i + 2}`)
    }
  } else {
    // Pratt/Howe: simpul atas di x = i·dx (i = 1..n−1), batang ujung miring
    const top = (i: number) => n + i // i = 1..n−1
    for (let i = 1; i < n; i++) nodes.push({ x: i * dx, y: p.h })
    for (let i = 1; i < n - 1; i++) T(top(i), top(i + 1), `A${i}`)
    for (let i = 1; i < n; i++) T(bot(i), top(i), `V${i}`)
    T(bot(0), top(1), 'D1')
    T(bot(n), top(n - 1), `D${n}`)
    for (let k = 1; k < n - 1; k++) {
      const left = k < n / 2
      // Pratt: diagonal turun ke arah tengah (tarik); Howe: naik ke arah tengah (tekan)
      if (tp === 0) left ? T(top(k), bot(k + 1), `D${k + 1}`) : T(top(k + 1), bot(k), `D${k + 1}`)
      else left ? T(bot(k), top(k + 1), `D${k + 1}`) : T(bot(k + 1), top(k), `D${k + 1}`)
    }
  }
  const nodeLoads = []
  const iP = Math.round(Math.min(p.L, Math.max(0, p.a)) / dx)
  if (p.P) nodeLoads.push({ node: bot(iP), fy: -p.P })
  if (p.w) for (let i = 1; i < n; i++) nodeLoads.push({ node: bot(i), fy: -p.w })
  focus = Math.max(0, focus)
  return {
    frame: { nodes, members, supports: [{ node: 0, ux: true, uy: true }, { node: n, uy: true }], nodeLoads },
    names,
    track: { x0: 0, x1: p.L, y: 0, snap: dx },
    focus,
  }
}

/** Ukuran kotak pembatas struktur (m). */
export function bounds(s: Setup, p: Params) {
  const w = trackLength(s, p)
  const top = s === 'portal' ? p.h : s === 'gable' ? p.h + p.f : s === 'truss' ? p.h : 0
  return { x0: 0, x1: w, y0: 0, y1: top }
}

// ---- URL (bagikan eksperimen) ----

export function clampParams(s: Setup, p: Params): Params {
  const out = { ...p }
  const order: (keyof Params)[] = ['L', 'L2', 'h', 'f', 'n', 'tp', 'bj', 'P', 'q', 'W', 'w', 'EI', 'EA', 'r', 'a']
  for (const k of order) {
    const r = ranges(s, out)[k]
    out[k] = Math.min(r.max, Math.max(r.min, out[k]))
  }
  out.n = Math.max(2, Math.round(out.n / 2) * 2)
  out.tp = Math.round(out.tp)
  out.bj = out.bj ? 1 : 0
  if (s === 'truss') out.a = Math.round(out.a / (out.L / out.n)) * (out.L / out.n)
  return out
}

export function parseQuery(q: string): { setup: Setup; params: Params } {
  const sp = new URLSearchParams(q)
  const raw = sp.get('setup') as Setup | null
  const setup: Setup = raw && SETUPS.some((x) => x.id === raw) ? raw : 'sederhana'
  const p = defaults(setup)
  for (const key of KEYS[setup]) {
    const v = Number(sp.get(key))
    if (sp.has(key) && Number.isFinite(v)) p[key] = v
  }
  return { setup, params: clampParams(setup, p) }
}

export function toQuery(setup: Setup, p: Params): string {
  const sp = new URLSearchParams({ setup })
  for (const key of KEYS[setup]) sp.set(key, String(Math.round(p[key] * 1e4) / 1e4))
  return sp.toString()
}
