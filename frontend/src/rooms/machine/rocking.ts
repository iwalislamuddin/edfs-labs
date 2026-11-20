// Pondasi blok kaku di atas tanah dengan 3 derajat kebebasan di titik berat (CG): geser x, vertikal z, rocking ψ.
//   M·ẍ = Fx − H,  M·z̈ = Fz − V,  Ic·ψ̈ = Mc − Mψ + zc·H
// dengan reaksi tanah di pusat dasar: H = kx·xb + cx·ẋb (xb = x + zc·ψ), V = kz·z + cz·ż, Mψ = kψ·ψ + cψ·ψ̇.
// Konvensi: x ke kanan, z ke atas, ψ berlawanan jarum jam. Titik (dx, dz) relatif CG bergeser (x − dz·ψ, z + dx·ψ).
// Analog Lysmer/Hall (Richart–Hall–Woods), konstanta tidak bergantung frekuensi; tanpa penanaman (embedment).
// Pondasi meja (table-top): pelat kaku di atas 4 kolom beton jepit–jepit setinggi hc — sway + vertikal + rocking,
// redaman modal ζ sama untuk semua mode (lihat tableSystem).
// Fisika murni, diuji di rocking.test.ts.

import { jacobiEigen, type Mat } from '../../lab/mdof'
import { crank, type Machine, type Soil } from './physics'

export const RHO_C = 2400 // kg/m³ beton

export interface Block {
  L: number // panjang dasar searah gaya horizontal (tegak lurus poros), m
  B: number // lebar dasar searah poros, m
  H: number // tebal blok, m
}

export interface Placement {
  Mm: number // massa mesin (kg), dianggap terpusat di ketinggian poros
  hs: number // tinggi poros di atas muka atas blok (m)
  ex: number // offset horizontal poros dari pusat blok (m)
}

export interface Sys3 {
  M: number
  Ic: number
  /** Matriks massa diagonal [M, M, Ic], kekakuan & redaman 3×3 untuk q = [x, z, ψ]. */
  m: [number, number, number]
  K: Mat
  C: Mat
  zc: number // tinggi CG di atas dasar
  /** Posisi bantalan relatif CG. */
  dx: number
  dz: number
  /** Besaran tanah per arah. */
  kx: number
  cx: number
  kz: number
  cz: number
  kp: number
  cp: number
  r0: number
  r0p: number
  Mb: number
  Bz: number
  Bp: number
  /** Kedalaman bidang dasar di bawah CG untuk momen guling (blok: dasar blok, meja: kaki kolom). */
  zb: number
}

/** Massa, CG, dan inersia blok/pelat beton + mesin terpusat di ketinggian poros. */
export function massProps(b: Block, pl: Placement) {
  const Mb = RHO_C * b.L * b.B * b.H
  const M = Mb + pl.Mm
  const zm = b.H + pl.hs
  const zc = (Mb * (b.H / 2) + pl.Mm * zm) / M
  const xc = (pl.Mm * pl.ex) / M
  // momen inersia massa terhadap sumbu sejajar poros melalui CG
  const Ic =
    (Mb * (b.L * b.L + b.H * b.H)) / 12 + Mb * ((b.H / 2 - zc) ** 2 + xc * xc) + pl.Mm * ((zm - zc) ** 2 + (pl.ex - xc) ** 2)
  return { Mb, M, zm, zc, xc, Ic }
}

