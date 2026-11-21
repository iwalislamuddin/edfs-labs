import { describe, expect, it } from 'vitest'
import {
  columnIntegral,
  curvedForce,
  curvedStrips,
  gateMoments,
  gateSolve,
  openingLevel,
  planeForce,
  planeStrips,
  pressure,
  surfaceS,
  vesselWeight,
  type Arc,
  type Gate,
  type GateSystem,
} from './hydro'

const g = 9.81
const gw = 1000 * g
const rel = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)))

describe('tekanan berlapis', () => {
  const layers = [
    { rho: 850, h: 1.5 },
    { rho: 1000, h: 3 },
  ]
  it('p = p0 + Σ ρ g h dan integrasi kolom sama', () => {
    const p0 = 20e3
    rel(pressure(p0, layers, g, 0), p0)
    rel(pressure(p0, layers, g, 1), p0 + 850 * g)
    rel(pressure(p0, layers, g, 3.5), p0 + 850 * g * 1.5 + 1000 * g * 2)
    for (const d of [0.3, 1.5, 2.2, 4.5]) rel(columnIntegral(p0, layers, g, d), pressure(p0, layers, g, d), 1e-3)
  })
  it('paradoks: berat bejana tegak = p·A dasar; bejana lain tidak', () => {
    const one = [{ rho: 1000, h: 2 }]
    const pA = pressure(0, one, g, 2) * 1.2
    rel(vesselWeight('tegak', 1.2, 3, one, g), pA, 1e-6)
    expect(vesselWeight('melebar', 1.2, 3, one, g)).toBeGreaterThan(pA * 1.3)
    expect(vesselWeight('menyempit', 1.2, 3, one, g)).toBeLessThan(pA * 0.8)
  })
})

describe('momen luas pintu (bentuk tertutup)', () => {
  it('persegi, lingkaran, segitiga: A, titik berat, Ic sesuai tabel', () => {
    const r: Gate = { shape: 'persegi', L: 2, b: 3, alpha: 90 }
    const [A, M1, M2] = gateMoments(r, 0, 2)
    rel(A, 6)
    rel(M1 / A, 1)
    rel(M2 - (M1 * M1) / A, (3 * 8) / 12)
    const c: Gate = { shape: 'lingkaran', L: 2, b: 0, alpha: 90 }
    const [Ac, M1c, M2c] = gateMoments(c, 0, 2)
    rel(Ac, Math.PI)
    rel(M1c / Ac, 1)
    rel(M2c - (M1c * M1c) / Ac, Math.PI / 4)
    const t: Gate = { shape: 'segitiga', L: 3, b: 2, alpha: 90 }
    const [At, M1t, M2t] = gateMoments(t, 0, 3)
    rel(At, 3)
    rel(M1t / At, 2) // 2/3 dari puncak
    rel(M2t - (M1t * M1t) / At, (2 * 27) / 36)
  })
  it('segmen lingkaran basah sama dengan integrasi numerik', () => {
    const c: Gate = { shape: 'lingkaran', L: 1.6, b: 0, alpha: 60 }
    for (const sw of [0.2, 0.8, 1.3]) {
      const a = planeForce(c, gw, sw)
      const n = planeStrips(c, gw, sw, 20000)
      rel(a.F, n.F, 1e-5)
      rel(a.sp, n.sp, 1e-5)
    }
  })
})

describe('pintu bidang', () => {
  it('pintu tegak terendam penuh: F = γ hc A, yp = yc + Ic/(yc A)', () => {
    const gt: Gate = { shape: 'persegi', L: 2, b: 1.5, alpha: 90 }
    const f = planeForce(gt, gw, surfaceS(gt, 5)) // tepi atas pada kedalaman 3 m
    rel(f.hc, 4)
    rel(f.F, gw * 4 * 3)
    rel(f.yp, 4 + 4 / 12 / 4)
  })
  it('terendam sebagian: F = γ b h²/2 di h/3 dari dasar', () => {
    const gt: Gate = { shape: 'persegi', L: 4, b: 2, alpha: 90 }
    const h = 2.5
    const f = planeForce(gt, gw, surfaceS(gt, h))
    rel(f.F, (gw * 2 * h * h) / 2)
    rel(f.hp, (2 * h) / 3)
  })
  it('pintu miring: rumus = integrasi pias untuk tiga bentuk', () => {
    for (const shape of ['persegi', 'lingkaran', 'segitiga'] as const) {
      const gt: Gate = { shape, L: 3, b: 2, alpha: 40 }
      for (const h of [1, 3, 6]) {
        const sw = surfaceS(gt, h)
        const a = planeForce(gt, gw, sw)
        const n = planeStrips(gt, gw, sw, 20000)
        rel(a.F, n.F, 1e-5)
        rel(a.sp, n.sp, 1e-5)
      }
    }
  })
  it('keseimbangan momen engsel atas & bawah, air hilir mengurangi gaya', () => {
    const base: GateSystem = { gate: { shape: 'persegi', L: 3, b: 2, alpha: 90 }, gamma: gw, h1: 4, h2: 0, hinge: 'atas', pivot: 0.6, W: 0 }
    const top = gateSolve(base)
    // engsel atas: P·L = F·(sp − 0)
    rel(top.P * 3, top.up.F * top.up.sp)
    rel(top.P + top.Rn, top.up.F)
    const bot = gateSolve({ ...base, hinge: 'bawah' })
    rel(bot.P * 3, bot.up.F * (3 - bot.up.sp))
    const tw = gateSolve({ ...base, h2: 2 })
    expect(tw.P).toBeLessThan(top.P)
    rel(tw.P + tw.Rn, tw.up.F - tw.down.F)
  })
  it('pintu poros otomatis membuka saat pusat tekanan naik melewati poros', () => {
    const sys: GateSystem = { gate: { shape: 'persegi', L: 2, b: 1, alpha: 90 }, gamma: gw, h1: 1, h2: 0, hinge: 'poros', pivot: 0.6, W: 0 }
    const h = openingLevel(sys)!
    expect(h).not.toBeNull()
    // pada h buka: pusat tekanan tepat di poros (s = 1,2 m dari atas)
    rel(gateSolve({ ...sys, h1: h }).up.sp, 1.2, 1e-6)
    // analitis pintu tegak terendam penuh: yp − yc = L²/(12·yc) = 1,2 − 1 → yc = 4/2,4 = 5/3; titik berat di kedalaman h − 1
    rel(h - 1, 5 / 3, 1e-6)
    expect(gateSolve({ ...sys, h1: h * 0.9 }).open).toBe(false)
    expect(gateSolve({ ...sys, h1: h * 1.1 }).open).toBe(true)
  })
})

