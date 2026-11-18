// Analisis struktur 2D metode kekakuan langsung (direct stiffness): elemen portal (EA, EI, Euler–Bernoulli)
// dan elemen rangka (hanya EA). Satuan bebas tetapi konsisten (Room memakai kN, m).
//
// Sumbu global: x ke kanan, y ke atas, rotasi berlawanan jarum jam positif.
// Sumbu lokal batang: x dari simpul i ke j, y = x diputar +90°.
// Konvensi gaya dalam (dari potongan kiri, s diukur dari i):
//   N > 0 tarik · V = gaya geser (balok: positif ke atas di ujung kiri) · M > 0 = serat lokal −y tertarik
//   (untuk balok kiri→kanan: momen positif = melengkung ke bawah/sagging, digambar di bawah balok).

export type Kind = 'frame' | 'truss'

export interface FNode {
  x: number
  y: number
}

export interface FMember {
  i: number
  j: number
  kind?: Kind
  EA: number
  EI: number
  /** beban merata global per satuan panjang batang (y positif ke atas, mis. gravitasi = −q) */
  qx?: number
  qy?: number
}

export interface FSupport {
  node: number
  ux?: boolean
  uy?: boolean
  rz?: boolean
}

export interface FNodeLoad {
  node: number
  fx?: number
  fy?: number
  mz?: number
}

/** Beban terpusat global pada batang di jarak a dari simpul i. */
export interface FPointLoad {
  member: number
  a: number
  fx?: number
  fy?: number
}

export interface Frame {
  nodes: FNode[]
  members: FMember[]
  supports: FSupport[]
  nodeLoads?: FNodeLoad[]
  pointLoads?: FPointLoad[]
}

export interface Station {
  s: number // jarak dari simpul i (m)
  x: number // posisi global tak terdeformasi
  y: number
  N: number
  V: number
  M: number
  ux: number // perpindahan global
  uy: number
}

export interface MemberResult {
  L: number
  c: number
  s: number
  stations: Station[]
}

export interface Reaction {
  node: number
  rx: number
  ry: number
  mz: number
}

export interface FrameResult {
  ok: boolean // false = struktur labil (matriks kekakuan singular)
  members: MemberResult[]
  reactions: Reaction[]
  disp: { ux: number; uy: number; rz: number }[] // per simpul (indeks sama dengan Frame.nodes)
  maxDisp: number
}

interface Elem {
  i: number
  j: number
  truss: boolean
  EA: number
  EI: number
  L: number
  c: number
  s: number
  wx: number // beban merata lokal
  wy: number
  member: number
  s0: number
}

/** Kekakuan lokal 6×6 (baris-mayor). */
function localK(e: Elem): Float64Array {
  const k = new Float64Array(36)
  const { L, EA, EI } = e
  const a = EA / L
  k[0] = a
  k[3] = -a
  k[18] = -a
  k[21] = a
  if (e.truss) return k
  const b = (12 * EI) / L ** 3
  const cc = (6 * EI) / L ** 2
  const d = (4 * EI) / L
  const f = (2 * EI) / L
  const rows = [
    [1, 1, b],
    [1, 2, cc],
    [1, 4, -b],
    [1, 5, cc],
    [2, 2, d],
    [2, 4, -cc],
    [2, 5, f],
    [4, 4, b],
    [4, 5, -cc],
    [5, 5, d],
  ]
  for (const [r, c, v] of rows) {
    k[r * 6 + c] = v
    k[c * 6 + r] = v
  }
  return k
}

/** Gaya jepit ujung (gaya yang diberikan tumpuan jepit pada batang) akibat beban merata lokal. */
function fixedEnd(e: Elem): number[] {
  const { L, wx, wy } = e
  if (e.truss) return [(-wx * L) / 2, (-wy * L) / 2, 0, (-wx * L) / 2, (-wy * L) / 2, 0]
  return [(-wx * L) / 2, (-wy * L) / 2, (-wy * L * L) / 12, (-wx * L) / 2, (-wy * L) / 2, (wy * L * L) / 12]
}