/** Membangun sistem 3DOF blok + mesin di atas tanah. */
export function blockSystem(b: Block, pl: Placement, s: Soil): Sys3 {
  const { Mb, M, zm, zc, xc, Ic } = massProps(b, pl)
  const I0 = Ic + M * zc * zc // terhadap sumbu di dasar
  const r0 = Math.sqrt((b.L * b.B) / Math.PI)
  const r0p = Math.pow((b.B * b.L ** 3) / (3 * Math.PI), 0.25)
  const sq = Math.sqrt(s.rho * s.G)
  const kz = (4 * s.G * r0) / (1 - s.nu)
  const cz = (3.4 * r0 * r0 * sq) / (1 - s.nu)
  const kx = (32 * (1 - s.nu) * s.G * r0) / (7 - 8 * s.nu)
  const cx = (18.4 * (1 - s.nu) * r0 * r0 * sq) / (7 - 8 * s.nu)
  const Bp = (3 * (1 - s.nu) * I0) / (8 * s.rho * r0p ** 5)
  const kp = (8 * s.G * r0p ** 3) / (3 * (1 - s.nu))
  const cp = (0.8 * r0p ** 4 * sq) / ((1 - s.nu) * (1 + Bp))
  const K: Mat = [
    [kx, 0, kx * zc],
    [0, kz, 0],
    [kx * zc, 0, kp + kx * zc * zc],
  ]
  const C: Mat = [
    [cx, 0, cx * zc],
    [0, cz, 0],
    [cx * zc, 0, cp + cx * zc * zc],
  ]
  return {
    M,
    Ic,
    m: [M, M, Ic],
    K,
    C,
    zc,
    dx: pl.ex - xc,
    dz: zm - zc,
    kx,
    cx,
    kz,
    cz,
    kp,
    cp,
    r0,
    r0p,
    Mb,
    Bz: ((1 - s.nu) * M) / (4 * s.rho * r0 ** 3),
    Bp,
    zb: zc,
  }
}

export interface Columns {
  hc: number // tinggi bersih kolom (kaki → bawah pelat), m
  bc: number // sisi kolom persegi, m
  E: number // modulus elastisitas, Pa
}

/**
 * Kekakuan 3×3 pelat kaku di atas kolom jepit–jepit, q = [x, z, ψ] di CG (zc di atas bawah pelat).
 * Tiap kolom: ujung atas U = x + zc·ψ, kemiringan u' = −ψ; matriks ujung balok 12EI/h³·[[1, −h/2], [−h/2, h²/3]].
 * kx = Σ12EI/h³, kz = ΣEA/h, kolom di x = ±a (rocking aksial kz·a²).
 */
export function tableK(kx: number, kz: number, a: number, zc: number, hc: number): Mat {
  const e = zc + hc / 2
  return [
    [kx, 0, kx * e],
    [0, kz, 0],
    [kx * e, 0, kx * (zc * zc + hc * zc + (hc * hc) / 3) + kz * a * a],
  ]
}

/** Redaman klasik dengan rasio ζ sama di semua mode: C = M½·V·diag(2ζω)·Vᵀ·M½. */
export function modalDamping(m: number[], K: Mat, zeta: number): Mat {
  const r = m.map((v) => 1 / Math.sqrt(v))
  const { vals, vecs } = jacobiEigen(K.map((row, i) => row.map((v, j) => v * r[i] * r[j])))
  const n = m.length
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let c = 0
      for (let k = 0; k < n; k++) c += vecs[i][k] * 2 * zeta * Math.sqrt(Math.max(vals[k], 0)) * vecs[j][k]
      return c * Math.sqrt(m[i] * m[j])
    }),
  )
}

/** Pondasi meja: pelat L×B×H di atas 4 kolom persegi di sudut (x = ±a), mesin di atas pelat. */
export function tableSystem(b: Block, pl: Placement, col: Columns, zeta: number): Sys3 {
  const { Mb, M, zm, zc, xc, Ic } = massProps(b, pl)
  const n = 4
  const A = col.bc * col.bc
  const I = col.bc ** 4 / 12
  const kz = (n * col.E * A) / col.hc
  const kx = (n * 12 * col.E * I) / col.hc ** 3
  const a = Math.max(0.1, b.L / 2 - col.bc / 2)
  const K = tableK(kx, kz, a, zc, col.hc)
  const m: [number, number, number] = [M, M, Ic]
  const C = modalDamping(m, K, zeta)
  return {
    M,
    Ic,
    m,
    K,
    C,
    zc,
    dx: pl.ex - xc,
    dz: zm - zc,
    kx,
    cx: C[0][0],
    kz,
    cz: C[1][1],
    kp: kz * a * a,
    cp: 0,
    r0: a,
    r0p: 0,
    Mb,
    Bz: 0,
    Bp: 0,
    zb: zc + col.hc,
  }
}

