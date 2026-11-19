import { describe, expect, it } from 'vitest'
import { analytic, measure, phase, phaseTR, Rd, rdPeak, step, steadyState, TR, type Forced, type FState } from './physics'

const H = 1 / 2000

function run(s: Forced, x0: FState, tEnd: number, each?: (t: number, x: FState) => void) {
  let x = x0
  let t = 0
  while (t < tEnd - 1e-12) {
    x = step(s, x, H)
    t += H
    each?.(t, x)
  }
  return x
}

describe('Resonance — rumus', () => {
  it('Rd: β = 0 → 1, β = 1 → 1/(2ζ), β besar → ~1/β²', () => {
    expect(Rd(0, 0.05)).toBeCloseTo(1, 12)
    expect(Rd(1, 0.05)).toBeCloseTo(10, 10)
    expect(Rd(10, 0.05) * 100).toBeCloseTo(1, 1)
  })

  it('puncak Rd di β = √(1−2ζ²) dan nilainya maksimum lokal', () => {
    const z = 0.2
    const pk = rdPeak(z)
    expect(pk.value).toBeCloseTo(Rd(pk.beta, z), 10)
    expect(Rd(pk.beta + 1e-3, z)).toBeLessThan(pk.value)
    expect(Rd(pk.beta - 1e-3, z)).toBeLessThan(pk.value)
  })

  it('fase 90° saat resonansi, 0 di β → 0, mendekati 180° di β besar', () => {
    expect(phase(1, 0.1)).toBeCloseTo(Math.PI / 2, 12)
    expect(phase(1e-4, 0.1)).toBeCloseTo(0, 3)
    expect(phase(50, 0.1)).toBeGreaterThan(Math.PI * 0.99)
  })

  it('TR = 1 di β = √2 untuk semua ζ (batas isolasi)', () => {
    for (const z of [0, 0.05, 0.3, 1]) expect(TR(Math.SQRT2, z)).toBeCloseTo(1, 10)
    expect(TR(2, 0.1)).toBeLessThan(1)
  })

  it('lebar pita setengah daya ≈ 2ζ (ζ kecil)', () => {
    const z = 0.02
    const target = Rd(1, z) / Math.SQRT2
    const find = (lo: number, hi: number, rising: boolean) => {
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2
        if (Rd(mid, z) < target === rising) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    }
    const b1 = find(0.9, 1, true)
    const b2 = find(1, 1.1, false)
    expect((b2 - b1) / 2).toBeCloseTo(z, 3)
  })
})

describe('Resonance — integrasi numerik vs analitis', () => {
  it('gaya harmonik dari diam: RK4 cocok dengan solusi lengkap (transien + tunak)', () => {
    const s: Forced = { m: 2, k: 80, c: 2 * 0.05 * Math.sqrt(80 * 2), p0: 2, w: 0.8 * Math.sqrt(40) }
    let maxErr = 0
    run(s, { u: 0, v: 0, psi: 0 }, 12, (t, x) => {
      maxErr = Math.max(maxErr, Math.abs(x.u - analytic(s, t)))
    })
    expect(maxErr).toBeLessThan(1e-9)
  })

  it('resonansi tanpa redaman: amplitudo tumbuh linear (ust/2)·ωn·t', () => {
    const wn = Math.sqrt(40)
    const s: Forced = { m: 2, k: 80, c: 0, p0: 2, w: wn }
    let maxErr = 0
    run(s, { u: 0, v: 0, psi: 0 }, 10, (t, x) => {
      maxErr = Math.max(maxErr, Math.abs(x.u - analytic(s, t)))
    })
    expect(maxErr).toBeLessThan(1e-8)
  })

  it('mulai dari keadaan tunak → tetap tunak (tanpa transien)', () => {
    const s: Forced = { m: 1, k: 100, c: 1, p0: 5, w: 7 }
    const x0 = steadyState(s, 0.3)
    const tEnd = 3
    const x = run(s, x0, tEnd)
    const ref = steadyState(s, x.psi)
    expect(x.u).toBeCloseTo(ref.u, 8)
    expect(x.v).toBeCloseTo(ref.v, 7)
  })

  it('ukur (simulasi sampai tunak) = Rd dan φ teori, gaya harmonik', () => {
    for (const [b, z] of [
      [0.5, 0.1],
      [1, 0.05],
      [1.5, 0.2],
      [3, 0.1],
    ]) {
      const m = measure(b, z, 'force')!
      expect(m).not.toBeNull()
      expect(m.ratio / Rd(b, z)).toBeCloseTo(1, 3)
      expect(m.phase).toBeCloseTo(phase(b, z), 2)
    }
  })

  it('ukur eksitasi dasar = TR dan fase total teori', () => {
    for (const [b, z] of [
      [0.6, 0.1],
      [1, 0.1],
      [2.5, 0.05],
    ]) {
      const m = measure(b, z, 'base')!
      expect(m).not.toBeNull()
      expect(m.ratio / TR(b, z)).toBeCloseTo(1, 3)
      expect(m.phase).toBeCloseTo(phaseTR(b, z), 2)
    }
  })

  it('tanpa redaman tidak pernah tunak → null', () => {
    expect(measure(0.7, 0, 'force')).toBeNull()
  })
})