const toLocal = (c: number, s: number, g: number[]) => [
  c * g[0] + s * g[1],
  -s * g[0] + c * g[1],
  g[2],
  c * g[3] + s * g[4],
  -s * g[3] + c * g[4],
  g[5],
]
const toGlobal = (c: number, s: number, l: number[]) => [
  c * l[0] - s * l[1],
  s * l[0] + c * l[1],
  l[2],
  c * l[3] - s * l[4],
  s * l[3] + c * l[4],
  l[5],
]

/** Eliminasi Gauss dengan pivot parsial; null bila singular. A (n×n) dan b dirusak. */
function solveDense(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  let scale = 0
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i * n + i]))
  const tol = Math.max(scale, 1e-300) * 1e-11
  for (let col = 0; col < n; col++) {
    let piv = col
    let best = Math.abs(A[col * n + col])
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col])
      if (v > best) {
        best = v
        piv = r
      }
    }
    if (best < tol) return null
    if (piv !== col) {
      for (let c = col; c < n; c++) {
        const t = A[col * n + c]
        A[col * n + c] = A[piv * n + c]
        A[piv * n + c] = t
      }
      const t = b[col]
      b[col] = b[piv]
      b[piv] = t
    }
    const inv = 1 / A[col * n + col]
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] * inv
      if (f === 0) continue
      for (let c = col; c < n; c++) A[r * n + c] -= f * A[col * n + c]
      b[r] -= f * b[col]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r]
    for (let c = r + 1; c < n; c++) sum -= A[r * n + c] * x[c]
    x[r] = sum / A[r * n + r]
  }
  return x
}

/**
 * Analisis statik linear. Batang portal dibagi `seg` sub-elemen (plus simpul di titik beban terpusat) agar diagram
 * dan bentuk lendutan halus; nilai di simpul tetap eksak untuk teori balok Euler–Bernoulli.
 */
