// Properti penampang tersusun dari bagian persegi panjang dan lingkaran (lubang = tanda −1), satuan mm.
// Semua besaran dihitung eksak (rumus tertutup per bagian + teorema sumbu sejajar / Steiner); `gridScan` adalah
// integrasi numerik "kertas milimeter" sebagai pembanding.
//
// Aturan bagian: bagian positif tidak saling tumpang tindih; lubang selalu berada di dalam bagian positif.
// Sumbu: x ke kanan, y ke atas. Konvensi beban (Room Section):
//   N > 0 tarik · Mx > 0 → serat atas (+y) tertekan · My > 0 → serat kanan (+x) tertekan
//   σ(x, y) = s0 + a·(x − xc) + b·(y − yc), dengan [Iy Ixy; Ixy Ix]·[a; b] = −[My; Mx]   (lentur tak simetris umum)

export type Part =
  | { kind: 'rect'; name: string; x: number; y: number; w: number; h: number; sign: 1 | -1 } // (x, y) = pusat
  | { kind: 'circ'; name: string; x: number; y: number; r: number; sign: 1 | -1 }

export interface PartProps {
  A: number // bertanda (lubang negatif)
  cx: number
  cy: number
  Ix0: number // terhadap sumbu berat bagian itu sendiri (bertanda)
  Iy0: number
}

export function partProps(p: Part): PartProps {
  if (p.kind === 'rect') {
    const A = p.w * p.h
    return { A: p.sign * A, cx: p.x, cy: p.y, Ix0: (p.sign * p.w * p.h ** 3) / 12, Iy0: (p.sign * p.h * p.w ** 3) / 12 }
  }
  const A = Math.PI * p.r * p.r
  const I = (Math.PI * p.r ** 4) / 4
  return { A: p.sign * A, cx: p.x, cy: p.y, Ix0: p.sign * I, Iy0: p.sign * I }
}

export interface Props {
  A: number
  xc: number
  yc: number
  /** momen inersia & produk inersia terhadap sumbu berat */
  Ix: number
  Iy: number
  Ixy: number
  /** inersia utama (I1 ≥ I2) dan sudut sumbu 1 dari sumbu x (derajat, berlawanan jarum jam) */
  I1: number
  I2: number
  thP: number
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  /** modulus penampang elastis: atas/bawah (terhadap x), kiri/kanan (terhadap y) */
  Sxt: number
  Sxb: number
  Syl: number
  Syr: number
  rx: number
  ry: number
}

export function bounds(parts: Part[]) {
  let xmin = Infinity
  let xmax = -Infinity
  let ymin = Infinity
  let ymax = -Infinity
  for (const p of parts) {
    if (p.sign < 0) continue
    const hx = p.kind === 'rect' ? p.w / 2 : p.r
    const hy = p.kind === 'rect' ? p.h / 2 : p.r
    xmin = Math.min(xmin, p.x - hx)
    xmax = Math.max(xmax, p.x + hx)
    ymin = Math.min(ymin, p.y - hy)
    ymax = Math.max(ymax, p.y + hy)
  }
  return { xmin, xmax, ymin, ymax }
}

export function props(parts: Part[]): Props {
  let A = 0
  let Sx = 0
  let Sy = 0
  for (const p of parts) {
    const q = partProps(p)
    A += q.A
    Sx += q.A * q.cy
    Sy += q.A * q.cx
  }
  const xc = Sy / A
  const yc = Sx / A
  let Ix = 0
  let Iy = 0
  let Ixy = 0
  for (const p of parts) {
    const q = partProps(p)
    const dx = q.cx - xc
    const dy = q.cy - yc
    Ix += q.Ix0 + q.A * dy * dy
    Iy += q.Iy0 + q.A * dx * dx
    Ixy += q.A * dx * dy // bagian persegi & lingkaran simetris → Ixy sendiri = 0
  }
  const avg = (Ix + Iy) / 2
  const R = Math.hypot((Ix - Iy) / 2, Ixy)
  const thP = (0.5 * Math.atan2(-2 * Ixy, Ix - Iy) * 180) / Math.PI
  const b = bounds(parts)
  return {
    A,
    xc,
    yc,
    Ix,
    Iy,
    Ixy,
    I1: avg + R,
    I2: avg - R,
    thP: R < 1e-9 * avg ? 0 : thP,
    ...b,
    Sxt: Ix / (b.ymax - yc),
    Sxb: Ix / (yc - b.ymin),
    Syl: Iy / (xc - b.xmin),
    Syr: Iy / (b.xmax - xc),
    rx: Math.sqrt(Ix / A),
    ry: Math.sqrt(Iy / A),
  }
}

