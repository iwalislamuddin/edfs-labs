// Garis pengaruh "teori" (rumus tangan), terpisah dari solver kekakuan:
// - balok sederhana + kantilever: statika (garis lurus, prinsip Müller–Breslau)
// - balok menerus: persamaan tiga momen (Clapeyron) untuk beban satuan → reaksi → V dan M dengan statika
// - rangka batang: metode potongan Ritter yang dicari otomatis (keseimbangan vertikal atau momen terhadap titik O)
// Beban satuan 1 kN ke bawah di posisi x. Konvensi: reaksi + ke atas, V(xs) = Σ gaya ke atas di kiri potongan
// (beban tepat di potongan dihitung di kiri), M sagging +, N tarik +.
import { deckNodeLoads, kinks, supportsX, trackLength, trussGeom, type Axle, type Load, type Params, type Setup } from './model'

/** Momen tumpuan balok menerus (indeks 0..nb, ujung = 0) akibat beban satuan di x. Tiga momen, EI seragam. */
export function supportMoments(spans: number[], x: number): number[] {
  const nb = spans.length
  const M = new Array(nb + 1).fill(0)
  if (nb < 2) return M
  // bentang yang memuat beban
  let x0 = 0
  let j = -1
  let a = 0
  for (let k = 0; k < nb; k++) {
    if (x >= x0 - 1e-12 && x <= x0 + spans[k] + 1e-12) {
      j = k
      a = Math.min(spans[k], Math.max(0, x - x0))
      break
    }
    x0 += spans[k]
  }
  if (j < 0) return M
  const Lj = spans[j]
  const b = Lj - a
  // suku beban: tumpuan kiri bentang j (indeks j) dan kanan (j+1)
  const termLeft = (b * (Lj * Lj - b * b)) / Lj
  const termRight = (a * (Lj * Lj - a * a)) / Lj
  // sistem tridiagonal untuk M1..M(nb-1)
  const n = nb - 1
  const A = new Float64Array(n * n)
  const rhs = new Float64Array(n)
  for (let i = 1; i <= n; i++) {
    const Ll = spans[i - 1]
    const Lr = spans[i]
    const r = i - 1
    A[r * n + r] = 2 * (Ll + Lr)
    if (i > 1) A[r * n + r - 1] = Ll
    if (i < n) A[r * n + r + 1] = Lr
    // tumpuan i adalah ujung kanan bentang i−1 dan ujung kiri bentang i
    let v = 0
    if (j === i - 1) v += termRight
    if (j === i) v += termLeft
    rhs[r] = -v
  }
  // Thomas
  const c = new Float64Array(n)
  const d = new Float64Array(n)
  for (let r = 0; r < n; r++) {
    const lo = r > 0 ? A[r * n + r - 1] : 0
    const den = A[r * n + r] - lo * (r > 0 ? c[r - 1] : 0)
    c[r] = r < n - 1 ? A[r * n + r + 1] / den : 0
    d[r] = (rhs[r] - lo * (r > 0 ? d[r - 1] : 0)) / den
  }
  for (let r = n - 1; r >= 0; r--) M[r + 1] = d[r] - (r < n - 1 ? c[r] * M[r + 2] : 0)
  return M
}

/** Reaksi tumpuan (ke atas) akibat beban satuan di x. */
export function beamReactions(s: Setup, p: Params, x: number): number[] {
  const sx = supportsX(s, p)
  const Lt = trackLength(s, p)
  if (x < -1e-9 || x > Lt + 1e-9) return sx.map(() => 0)
  if (s === 'sederhana' || s === 'truss') {
    const L = sx[1] - sx[0]
    const RB = (x - sx[0]) / L
    return [1 - RB, RB]
  }
  const spans = sx.slice(1).map((v, k) => v - sx[k])
  const M = supportMoments(spans, x)
  const nb = spans.length
  const R = new Array(nb + 1).fill(0)
  for (let k = 0; k < nb; k++) {
    const L = spans[k]
    const inSpan = x >= sx[k] - 1e-12 && x <= sx[k + 1] + 1e-12 && !(k > 0 && Math.abs(x - sx[k]) < 1e-12)
    const a = inSpan ? x - sx[k] : 0
    const Rl = inSpan ? (L - a) / L : 0
    const Rr = inSpan ? a / L : 0
    const dM = (M[k + 1] - M[k]) / L
    R[k] += Rl + dM
    R[k + 1] += Rr - dM
  }
  return R
}