/** Gaya mesin di bantalan: [Fx, Fz] (N). Komponen horizontal dari massa berputar (rotor / engkol). */
export function machineForces(m: Machine, th: number, w: number, a: number): [number, number] {
  const sn = Math.sin(th)
  const cs = Math.cos(th)
  if (m.kind === 'rotasi') return [m.me * (w * w * sn - a * cs), m.me * (w * w * cs + a * sn)]
  const { x1, x2 } = crank(m.r, m.l, th)
  const xdd = x2 * w * w + x1 * a
  const rot = m.mRot * m.r
  return [rot * (w * w * sn - a * cs), -m.mRec * xdd + rot * (w * w * cs + a * sn)]
}

/** Gaya umum q = [x, z, ψ] dari gaya di bantalan (dx, dz relatif CG). */
const genForce = (s: Sys3, fx: number, fz: number): [number, number, number] => [fx, fz, s.dx * fz - s.dz * fx]

export interface Mode3 {
  w: number
  zeta: number
  /** Bentuk mode [x, z, ψ]. */
  phi: number[]
  kind: 'vertikal' | 'geser–rocking 1' | 'geser–rocking 2'
}

/** Mode tak teredam + perkiraan rasio redaman modal ζn = φᵀCφ / (2ωn·φᵀMφ). */
export function modes3(s: Sys3): Mode3[] {
  const r = s.m.map((v) => 1 / Math.sqrt(v))
  const A = s.K.map((row, i) => row.map((v, j) => v * r[i] * r[j]))
  const { vals, vecs } = jacobiEigen(A)
  const out = vals.map((lam, i) => {
    const v = vecs.map((row) => row[i]) // ternormalisasi: vᵀv = 1
    const phi = v.map((x, j) => x * r[j])
    let cc = 0
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cc += phi[a] * s.C[a][b] * phi[b]
    const w = Math.sqrt(Math.max(lam, 0))
    return { w, zeta: cc / (2 * w), phi, vert: Math.abs(v[1]) > 0.99 }
  })
  out.sort((a, b) => a.w - b.w)
  let k = 0
  return out.map((o): Mode3 => ({
    w: o.w,
    zeta: o.zeta,
    phi: o.phi,
    kind: o.vert ? 'vertikal' : ++k === 1 ? 'geser–rocking 1' : 'geser–rocking 2',
  }))
}

// ---- aljabar kompleks kecil ----

export type Cx = [number, number]
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const cdiv = (a: Cx, b: Cx): Cx => {
  const d = b[0] * b[0] + b[1] * b[1]
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}
const csub = (a: Cx, b: Cx): Cx => [a[0] - b[0], a[1] - b[1]]

/** Menyelesaikan (K − ω²M + iωC)·X = F (kompleks 3×3). */
function solveC(s: Sys3, w: number, F: Cx[]): Cx[] {
  const n = 3
  const A: Cx[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j): Cx => [s.K[i][j] - (i === j ? w * w * s.m[i] : 0), w * s.C[i][j]]),
  )
  const b = F.map((f): Cx => [f[0], f[1]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.hypot(...A[r][c]) > Math.hypot(...A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    ;[b[c], b[p]] = [b[p], b[c]]
    for (let r = c + 1; r < n; r++) {
      const f = cdiv(A[r][c], A[c][c])
      for (let k = c; k < n; k++) A[r][k] = csub(A[r][k], cmul(f, A[c][k]))
      b[r] = csub(b[r], cmul(f, b[c]))
    }
  }
  const x: Cx[] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ]
  for (let r = n - 1; r >= 0; r--) {
    let acc = b[r]
    for (let k = r + 1; k < n; k++) acc = csub(acc, cmul(A[r][k], x[k]))
    x[r] = cdiv(acc, A[r][r])
  }
  return x
}