/** Inersia terhadap sumbu u–v yang diputar θ (derajat, berlawanan jarum jam) dari x–y, melalui titik berat. */
export function rotated(pr: Props, thDeg: number) {
  const t = (2 * thDeg * Math.PI) / 180
  const avg = (pr.Ix + pr.Iy) / 2
  const d = (pr.Ix - pr.Iy) / 2
  return {
    Iu: avg + d * Math.cos(t) - pr.Ixy * Math.sin(t),
    Iv: avg - d * Math.cos(t) + pr.Ixy * Math.sin(t),
    Iuv: d * Math.sin(t) + pr.Ixy * Math.cos(t),
  }
}

/** Σ tanda bagian yang memuat titik (1 = material, 0 = kosong). */
export function inside(parts: Part[], x: number, y: number) {
  let s = 0
  for (const p of parts) {
    const ins = p.kind === 'rect' ? Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2 : (x - p.x) ** 2 + (y - p.y) ** 2 <= p.r * p.r
    if (ins) s += p.sign
  }
  return s
}

/** Integrasi numerik grid n×n (titik tengah sel) — "menghitung kotak di kertas milimeter". */
export function gridScan(parts: Part[], n = 400) {
  const b = bounds(parts)
  const hx = (b.xmax - b.xmin) / n
  const hy = (b.ymax - b.ymin) / n
  const dA = hx * hy
  let A = 0
  let sx = 0
  let sy = 0
  let xx = 0
  let yy = 0
  let xy = 0
  for (let i = 0; i < n; i++) {
    const x = b.xmin + (i + 0.5) * hx
    for (let j = 0; j < n; j++) {
      const y = b.ymin + (j + 0.5) * hy
      const s = inside(parts, x, y)
      if (s <= 0) continue
      A += dA
      sx += x * dA
      sy += y * dA
      xx += x * x * dA
      yy += y * y * dA
      xy += x * y * dA
    }
  }
  const xc = sx / A
  const yc = sy / A
  return { A, xc, yc, Ix: yy - A * yc * yc, Iy: xx - A * xc * xc, Ixy: xy - A * xc * yc }
}

/** Lebar total penampang pada garis horizontal y (lubang mengurangi). */
export function width(parts: Part[], y: number) {
  let b = 0
  for (const p of parts) {
    if (p.kind === 'rect') {
      if (Math.abs(y - p.y) <= p.h / 2) b += p.sign * p.w
    } else {
      const d = y - p.y
      if (Math.abs(d) < p.r) b += p.sign * 2 * Math.sqrt(p.r * p.r - d * d)
    }
  }
  return Math.max(0, b)
}