/** V dan M di potongan xs dari statika: jumlah gaya/momen di kiri potongan. */
function sectionVM(sx: number[], R: number[], xs: number, x: number) {
  let V = 0
  let M = 0
  sx.forEach((xk, k) => {
    if (xk <= xs + 1e-12) V += R[k]
    if (xk < xs) M += R[k] * (xs - xk)
  })
  if (x <= xs + 1e-12) V -= 1
  if (x < xs) M -= xs - x
  return { V, M }
}

// ---------- rangka: potongan Ritter otomatis ----------

export interface Ritter {
  kind: 'vertikal' | 'momen'
  /** batang yang terpotong (termasuk batang yang diamati) */
  cut: number[]
  /** simpul di sisi kiri potongan */
  left: Set<number>
  /** titik momen (hanya kind = 'momen') */
  O: { x: number; y: number } | null
  /** penyebut: dy batang (vertikal) atau cross(P − O, d) (momen) */
  den: number
}

const ritterCache = new Map<string, Ritter | null>()

/**
 * Cari potongan yang memutus batang `mem` dan paling banyak dua batang lain, dengan sisi kiri = simpul bawah x ≤ xb
 * ditambah simpul atas x ≤ xt. Bila dua batang lain sejajar-horizontal → ΣFy = 0; bila tidak → ΣM terhadap titik
 * potong keduanya (O). Rangka tepi sejajar: selalu ada potongan seperti ini (termasuk keseimbangan simpul).
 */
export function findRitter(p: Params, mem: number): Ritter | null {
  const key = `${p.L}|${p.h}|${p.n}|${Math.round(p.tp)}|${mem}`
  if (ritterCache.has(key)) return ritterCache.get(key)!
  const g = trussGeom(p)
  const { nodes, members } = g.frame
  const target = members[mem]
  let found: Ritter | null = null
  if (target) {
    const bx = [...new Set(nodes.filter((nd) => nd.y < 1e-9).map((nd) => nd.x))].sort((a, b) => a - b)
    const tx = [-Infinity, ...[...new Set(nodes.filter((nd) => nd.y > 1e-9).map((nd) => nd.x))].sort((a, b) => a - b)]
    const horiz = (mi: number) => Math.abs(nodes[members[mi].i].y - nodes[members[mi].j].y) < 1e-9
    // kandidat sisi kiri: potongan bertingkat (simpul bawah x ≤ xb + simpul atas x ≤ xt), lalu keseimbangan simpul
    // (semua simpul kecuali satu) untuk batang yang tak terpotong dengan cara itu (mis. batang tegak tengah)
    const cands: Set<number>[] = []
    for (const xb of bx.slice(0, -1))
      for (const xt of tx) {
        const left = new Set<number>()
        nodes.forEach((nd, k) => {
          if ((nd.y < 1e-9 && nd.x <= xb + 1e-9) || (nd.y > 1e-9 && nd.x <= xt + 1e-9)) left.add(k)
        })
        cands.push(left)
      }
    for (const j of [target.i, target.j]) cands.push(new Set(nodes.map((_, k) => k).filter((k) => k !== j)))
    search: for (const left of cands) {
      const cut = members.map((m, mi) => (left.has(m.i) !== left.has(m.j) ? mi : -1)).filter((mi) => mi >= 0)
      if (!cut.includes(mem) || cut.length > 3 || cut.length < 2) continue
      const others = cut.filter((mi) => mi !== mem)
      const [P, Q] = dirOf(nodes, target, left)
      const d = { x: Q.x - P.x, y: Q.y - P.y }
      const Ld = Math.hypot(d.x, d.y)
      d.x /= Ld
      d.y /= Ld
      if (!horiz(mem) && others.every(horiz)) {
        found = { kind: 'vertikal', cut, left, O: null, den: d.y }
        break search
      }
      // titik momen: perpotongan garis dua batang lain (atau ujung batang lain bila hanya satu)
      let O: { x: number; y: number } | null = null
      if (others.length === 2) O = intersect(nodes, members[others[0]], members[others[1]])
      else {
        const m = members[others[0]]
        for (const k of [m.i, m.j]) if (Math.abs(cross({ x: nodes[k].x - P.x, y: nodes[k].y - P.y }, d)) > 1e-9) O = nodes[k]
      }
      if (!O) continue
      const den = cross({ x: P.x - O.x, y: P.y - O.y }, d)
      if (Math.abs(den) < 1e-9) continue
      found = { kind: 'momen', cut, left, O, den }
      break search
    }
  }
  if (ritterCache.size > 256) ritterCache.clear()
  ritterCache.set(key, found)
  return found
}