export function analyze(fr: Frame, seg = 16): FrameResult {
  const nodes: FNode[] = fr.nodes.map((n) => ({ ...n }))
  const loads = new Map<number, [number, number, number]>()
  const addLoad = (n: number, fx: number, fy: number, mz: number) => {
    const l = loads.get(n) ?? [0, 0, 0]
    l[0] += fx
    l[1] += fy
    l[2] += mz
    loads.set(n, l)
  }
  for (const l of fr.nodeLoads ?? []) addLoad(l.node, l.fx ?? 0, l.fy ?? 0, l.mz ?? 0)

  const elems: Elem[] = []
  fr.members.forEach((m, mi) => {
    const A = fr.nodes[m.i]
    const B = fr.nodes[m.j]
    const L = Math.hypot(B.x - A.x, B.y - A.y)
    const c = (B.x - A.x) / L
    const s = (B.y - A.y) / L
    const truss = m.kind === 'truss'
    const gx = m.qx ?? 0
    const gy = m.qy ?? 0
    const wx = c * gx + s * gy
    const wy = -s * gx + c * gy
    // stasiun pembagian
    const st = new Set<number>([0, L])
    const n = truss ? 1 : seg
    for (let k = 1; k < n; k++) st.add((L * k) / n)
    const pl = (fr.pointLoads ?? []).filter((p) => p.member === mi)
    for (const p of pl) st.add(Math.min(L, Math.max(0, p.a)))
    const sorted = [...st].sort((x, y) => x - y).filter((v, k, arr) => k === 0 || v - arr[k - 1] > L * 1e-9)
    const idx: number[] = sorted.map((d, k) => {
      if (k === 0) return m.i
      if (k === sorted.length - 1) return m.j
      nodes.push({ x: A.x + c * d, y: A.y + s * d })
      return nodes.length - 1
    })
    for (const p of pl) {
      const d = Math.min(L, Math.max(0, p.a))
      let best = 0
      for (let k = 1; k < sorted.length; k++) if (Math.abs(sorted[k] - d) < Math.abs(sorted[best] - d)) best = k
      addLoad(idx[best], p.fx ?? 0, p.fy ?? 0, 0)
    }
    for (let k = 0; k < sorted.length - 1; k++) {
      elems.push({ i: idx[k], j: idx[k + 1], truss, EA: m.EA, EI: m.EI, L: sorted[k + 1] - sorted[k], c, s, wx, wy, member: mi, s0: sorted[k] })
    }
  })

  const nn = nodes.length
  const nd = nn * 3
  const K = new Float64Array(nd * nd)
  const F = new Float64Array(nd)
  for (const [n, l] of loads) {
    F[n * 3] += l[0]
    F[n * 3 + 1] += l[1]
    F[n * 3 + 2] += l[2]
  }

  const kl: Float64Array[] = []
  const hasFrame = new Uint8Array(nn)
  for (const e of elems) {
    const k = localK(e)
    kl.push(k)
    if (!e.truss) hasFrame[e.i] = hasFrame[e.j] = 1
    const { c, s } = e
    // T (6×6) blok rotasi; kg = Tᵀ k T
    const T = new Float64Array(36)
    for (const o of [0, 3]) {
      T[o * 6 + o] = c
      T[o * 6 + o + 1] = s
      T[(o + 1) * 6 + o] = -s
      T[(o + 1) * 6 + o + 1] = c
      T[(o + 2) * 6 + o + 2] = 1
    }
    const kT = new Float64Array(36)
    for (let r = 0; r < 6; r++)
      for (let q = 0; q < 6; q++) {
        let v = 0
        for (let t = 0; t < 6; t++) v += k[r * 6 + t] * T[t * 6 + q]
        kT[r * 6 + q] = v
      }
    const dofs = [e.i * 3, e.i * 3 + 1, e.i * 3 + 2, e.j * 3, e.j * 3 + 1, e.j * 3 + 2]
    for (let r = 0; r < 6; r++)
      for (let q = 0; q < 6; q++) {
        let v = 0
        for (let t = 0; t < 6; t++) v += T[t * 6 + r] * kT[t * 6 + q]
        K[dofs[r] * nd + dofs[q]] += v
      }
    const feg = toGlobal(c, s, fixedEnd(e))
    for (let r = 0; r < 6; r++) F[dofs[r]] -= feg[r]
  }

  const fixed = new Uint8Array(nd)
  for (const sp of fr.supports) {
    if (sp.ux) fixed[sp.node * 3] = 1
    if (sp.uy) fixed[sp.node * 3 + 1] = 1
    if (sp.rz) fixed[sp.node * 3 + 2] = 1
  }
  // simpul yang hanya disambung batang rangka: rotasi tidak punya kekakuan → dikunci (reaksi momennya nol)
  const artificial = new Uint8Array(nd)
  for (let n = 0; n < nn; n++)
    if (!hasFrame[n] && !fixed[n * 3 + 2]) {
      fixed[n * 3 + 2] = 1
      artificial[n * 3 + 2] = 1
    }

  const free: number[] = []
  for (let d = 0; d < nd; d++) if (!fixed[d]) free.push(d)
  const nf = free.length
  const Kr = new Float64Array(nf * nf)
  const Fr = new Float64Array(nf)
  for (let a = 0; a < nf; a++) {
    Fr[a] = F[free[a]]
    for (let b = 0; b < nf; b++) Kr[a * nf + b] = K[free[a] * nd + free[b]]
  }
  const sol = nf ? solveDense(Kr, Fr, nf) : new Float64Array(0)
  const D = new Float64Array(nd)
  const ok = !!sol
  if (sol) for (let a = 0; a < nf; a++) D[free[a]] = sol[a]

  // reaksi = K·D − F di dof terkekang
  const reactions: Reaction[] = fr.supports.map((sp) => {
    const r = [0, 0, 0]
    for (let q = 0; q < 3; q++) {
      const d = sp.node * 3 + q
      if (!fixed[d] || artificial[d]) continue
      let v = -F[d]
      for (let t = 0; t < nd; t++) v += K[d * nd + t] * D[t]
      r[q] = ok ? v : 0
    }
    return { node: sp.node, rx: r[0], ry: r[1], mz: r[2] }
  })

  const members: MemberResult[] = fr.members.map((m) => {
    const A = fr.nodes[m.i]
    const B = fr.nodes[m.j]
    const L = Math.hypot(B.x - A.x, B.y - A.y)
    return { L, c: (B.x - A.x) / L, s: (B.y - A.y) / L, stations: [] }
  })

  let maxDisp = 0
  elems.forEach((e, ei) => {
    const { c, s, L } = e
    const dg = [D[e.i * 3], D[e.i * 3 + 1], D[e.i * 3 + 2], D[e.j * 3], D[e.j * 3 + 1], D[e.j * 3 + 2]]
    const dl = toLocal(c, s, dg)
    const k = kl[ei]
    const f0 = fixedEnd(e)
    const f = f0.map((v, r) => {
      let sum = v
      for (let t = 0; t < 6; t++) sum += k[r * 6 + t] * dl[t]
      return sum
    })
    const loaded = !e.truss && e.wy !== 0
    const ts = e.truss ? [0, 1] : loaded ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]
    const mr = members[e.member]
    const A = fr.nodes[fr.members[e.member].i]
    for (const t of ts) {
      const x = t * L
      const N = -f[0] - e.wx * x
      const V = f[1] + e.wy * x
      const M = e.truss ? 0 : -f[2] + f[1] * x + (e.wy * x * x) / 2
      // perpindahan lokal: aksial linear, lateral Hermite + solusi khusus beban merata (jepit-jepit)
      const u = dl[0] * (1 - t) + dl[3] * t
      let v: number
      if (e.truss) v = dl[1] * (1 - t) + dl[4] * t
      else {
        const h1 = 1 - 3 * t * t + 2 * t ** 3
        const h2 = L * (t - 2 * t * t + t ** 3)
        const h3 = 3 * t * t - 2 * t ** 3
        const h4 = L * (-t * t + t ** 3)
        v = h1 * dl[1] + h2 * dl[2] + h3 * dl[4] + h4 * dl[5] + (e.wy * x * x * (L - x) ** 2) / (24 * e.EI)
      }
      const sAbs = e.s0 + x
      const ux = c * u - s * v
      const uy = s * u + c * v
      maxDisp = Math.max(maxDisp, Math.hypot(ux, uy))
      const prev = mr.stations[mr.stations.length - 1]
      // titik sambung sub-elemen tanpa loncatan gaya tidak perlu digandakan
      if (prev && Math.abs(prev.s - sAbs) < 1e-12 && Math.abs(prev.V - V) < 1e-9 && Math.abs(prev.N - N) < 1e-9) continue
      mr.stations.push({ s: sAbs, x: A.x + mr.c * sAbs, y: A.y + mr.s * sAbs, N, V, M, ux, uy })
    }
  })

  const disp = fr.nodes.map((_, n) => ({ ux: D[n * 3], uy: D[n * 3 + 1], rz: D[n * 3 + 2] }))
  return { ok, members, reactions, disp, maxDisp }
}

/** Nilai di jarak s sepanjang batang (interpolasi linear antar stasiun; di titik loncatan diambil sisi kiri). */
export function sampleAt(mr: MemberResult, s: number): Station {
  const st = mr.stations
  if (s <= st[0].s) return st[0]
  for (let k = 1; k < st.length; k++) {
    if (s <= st[k].s) {
      const a = st[k - 1]
      const b = st[k]
      const t = b.s - a.s > 1e-12 ? (s - a.s) / (b.s - a.s) : 0
      const lerp = (p: number, q: number) => p + (q - p) * t
      return { s, x: lerp(a.x, b.x), y: lerp(a.y, b.y), N: lerp(a.N, b.N), V: lerp(a.V, b.V), M: lerp(a.M, b.M), ux: lerp(a.ux, b.ux), uy: lerp(a.uy, b.uy) }
    }
  }
  return st[st.length - 1]
}