describe('permukaan lengkung', () => {
  const R = 2
  const b = 3
  const H = 5
  it('kuadran cekung (air di atas): FH = γ hc A, FV ke bawah = γ·b·(R(H−R) + πR²/4)', () => {
    const a: Arc = { cx: 0, cz: R, R, p0: 1.5 * Math.PI, p1: 2 * Math.PI }
    const f = curvedForce(a, gw, b, H)!
    rel(f.Fx, gw * (H - R / 2) * R * b)
    rel(f.Fz, -gw * b * (R * (H - R) + (Math.PI * R * R) / 4))
    rel(f.Abody, R * (H - R) + (Math.PI * R * R) / 4)
    const n = curvedStrips(a, gw, b, H, 20000)
    rel(n.Fx, f.Fx, 1e-5)
    rel(n.Fz, f.Fz, 1e-5)
    expect(Math.abs(n.Mc)).toBeLessThan(1e-6 * Math.hypot(f.Fx, f.Fz) * R)
    // garis kerja FV: titik berat persegi R×(H−R) (x = R/2) + seperempat lingkaran (x = 4R/3π)
    const Ar = R * (H - R)
    const Aq = (Math.PI * R * R) / 4
    rel(f.xFV, (Ar * (R / 2) + Aq * ((4 * R) / (3 * Math.PI))) / (Ar + Aq))
  })
  it('kuadran cembung: FV = γ·b·(R(H−R) + R² − πR²/4)', () => {
    const a: Arc = { cx: R, cz: 0, R, p0: Math.PI, p1: Math.PI / 2 }
    const f = curvedForce(a, gw, b, H)!
    rel(f.Fx, gw * (H - R / 2) * R * b)
    rel(f.Fz, -gw * b * (R * (H - R) + R * R - (Math.PI * R * R) / 4))
    const n = curvedStrips(a, gw, b, H, 20000)
    rel(n.Fz, f.Fz, 1e-5)
  })
  it('kuadran menggantung: FV ke atas (badan tekanan khayal)', () => {
    const a: Arc = { cx: -R, cz: 0, R, p0: 0, p1: Math.PI / 2 }
    const f = curvedForce(a, gw, b, H)!
    rel(f.Fx, gw * (H - R / 2) * R * b)
    rel(f.Fz, gw * b * (R * H - (Math.PI * R * R) / 4))
    const n = curvedStrips(a, gw, b, H, 20000)
    rel(n.Fx, f.Fx, 1e-5)
    rel(n.Fz, f.Fz, 1e-5)
  })
  it('pintu radial: resultan melewati poros, terendam sebagian juga', () => {
    const Rr = 6
    const zp = 3
    const a: Arc = { cx: 0, cz: zp, R: Rr, p0: Math.PI + Math.asin(zp / Rr), p1: Math.PI - Math.asin((4.5 - zp) / Rr) }
    for (const Hh of [2, 4.5]) {
      const f = curvedForce(a, gw, 4, Hh)!
      const n = curvedStrips(a, gw, 4, Hh, 20000, 0, 0)
      rel(n.Fx, f.Fx, 1e-5)
      rel(n.Fz, f.Fz, 1e-5)
      expect(Math.abs(n.Mc)).toBeLessThan(1e-6 * Math.abs(f.Fx) * Rr)
      expect(Math.abs(n.Mo)).toBeGreaterThan(1e-3 * Math.abs(f.Fx))
      rel(f.Fx, gw * f.hcProj * f.Aproj)
    }
  })
})