const cross = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.y - a.y * b.x

/** Ujung batang di sisi kiri (P) dan kanan (Q): gaya tarik menarik benda kiri ke arah P → Q. */
function dirOf(nodes: { x: number; y: number }[], m: { i: number; j: number }, left: Set<number>) {
  return left.has(m.i) ? [nodes[m.i], nodes[m.j]] : [nodes[m.j], nodes[m.i]]
}

function intersect(nodes: { x: number; y: number }[], a: { i: number; j: number }, b: { i: number; j: number }) {
  const p = nodes[a.i]
  const r = { x: nodes[a.j].x - p.x, y: nodes[a.j].y - p.y }
  const q = nodes[b.i]
  const s = { x: nodes[b.j].x - q.x, y: nodes[b.j].y - q.y }
  const den = cross(r, s)
  if (Math.abs(den) < 1e-12) return null
  const t = cross({ x: q.x - p.x, y: q.y - p.y }, s) / den
  return { x: p.x + t * r.x, y: p.y + t * r.y }
}

/** Gaya batang dari potongan Ritter untuk sekumpulan beban di lantai (tarik +). */
export function ritterForce(p: Params, rt: Ritter, loads: Load[]): number {
  const g = trussGeom(p)
  const nodes = g.frame.nodes
  // gaya luar pada benda kiri: reaksi di simpul tumpuan (0 dan n) yang berada di kiri + beban simpul di sisi kiri
  const F: { x: number; f: number }[] = []
  let RA = 0
  let RB = 0
  for (const l of loads) {
    const R = beamReactions('truss', p, l.x)
    RA += l.P * R[0]
    RB += l.P * R[1]
  }
  if (rt.left.has(0)) F.push({ x: 0, f: RA })
  if (rt.left.has(g.n)) F.push({ x: p.L, f: RB })
  for (const nl of deckNodeLoads(p, loads)) if (rt.left.has(nl.node)) F.push({ x: nodes[nl.node].x, f: -nl.P })
  if (rt.kind === 'vertikal') return -F.reduce((a, b) => a + b.f, 0) / rt.den
  const O = rt.O!
  return -F.reduce((a, b) => a + (b.x - O.x) * b.f, 0) / rt.den
}

// ---------- garis pengaruh & efek beban ----------

/** Ordinat garis pengaruh teori di x (beban satuan). */
export function ilAt(s: Setup, p: Params, resp: string, x: number): number {
  const Lt = trackLength(s, p)
  if (x < -1e-9 || x > Lt + 1e-9) return 0
  if (s === 'truss') {
    if (resp[0] === 'R') return beamReactions(s, p, x)[Number(resp.slice(1))] ?? 0
    const rt = findRitter(p, p.mem)
    return rt ? ritterForce(p, rt, [{ x, P: 1 }]) : NaN
  }
  const R = beamReactions(s, p, x)
  if (resp[0] === 'R') return R[Number(resp.slice(1))] ?? 0
  const vm = sectionVM(supportsX(s, p), R, p.xs, x)
  return resp === 'V' ? vm.V : vm.M
}

