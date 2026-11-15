import { describe, expect, it } from 'vitest'
import { energy, modal, rk4, type Sdof, type SimState } from './sdof'

const H = 1 / 2000

function run(p: Sdof, s0: SimState, tEnd: number, onStep?: (t: number, prev: SimState, s: SimState) => void) {
  let s = s0
  let t = 0
  while (t < tEnd - 1e-12) {
    const n = rk4(p, s, H)
    t += H
    onStep?.(t, s, n)
    s = n
  }
  return s
}

function peakTimes(p: Sdof, s0: SimState, tEnd: number) {
  const peaks: { t: number; u: number }[] = []
  run(p, s0, tEnd, (t, prev, s) => {
    if (prev.v > 0 && s.v <= 0) peaks.push({ t, u: s.q - p.F / p.K })
  })
  return peaks
}

describe('SDOF', () => {
  it('periode tak teredam = 2π√(m/k), tidak bergantung gravitasi', () => {
    const m = 2
    const k = 80
    const p: Sdof = { M: m, K: k, C: 0, F: m * 9.81 }
    const qeq = p.F / p.K
    const peaks = peakTimes(p, { q: qeq - 0.05, v: 0 }, 10)
    const T = peaks[peaks.length - 1].t - peaks[peaks.length - 2].t
    expect(T).toBeCloseTo(2 * Math.PI * Math.sqrt(m / k), 3)
    expect(modal(p).Tn).toBeCloseTo(2 * Math.PI * Math.sqrt(m / k), 12)
    expect(peaks[peaks.length - 1].u).toBeCloseTo(0.05, 5)
  })

  it('tanpa redaman energi kekal (60 detik)', () => {
    const p: Sdof = { M: 1, K: 100, C: 0, F: 9.81 }
    const s0 = { q: 0, v: 0 } // lepas dari panjang bebas
    const e0 = energy(p, s0)
    const s = run(p, s0, 60)
    const e = energy(p, s)
    expect((e.ek + e.ep) / (e0.ek + e0.ep)).toBeCloseTo(1, 6)
  })

  it('pengurangan logaritmik sesuai ζ', () => {
    const p: Sdof = { M: 1, K: 100, C: 1, F: 0 }
    const { zeta, Td } = modal(p)
    const peaks = peakTimes(p, { q: 0.1, v: 0 }, 5)
    const delta = Math.log(peaks[1].u / peaks[2].u)
    expect(delta).toBeCloseTo((2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta), 4)
    expect(peaks[2].t - peaks[1].t).toBeCloseTo(Td, 3)
  })

  it('redaman kritis tidak melewati kesetimbangan', () => {
    const p: Sdof = { M: 1, K: 100, C: 20, F: 0 }
    let crossed = false
    run(p, { q: 0.1, v: 0 }, 3, (_t, _p, s) => {
      if (s.q < -1e-9) crossed = true
    })
    expect(crossed).toBe(false)
  })
})