/** Luas dan momen pertama (∫y dA, ∫x dA, terhadap titik asal) bagian penampang di atas garis y. Eksak. */
export function above(parts: Part[], y: number) {
  let A = 0
  let My = 0 // ∫ y dA
  let Mx = 0 // ∫ x dA
  for (const p of parts) {
    if (p.kind === 'rect') {
      const top = p.y + p.h / 2
      const lo = Math.max(y, p.y - p.h / 2)
      if (lo >= top) continue
      const a = p.sign * p.w * (top - lo)
      A += a
      My += a * (top + lo) / 2
      Mx += a * p.x
    } else {
      const d = Math.max(-p.r, Math.min(p.r, y - p.y))
      const s = Math.sqrt(p.r * p.r - d * d)
      const a = p.sign * (p.r * p.r * Math.acos(d / p.r) - d * s)
      const m = (p.sign * 2 * s ** 3) / 3 // momen pertama segmen terhadap pusat lingkaran
      A += a
      My += a * p.y + m
      Mx += a * p.x
    }
  }
  return { A, My, Mx }
}

/** Tukar sumbu x ↔ y (untuk menghitung besaran terhadap sumbu y dengan fungsi sumbu x). */
export function swapXY(parts: Part[]): Part[] {
  return parts.map((p) => (p.kind === 'rect' ? { ...p, x: p.y, y: p.x, w: p.h, h: p.w } : { ...p, x: p.y, y: p.x }))
}

/**
 * Lentur plastis terhadap sumbu horizontal: garis netral plastis yp membagi luas sama besar (tarik = tekan),
 * Z = ∫|y − yp| dA.
 */
export function plasticX(parts: Part[]) {
  const b = bounds(parts)
  const tot = above(parts, b.ymin - 1)
  let lo = b.ymin
  let hi = b.ymax
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2
    if (above(parts, mid).A > tot.A / 2) lo = mid
    else hi = mid
  }
  const yp = (lo + hi) / 2
  const up = above(parts, yp)
  const Z = up.My - yp * up.A + (yp * (tot.A - up.A) - (tot.My - up.My))
  return { yp, Z }
}

export function plastic(parts: Part[]) {
  const x = plasticX(parts)
  const y = plasticX(swapXY(parts))
  return { yp: x.yp, Zx: x.Z, xp: y.yp, Zy: y.Z }
}

// ---------- tegangan geser lentur ----------

/** Q terhadap sumbu berat (momen pertama bagian di atas y): Qx = ∫(y − yc) dA, Qy = ∫(x − xc) dA. */
export function Q(parts: Part[], pr: Props, y: number) {
  const a = above(parts, y)
  return { Aab: a.A, Qx: a.My - pr.yc * a.A, Qy: a.Mx - pr.xc * a.A }
}

/**
 * Tegangan geser rata-rata selebar potongan horizontal y akibat gaya lintang vertikal V (N):
 * τ·b = V·(Iy·Qx − Ixy·Qy)/(Ix·Iy − Ixy²) — untuk Ixy = 0 menjadi V·Q/(I·b).
 */
export function tauAt(parts: Part[], pr: Props, V: number, y: number, b = width(parts, y)) {
  if (b <= 1e-9) return 0
  const q = Q(parts, pr, y)
  const q1 = (V * (pr.Iy * q.Qx - pr.Ixy * q.Qy)) / (pr.Ix * pr.Iy - pr.Ixy * pr.Ixy)
  return q1 / b
}

/** Titik-titik kurva τ(y) dari atas ke bawah; di loncatan lebar (sayap–badan) ada dua titik pada y yang sama. */
export function shearProfile(parts: Part[], pr: Props, V: number, n = 240) {
  const ys = new Set<number>()
  for (let k = 0; k <= n; k++) ys.add(pr.ymin + ((pr.ymax - pr.ymin) * k) / n)
  for (const p of parts) {
    const hy = p.kind === 'rect' ? p.h / 2 : p.r
    for (const v of [p.y - hy, p.y + hy]) if (v > pr.ymin && v < pr.ymax) ys.add(v)
  }
  ys.add(pr.yc)
  const eps = (pr.ymax - pr.ymin) * 1e-7
  const pts: { y: number; tau: number; b: number }[] = []
  for (const y of [...ys].sort((a, b) => b - a)) {
    const bu = width(parts, Math.min(pr.ymax, y + eps))
    const bd = width(parts, Math.max(pr.ymin, y - eps))
    if (Math.abs(bu - bd) > 1e-6 * Math.max(bu, bd, 1)) {
      pts.push({ y, b: bu, tau: tauAt(parts, pr, V, y, bu) })
      pts.push({ y, b: bd, tau: tauAt(parts, pr, V, y, bd) })
    } else pts.push({ y, b: bu, tau: tauAt(parts, pr, V, y, bu) })
  }
  return pts
}

