import { describe, expect, it } from 'vitest'
import { rk4Vec, type Deriv } from '../../lab/ode'
import {
  pend1Deriv,
  pend1Energy,
  pend1Modal,
  pend2Deriv,
  pend2Energy,
  pend2Modes,
  periodLarge,
  rodLeq,
  rodSystem,
  simpleSystem,
  type Pend2,
} from './physics'

const H = 1 / 2000
const deg = Math.PI / 180

function run(f: Deriv, y0: number[], tEnd: number, onStep?: (t: number, prev: number[], y: number[]) => void) {
  let y = y0
  let t = 0
  while (t < tEnd - 1e-12) {
    const n = rk4Vec(f, y, H)
    t += H
    onStep?.(t, y, n)
    y = n
  }
  return y
}

/** Waktu puncak positif (ω berpindah dari + ke −) untuk koordinat indeks iq dengan kecepatan di iv. */
function peaks(f: Deriv, y0: number[], tEnd: number, iq = 0, iv = 1) {
  const out: { t: number; q: number }[] = []
  run(f, y0, tEnd, (t, prev, y) => {
    if (prev[iv] > 0 && y[iv] <= 0 && y[iq] > 0) {
      // interpolasi linear titik nol kecepatan
      const s = prev[iv] / (prev[iv] - y[iv])
      out.push({ t: t - H + s * H, q: y[iq] })
    }
  })
  return out
}

const lastT = (pk: { t: number }[]) => pk[pk.length - 1].t - pk[pk.length - 2].t

describe('Bandul sederhana', () => {
  it('sudut kecil: periode = 2π√(L/g), tidak bergantung massa', () => {
    for (const m of [0.5, 5]) {
      const p = simpleSystem(m, 1.2, 9.81, 0)
      const pk = peaks(pend1Deriv(p), [2 * deg, 0], 8)
      expect(lastT(pk)).toBeCloseTo(2 * Math.PI * Math.sqrt(1.2 / 9.81), 3)
    }
  })

  it('sudut besar: periode sesuai rumus eksak (integral eliptik / AGM)', () => {
    const p = simpleSystem(1, 1, 9.81, 0)
    const { T0 } = pend1Modal(p)
    for (const a of [45, 90, 150]) {
      const pk = peaks(pend1Deriv(p), [a * deg, 0], 4 * periodLarge(T0, a * deg))
      expect(lastT(pk)).toBeCloseTo(periodLarge(T0, a * deg), 3)
    }
    // nilai acuan: T(90°)/T0 = 1,18034
    expect(periodLarge(1, 90 * deg)).toBeCloseTo(1.18034, 4)
  })

  it('model linear selalu berperiode T0 berapa pun sudutnya', () => {
    const p = { ...simpleSystem(1, 1, 9.81, 0), linear: true }
    const pk = peaks(pend1Deriv(p), [90 * deg, 0], 6)
    expect(lastT(pk)).toBeCloseTo(pend1Modal(p).T0, 3)
  })

  it('tanpa redaman energi kekal (60 detik, 120°)', () => {
    const p = simpleSystem(2, 0.8, 9.81, 0)
    const y0 = [120 * deg, 0]
    const e0 = pend1Energy(p, y0)
    const e = pend1Energy(p, run(pend1Deriv(p), y0, 60))
    expect((e.ek + e.ep) / (e0.ek + e0.ep)).toBeCloseTo(1, 6)
  })

  it('redaman kecil: pengurangan logaritmik ≈ 2πζ/√(1−ζ²) pada sudut kecil', () => {
    const p = simpleSystem(1, 1, 9.81, 0.3)
    const { zeta } = pend1Modal(p)
    const pk = peaks(pend1Deriv(p), [3 * deg, 0], 10)
    expect(Math.log(pk[1].q / pk[2].q)).toBeCloseTo((2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta), 3)
  })
})

describe('Bandul fisik (batang)', () => {
  it('periode sudut kecil = periode bandul sederhana sepanjang Leq', () => {
    const L = 1
    const d = 0.3
    const p = rodSystem(1, L, d, 9.81, 0)
    const pk = peaks(pend1Deriv(p), [2 * deg, 0], 8)
    expect(lastT(pk)).toBeCloseTo(2 * Math.PI * Math.sqrt(rodLeq(L, d) / 9.81), 3)
  })

  it('periode minimum di d = L/√12', () => {
    const T = (d: number) => pend1Modal(rodSystem(1, 1, d, 9.81, 0)).T0
    const dOpt = 1 / Math.sqrt(12)
    expect(T(dOpt)).toBeLessThan(T(dOpt * 0.9))
    expect(T(dOpt)).toBeLessThan(T(dOpt * 1.1))
  })
})

describe('Bandul ganda', () => {
  const p: Pend2 = { m1: 1, m2: 1, L1: 1, L2: 1, g: 9.81, c: 0 }

  it('mode normal L1=L2, m1=m2: ω² = g(2 ∓ √2)/L, bentuk ±√2', () => {
    const md = pend2Modes(p)
    expect(md.w[0] ** 2).toBeCloseTo(9.81 * (2 - Math.SQRT2), 9)
    expect(md.w[1] ** 2).toBeCloseTo(9.81 * (2 + Math.SQRT2), 9)
    expect(md.shape[0]).toBeCloseTo(Math.SQRT2, 9)
    expect(md.shape[1]).toBeCloseTo(-Math.SQRT2, 9)
  })

  it('dilepas pada bentuk mode, bergetar dengan periode mode itu', () => {
    const q = { ...p, m2: 0.6, L2: 0.7 }
    const md = pend2Modes(q)
    for (const i of [0, 1] as const) {
      const a = 0.1 * deg
      const pk = peaks(pend2Deriv(q), [a, a * md.shape[i], 0, 0], 6 * md.T[0], 0, 2)
      expect(lastT(pk)).toBeCloseTo(md.T[i], 3)
    }
  })

  it('tanpa redaman energi kekal walau gerak kacau (30 detik)', () => {
    const y0 = [120 * deg, -20 * deg, 0, 0]
    const e0 = pend2Energy(p, y0)
    const e = pend2Energy(p, run(pend2Deriv(p), y0, 30))
    expect((e.ek + e.ep) / (e0.ek + e0.ep)).toBeCloseTo(1, 5)
  })

  it('dengan redaman energi turun terus', () => {
    const q = { ...p, c: 0.2 }
    let prevE = Infinity
    let monotone = true
    run(pend2Deriv(q), [90 * deg, 90 * deg, 0, 0], 10, (_t, _p, y) => {
      const e = pend2Energy(q, y)
      const tot = e.ek + e.ep
      if (tot > prevE + 1e-9) monotone = false
      prevE = tot
    })
    expect(monotone).toBe(true)
  })
})
