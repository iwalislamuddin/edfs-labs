// Isolasi dasar: struktur SDOF (m, k, c) di atas lantai dasar mb yang ditumpu isolator (kb, cb).
// Koordinat relatif: ub = simpangan isolator terhadap tanah, us = simpangan struktur terhadap lantai dasar.
//   mb(ag + üb) = −cb·u̇b − kb·ub + c·u̇s + k·us
//   m(ag + üb + üs) = −c·u̇s − k·us
// Percepatan mutlak atap = −(c·u̇s + k·us)/m. Fisika murni, diuji di isolation.test.ts.

export interface IsoParams {
  T: number // periode struktur terjepit (s)
  zeta: number // redaman struktur
  Tiso: number // periode isolasi (struktur dianggap kaku), s
  zetaIso: number // redaman isolator
  mbRatio: number // mb/m
}

export interface IsoSystem {
  m: number
  k: number
  c: number
  mb: number
  kb: number
  cb: number
}

/** Sistem ternormalisasi m = 1. */
export function isoSystem(p: IsoParams): IsoSystem {
  const m = 1
  const w = (2 * Math.PI) / p.T
  const mb = p.mbRatio * m
  const wb = (2 * Math.PI) / p.Tiso
  const M = m + mb
  return { m, k: m * w * w, c: 2 * p.zeta * m * w, mb, kb: M * wb * wb, cb: 2 * p.zetaIso * M * wb }
}

/** Turunan keadaan y = [ub, us, vb, vs] untuk percepatan tanah ag. */
export function isoDeriv(s: IsoSystem, y: number[], ag: number): number[] {
  const [ub, us, vb, vs] = y
  const fs = s.c * vs + s.k * us
  const ab = -ag + (-s.cb * vb - s.kb * ub + fs) / s.mb
  const as = -ag - fs / s.m - ab
  return [vb, vs, ab, as]
}

/** Percepatan mutlak atap struktur terisolasi. */
export const isoRoofAcc = (s: IsoSystem, y: number[]) => -(s.c * y[3] + s.k * y[1]) / s.m

/** Satu langkah RK4 dengan ag linier dalam langkah (ag0 → ag1). */
export function isoStep(s: IsoSystem, y: number[], ag0: number, ag1: number, h: number): number[] {
  const agm = 0.5 * (ag0 + ag1)
  const k1 = isoDeriv(s, y, ag0)
  const y2 = y.map((v, i) => v + 0.5 * h * k1[i])
  const k2 = isoDeriv(s, y2, agm)
  const y3 = y.map((v, i) => v + 0.5 * h * k2[i])
  const k3 = isoDeriv(s, y3, agm)
  const y4 = y.map((v, i) => v + h * k3[i])
  const k4 = isoDeriv(s, y4, ag1)
  return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
}

/** Frekuensi alami sistem 2DOF (rad/s), naik — untuk tabel. */
export function isoModes(s: IsoSystem): number[] {
  // koordinat mutlak relatif tanah: xb = ub, xs = ub + us. M = diag(mb, m), K = [[kb + k, −k], [−k, k]]
  const a = s.mb * s.m
  const b = -(s.mb * s.k + s.m * (s.kb + s.k))
  const c = s.kb * s.k
  const disc = Math.sqrt(b * b - 4 * a * c)
  return [Math.sqrt((-b - disc) / (2 * a)), Math.sqrt((-b + disc) / (2 * a))]
}
