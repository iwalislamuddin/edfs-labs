import { describe, expect, it } from 'vitest'
import { crank, forceHarmonics, lysmer, machineForce, massRatio, Rd, steadyAmp, stepM, zetaOf, type Foundation, type Machine } from './physics'

const rot: Machine = { kind: 'rotasi', me: 0.2, mRec: 0, mRot: 0, r: 0.1, l: 0.4 }
const rec: Machine = { kind: 'torak', me: 0, mRec: 100, mRot: 50, r: 0.1, l: 0.4 }
const fnd: Foundation = { M: 7e4, k: 6e8, c: 2 * 0.1 * Math.sqrt(6e8 * 7e4) }

describe('Kinematika engkol', () => {
  it('turunan x(θ) cocok dengan beda hingga', () => {
    const h = 1e-5
    for (const th of [0.3, 1.2, 2.5, 4]) {
      const a = crank(0.1, 0.35, th)
      const xp = crank(0.1, 0.35, th + h).x
      const xm = crank(0.1, 0.35, th - h).x
      expect(a.x1).toBeCloseTo((xp - xm) / (2 * h), 6)
      expect(a.x2).toBeCloseTo((xp - 2 * a.x + xm) / (h * h), 3)
    }
  })

  it('gaya eksak ≈ deret primer + sekunder bila r/l kecil', () => {
    const m: Machine = { ...rec, l: 2 }
    const w = 60
    const [F1, F2] = forceHarmonics(m, w)
    for (const th of [0, 0.7, 1.9, 3.1]) {
      const approx = F1 * Math.cos(th) + F2 * Math.cos(2 * th)
      expect(machineForce(m, th, w, 0) / F1).toBeCloseTo(approx / F1, 3)
    }
  })

  it('di titik mati atas (θ = 0) gaya = (m_rec(1 + r/l) + m_rot)·r·ω² secara eksak', () => {
    const w = 50
    expect(machineForce(rec, 0, w, 0)).toBeCloseTo((rec.mRec * (1 + rec.r / rec.l) + rec.mRot) * rec.r * w * w, 6)
  })
})

describe('Pondasi', () => {
  it('analog Lysmer: ζ = 0,425/√Bz', () => {
    const soil = { G: 4e7, nu: 0.35, rho: 1800 }
    const r0 = 2.5
    const M = 7e4
    const { k, c } = lysmer(soil, r0)
    expect(zetaOf({ M, k, c })).toBeCloseTo(0.425 / Math.sqrt(massRatio(soil, r0, M)), 12)
  })
})

describe('Respons tunak vs simulasi', () => {
  function simulateAmp(m: Machine, w: number) {
    let s = { u: 0, v: 0, th: 0, w }
    const h = 1 / 20000
    const wn = Math.sqrt(fnd.k / fnd.M)
    const tSettle = 10 / (zetaOf(fnd) * wn)
    let mx = 0
    for (let t = 0; t < tSettle + 0.3; t += h) {
      s = stepM(m, fnd, s, 0, h)
      if (t > tSettle) mx = Math.max(mx, Math.abs(s.u))
    }
    return mx
  }

  it('mesin rotasi: amplitudo = (m·e·ω²/k)·Rd', () => {
    const w = 120
    const th = steadyAmp(rot, fnd, w)
    expect(th.amp / ((rot.me * w * w * Rd(w / Math.sqrt(fnd.k / fnd.M), zetaOf(fnd))) / fnd.k)).toBeCloseTo(1, 4) // maks dari 720 sampel θ
    expect(simulateAmp(rot, w) / th.amp).toBeCloseTo(1, 3)
  })

  it('mesin torak: simulasi gaya eksak ≈ superposisi dua harmonik', () => {
    const w = 50 // 2ω dekat ωn → harmonik kedua penting
    const th = steadyAmp(rec, fnd, w)
    expect(th.X2).toBeGreaterThan(0.3 * th.X1)
    // deret dua suku mengabaikan harmonik 4ω, … (orde (r/l)³) → toleransi 2%
    expect(Math.abs(simulateAmp(rec, w) / th.amp - 1)).toBeLessThan(0.02)
  })
})