/** Kurva garis pengaruh: sampel rapat + tiga titik di tiap titik patah (kiri, tepat, kanan) untuk loncatan. */
export function ilCurve(s: Setup, p: Params, resp: string, n = 240): [number, number][] {
  const Lt = trackLength(s, p)
  const xs = new Set<number>()
  for (let k = 0; k <= n; k++) xs.add((Lt * k) / n)
  const ks = kinks(s, p)
  for (const k of ks) xs.add(k)
  const sorted = [...xs].sort((a, b) => a - b)
  const eps = Lt * 1e-7
  const out: [number, number][] = []
  for (const x of sorted) {
    if (ks.some((k) => Math.abs(k - x) < 1e-12)) {
      if (x > 0) out.push([x, ilAt(s, p, resp, x - eps)])
      out.push([x, ilAt(s, p, resp, x)])
      if (x < Lt) out.push([x, ilAt(s, p, resp, x + eps)])
    } else out.push([x, ilAt(s, p, resp, x)])
  }
  return out
}

export interface IlStats {
  max: number
  xMax: number
  min: number
  xMin: number
  pos: number // luas positif (m atau m², sesuai respons)
  neg: number // luas negatif (≤ 0)
}

export function ilStats(curve: [number, number][]): IlStats {
  let max = 0
  let min = 0
  let xMax = curve[0]?.[0] ?? 0
  let xMin = xMax
  let pos = 0
  let neg = 0
  for (let k = 0; k < curve.length; k++) {
    const [x, y] = curve[k]
    if (y > max) {
      max = y
      xMax = x
    }
    if (y < min) {
      min = y
      xMin = x
    }
    if (k === 0) continue
    const [x0, y0] = curve[k - 1]
    const dx = x - x0
    if (dx <= 0) continue
    // trapesium dengan pemisahan di titik nol
    if (y0 >= 0 && y >= 0) pos += ((y0 + y) / 2) * dx
    else if (y0 <= 0 && y <= 0) neg += ((y0 + y) / 2) * dx
    else {
      const xz = (y0 / (y0 - y)) * dx
      if (y0 > 0) {
        pos += (y0 * xz) / 2
        neg += (y * (dx - xz)) / 2
      } else {
        neg += (y0 * xz) / 2
        pos += (y * (dx - xz)) / 2
      }
    }
  }
  return { max, xMax, min, xMin, pos, neg }
}

/** Efek sekumpulan beban lewat garis pengaruh: Σ Pᵢ·η(xᵢ). */
export const ilEffect = (s: Setup, p: Params, resp: string, loads: Load[]) => loads.reduce((a, l) => a + l.P * ilAt(s, p, resp, l.x), 0)

export interface Extreme {
  X: number
  dir: 1 | -1
  val: number
}

/** Posisi truk paling menentukan (maks + dan min −) untuk kedua arah: gandar di titik patah + sapuan rapat. */
export function truckExtremes(s: Setup, p: Params, resp: string, axlesOf: (dir: 1 | -1) => Axle[]) {
  const Lt = trackLength(s, p)
  const ks = kinks(s, p)
  let max: Extreme = { X: 0, dir: 1, val: 0 }
  let min: Extreme = { X: 0, dir: 1, val: 0 }
  for (const dir of [1, -1] as const) {
    const ax = axlesOf(dir)
    const offs = ax.map((a) => a.off)
    const lo = -Math.max(...offs)
    const hi = Lt - Math.min(...offs)
    const cand: number[] = []
    for (const k of ks) for (const o of offs) cand.push(k - o, k - o - 1e-7 * Lt, k - o + 1e-7 * Lt)
    for (let k = 0; k <= 400; k++) cand.push(lo + ((hi - lo) * k) / 400)
    for (const X of cand) {
      if (X < lo - 1e-9 || X > hi + 1e-9) continue
      const v = ax.reduce((a, l) => a + l.P * ilAt(s, p, resp, X + l.off), 0)
      if (v > max.val) max = { X, dir, val: v }
      if (v < min.val) min = { X, dir, val: v }
    }
  }
  return { max, min }
}