export interface Steady3 {
  /** Amplitudo maksimum di bantalan: horizontal, vertikal (m). */
  hx: number
  hz: number
  /** Amplitudo rocking (rad) dan geser di dasar (m). */
  psi: number
  xb: number
  /** Kecepatan puncak terbesar di bantalan (m/s). */
  v: number
  /** Gaya horizontal & momen ke tanah (amplitudo maksimum). */
  H: number
  Mo: number
  V: number
}

/**
 * Respons tunak di bantalan untuk putaran ω: superposisi harmonik 1 (gaya horizontal + vertikal) dan 2 (vertikal, torak),
 * maksimum diambil dengan menyampel satu putaran.
 */
/** Amplitudo kompleks q = Re(X1·e^{iθ} + X2·e^{2iθ}) untuk putaran ω tetap. */
export function harmonics3(s: Sys3, m: Machine, w: number): { X1: Cx[]; X2: Cx[] | null } {
  // gaya kompleks: Re(F̂·e^{iθ}); cos θ → 1, sin θ → −i
  let F1x: Cx
  let F1z: Cx
  let F2z: Cx = [0, 0]
  if (m.kind === 'rotasi') {
    const f = m.me * w * w
    F1x = [0, -f]
    F1z = [f, 0]
  } else {
    const fr = m.mRot * m.r * w * w
    F1x = [0, -fr]
    F1z = [(m.mRec + m.mRot) * m.r * w * w, 0]
    F2z = [m.mRec * m.r * w * w * (m.r / m.l), 0]
  }
  const g = (fx: Cx, fz: Cx): Cx[] => [fx, fz, csub(cmul([s.dx, 0], fz), cmul([s.dz, 0], fx))]
  const X1 = solveC(s, w, g(F1x, F1z))
  const X2 = F2z[0] !== 0 ? solveC(s, 2 * w, g([0, 0], F2z)) : null
  return { X1, X2 }
}

/** Keadaan tunak (q, q̇) pada sudut engkol/rotor θ. */
export function steadyState3(s: Sys3, m: Machine, w: number, th: number): { q: number[]; v: number[] } {
  if (w <= 0) return { q: [0, 0, 0], v: [0, 0, 0] }
  const { X1, X2 } = harmonics3(s, m, w)
  const q = [0, 1, 2].map((k) => X1[k][0] * Math.cos(th) - X1[k][1] * Math.sin(th) + (X2 ? X2[k][0] * Math.cos(2 * th) - X2[k][1] * Math.sin(2 * th) : 0))
  const v = [0, 1, 2].map(
    (k) => -w * (X1[k][0] * Math.sin(th) + X1[k][1] * Math.cos(th)) - (X2 ? 2 * w * (X2[k][0] * Math.sin(2 * th) + X2[k][1] * Math.cos(2 * th)) : 0),
  )
  return { q, v }
}