// ---------- tegangan normal (aksial + lentur dua arah) ----------

export interface Plane {
  s0: number // N/A (MPa)
  a: number // ∂σ/∂x (MPa/mm)
  b: number // ∂σ/∂y
}

/** N dalam kN, Mx/My dalam kN·m → σ dalam MPa. */
export function stressPlane(pr: Props, N: number, Mx: number, My: number): Plane {
  const det = pr.Ix * pr.Iy - pr.Ixy * pr.Ixy
  const rx = -My * 1e6
  const ry = -Mx * 1e6
  return { s0: (N * 1e3) / pr.A, a: (pr.Ix * rx - pr.Ixy * ry) / det, b: (pr.Iy * ry - pr.Ixy * rx) / det }
}

export const sigma = (pl: Plane, pr: Props, x: number, y: number) => pl.s0 + pl.a * (x - pr.xc) + pl.b * (y - pr.yc)

/** Selubung cembung titik sudut bagian positif (lingkaran didekati 72 titik), berlawanan jarum jam. */
export function hull(parts: Part[]): [number, number][] {
  const pts: [number, number][] = []
  for (const p of parts) {
    if (p.sign < 0) continue
    if (p.kind === 'rect')
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push([p.x + (sx * p.w) / 2, p.y + (sy * p.h) / 2])
    else for (let k = 0; k < 72; k++) pts.push([p.x + p.r * Math.cos((k * Math.PI) / 36), p.y + p.r * Math.sin((k * Math.PI) / 36)])
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/** Tegangan ekstrem terjadi di titik sudut selubung (σ linear). */
export function extremes(pl: Plane, pr: Props, h: [number, number][]) {
  let max = { s: -Infinity, x: 0, y: 0 }
  let min = { s: Infinity, x: 0, y: 0 }
  for (const [x, y] of h) {
    const s = sigma(pl, pr, x, y)
    if (s > max.s + 1e-9) max = { s, x, y }
    if (s < min.s - 1e-9) min = { s, x, y }
  }
  return { max, min }
}

/**
 * Inti penampang (kern): daerah titik tangkap gaya aksial yang membuat seluruh penampang bertanda sama.
 * Tiap sisi selubung n·r = d (n normal keluar, r dari titik berat) sebagai garis netral → titik e = −J·n/(A·d),
 * J = [Iy Ixy; Ixy Ix].
 */
export function kern(pr: Props, h: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (let k = 0; k < h.length; k++) {
    const [x1, y1] = h[k]
    const [x2, y2] = h[(k + 1) % h.length]
    const L = Math.hypot(x2 - x1, y2 - y1)
    if (L < 1e-9) continue
    const nx = (y2 - y1) / L
    const ny = -(x2 - x1) / L
    const d = nx * (x1 - pr.xc) + ny * (y1 - pr.yc)
    if (d <= 1e-9) continue
    out.push([pr.xc - (pr.Iy * nx + pr.Ixy * ny) / (pr.A * d), pr.yc - (pr.Ixy * nx + pr.Ix * ny) / (pr.A * d)])
  }
  return out
}

/** Titik tangkap resultan gaya aksial (mm, koordinat global) bila N ≠ 0: Mx = −N·ey, My = −N·ex. */
export function resultantPoint(pr: Props, N: number, Mx: number, My: number) {
  if (Math.abs(N) < 1e-9) return null
  return { x: pr.xc - (My * 1e3) / N, y: pr.yc - (Mx * 1e3) / N }
}
