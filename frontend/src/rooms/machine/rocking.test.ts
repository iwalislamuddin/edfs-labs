import { describe, expect, it } from 'vitest'
import type { Machine } from './physics'
import { lysmer, steadyAmp } from './physics'
import { bearing, blockSystem, modes3, step3, steady3, type State3 } from './rocking'

const soil = { G: 4e7, nu: 0.35, rho: 1800 }
const blk = { L: 5, B: 4, H: 1.25 }
const rot: Machine = { kind: 'rotasi', me: 0.3, mRec: 0, mRot: 0, r: 0.1, l: 0.4 }
const rec: Machine = { kind: 'torak', me: 0, mRec: 100, mRot: 50, r: 0.1, l: 0.4 }

describe('Rocking — sistem 3DOF', () => {
  it('arah vertikal identik dengan model SDOF (Lysmer)', () => {
    const s = blockSystem(blk, { Mm: 1e4, hs: 1, ex: 0 }, soil)
    const v = lysmer(soil, s.r0)
    expect(s.kz).toBeCloseTo(v.k, 6)
    expect(s.cz).toBeCloseTo(v.c, 6)
    const md = modes3(s)
    const vert = md.find((m) => m.kind === 'vertikal')!
    expect(vert.w).toBeCloseTo(Math.sqrt(s.kz / s.M), 8)
  })

  it('mode geser–rocking = akar persamaan karakteristik 2×2', () => {
    const s = blockSystem(blk, { Mm: 1e4, hs: 1, ex: 0 }, soil)
    // det([[kx − Mω², kx·zc], [kx·zc, kψ + kx·zc² − Ic·ω²]]) = 0
    const a = s.M * s.Ic
    const b = -(s.M * (s.kp + s.kx * s.zc * s.zc) + s.Ic * s.kx)
    const c = s.kx * s.kp
    const d = Math.sqrt(b * b - 4 * a * c)
    const w1 = Math.sqrt((-b - d) / (2 * a))
    const w2 = Math.sqrt((-b + d) / (2 * a))
    const cr = modes3(s).filter((m) => m.kind !== 'vertikal')
    expect(cr[0].w).toBeCloseTo(w1, 6)
    expect(cr[1].w).toBeCloseTo(w2, 6)
  })

  it('tanpa offset: vertikal bantalan = model SDOF untuk mesin rotasi', () => {
    const s = blockSystem(blk, { Mm: 1e4, hs: 1, ex: 0 }, soil)
    const w = 150
    const st = steady3(s, rot, w)
    const sd = steadyAmp(rot, { M: s.M, k: s.kz, c: s.cz }, w)
    expect(st.hz / sd.amp).toBeCloseTo(1, 4)
    expect(st.hx).toBeGreaterThan(0)
  })

  function simulate(m: Machine, w: number, ex: number) {
    const s = blockSystem(blk, { Mm: 1e4, hs: 1.2, ex }, soil)
    let x: State3 = { q: [0, 0, 0], v: [0, 0, 0], th: 0, w }
    const h = 1 / 20000
    let hx = 0
    let hz = 0
    const zMin = Math.min(...modes3(s).map((md) => md.zeta * md.w))
    const tSet = 12 / zMin
    for (let t = 0; t < tSet + 0.3; t += h) {
      x = step3(s, m, x, 0, h)
      if (t > tSet) {
        const [bx, bz] = bearing(s, x.q)
        hx = Math.max(hx, Math.abs(bx))
        hz = Math.max(hz, Math.abs(bz))
      }
    }
    return { s, hx, hz }
  }

  it('simulasi waktu = respons tunak kompleks (rotasi, dengan offset → kopel vertikal–rocking)', () => {
    const { s, hx, hz } = simulate(rot, 110, 0.6)
    const st = steady3(s, rot, 110)
    expect(hx / st.hx).toBeCloseTo(1, 2)
    expect(hz / st.hz).toBeCloseTo(1, 2)
  })

  it('simulasi waktu ≈ tunak dua harmonik (torak)', () => {
    const { s, hx, hz } = simulate(rec, 60, 0.3)
    const st = steady3(s, rec, 60)
    expect(Math.abs(hx / st.hx - 1)).toBeLessThan(0.02)
    expect(Math.abs(hz / st.hz - 1)).toBeLessThan(0.02)
  })
})