export function steady3(s: Sys3, m: Machine, w: number): Steady3 {
  if (w <= 0) return { hx: 0, hz: 0, psi: 0, xb: 0, v: 0, H: 0, Mo: 0, V: 0 }
  const { X1, X2 } = harmonics3(s, m, w)
  const at = (X: Cx[], k: number, th: number, n: number) => X[k][0] * Math.cos(n * th) - X[k][1] * Math.sin(n * th)
  const dat = (X: Cx[], k: number, th: number, n: number) => -n * w * (X[k][0] * Math.sin(n * th) + X[k][1] * Math.cos(n * th))
  const out: Steady3 = { hx: 0, hz: 0, psi: 0, xb: 0, v: 0, H: 0, Mo: 0, V: 0 }
  for (let i = 0; i < 360; i++) {
    const th = (i / 360) * 2 * Math.PI
    const q = [0, 1, 2].map((k) => at(X1, k, th, 1) + (X2 ? at(X2, k, th, 2) : 0))
    const qd = [0, 1, 2].map((k) => dat(X1, k, th, 1) + (X2 ? dat(X2, k, th, 2) : 0))
    const hx = q[0] - s.dz * q[2]
    const hz = q[1] + s.dx * q[2]
    const vx = qd[0] - s.dz * qd[2]
    const vz = qd[1] + s.dx * qd[2]
    const xb = q[0] + s.zc * q[2]
    out.hx = Math.max(out.hx, Math.abs(hx))
    out.hz = Math.max(out.hz, Math.abs(hz))
    out.psi = Math.max(out.psi, Math.abs(q[2]))
    out.xb = Math.max(out.xb, Math.abs(xb))
    out.v = Math.max(out.v, Math.hypot(vx, vz))
    // reaksi tumpuan = K·q + C·q̇ (baris x: geser total, z: vertikal, ψ: momen terhadap CG)
    const R = [0, 1, 2].map((i) => [0, 1, 2].reduce((acc, j) => acc + s.K[i][j] * q[j] + s.C[i][j] * qd[j], 0))
    out.H = Math.max(out.H, Math.abs(R[0]))
    out.V = Math.max(out.V, Math.abs(R[1]))
    out.Mo = Math.max(out.Mo, Math.abs(R[2] - s.zb * R[0]))
  }
  return out
}

// ---- integrasi waktu ----

/** Keadaan: q = [x, z, ψ], v = [ẋ, ż, ψ̇], sudut & kecepatan putar. */
export interface State3 {
  q: number[]
  v: number[]
  th: number
  w: number
}

function deriv(s: Sys3, m: Machine, x: State3, a: number) {
  const [fx, fz] = machineForces(m, x.th, x.w, a)
  const f = genForce(s, fx, fz)
  const acc = [0, 1, 2].map((i) => {
    let r = f[i]
    for (let j = 0; j < 3; j++) r -= s.K[i][j] * x.q[j] + s.C[i][j] * x.v[j]
    return r / s.m[i]
  })
  return { q: x.v, v: acc, th: x.w, w: a }
}

export function step3(s: Sys3, m: Machine, x: State3, a: number, h: number): State3 {
  const add = (b: State3, k: ReturnType<typeof deriv>, c: number): State3 => ({
    q: b.q.map((v, i) => v + c * k.q[i]),
    v: b.v.map((v, i) => v + c * k.v[i]),
    th: b.th + c * k.th,
    w: b.w + c * k.w,
  })
  const k1 = deriv(s, m, x, a)
  const k2 = deriv(s, m, add(x, k1, h / 2), a)
  const k3 = deriv(s, m, add(x, k2, h / 2), a)
  const k4 = deriv(s, m, add(x, k3, h), a)
  const out: State3 = {
    q: x.q.map((v, i) => v + (h / 6) * (k1.q[i] + 2 * k2.q[i] + 2 * k3.q[i] + k4.q[i])),
    v: x.v.map((v, i) => v + (h / 6) * (k1.v[i] + 2 * k2.v[i] + 2 * k3.v[i] + k4.v[i])),
    th: x.th + (h / 6) * (k1.th + 2 * k2.th + 2 * k3.th + k4.th),
    w: x.w + (h / 6) * (k1.w + 2 * k2.w + 2 * k3.w + k4.w),
  }
  if (out.th > 1e4) out.th -= Math.floor(out.th / (2 * Math.PI)) * 2 * Math.PI
  return out
}

/** Simpangan bantalan [horizontal, vertikal] dari keadaan. */
export const bearing = (s: Sys3, q: number[]): [number, number] => [q[0] - s.dz * q[2], q[1] + s.dx * q[2]]
