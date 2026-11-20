import { describe, expect, it } from 'vitest'
import type { Machine } from './physics'
import { lysmer, steadyAmp } from './physics'
import { bearing, blockSystem, modes3, step3, steady3, steadyState3, tableK, tableSystem, type State3 } from './rocking'

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

describe('Pondasi meja — pelat kaku di atas kolom jepit–jepit', () => {
  const col = { hc: 4, bc: 0.6, E: 3e10 }
  const pl = { Mm: 1e4, hs: 1, ex: 0.4 }

  /** Geser bawah pelat U = x + zc·ψ akibat gaya F horizontal tepat di bawah pelat (dz = −zc). */
  function sway(kx: number, kz: number) {
    const zc = 0.9
    const K = tableK(kx, kz, 2, zc, 4)
    const F = 1000
    // sistem [x, ψ] (z terpisah); gaya umum ψ = −dz·F = zc·F
    const [a, b, d] = [K[0][0], K[0][2], K[2][2]]
    const det = a * d - b * b
    const x = (d * F - b * zc * F) / det
    const psi = (a * zc * F - b * F) / det
    return { U: x + zc * psi, F }
  }

  it('tanpa kekakuan aksial: kolom berperilaku kantilever bersama, U = F·h³/(3ΣEI) = 4F/kx', () => {
    const kx = 2.4e8
    const { U, F } = sway(kx, 0)
    expect((U * kx) / F).toBeCloseTo(4, 6)
  })

  it('gaya di CG (e = zc di atas kolom), tanpa kekakuan aksial: U = F·h³/3EI + F·e·h²/2EI (arah rotasi benar)', () => {
    const kx = 2.4e8
    const zc = 0.9
    const h = 4
    const K = tableK(kx, 0, 2, zc, h)
    const F = 1000
    const [a, b, d] = [K[0][0], K[0][2], K[2][2]]
    const det = a * d - b * b
    const x = (d * F) / det
    const psi = (-b * F) / det
    const U = x + zc * psi
    expect((U * kx) / F).toBeCloseTo(4 + (6 * zc) / h, 6)
  })

  it('kolom aksial sangat kaku: pelat tidak berotasi, U = F/Σ(12EI/h³)', () => {
    const kx = 2.4e8
    const { U, F } = sway(kx, 1e16)
    expect((U * kx) / F).toBeCloseTo(1, 5)
  })

  it('mode vertikal = √(ΣEA/h / M), redaman modal ζ sama di semua mode', () => {
    const s = tableSystem(blk, pl, col, 0.03)
    expect(s.kz).toBeCloseTo((4 * col.E * col.bc ** 2) / col.hc, 0)
    expect(s.kx).toBeCloseTo((4 * col.E * col.bc ** 4) / col.hc ** 3, 0)
    const md = modes3(s)
    const v = md.find((m) => m.kind === 'vertikal')!
    expect(v.w).toBeCloseTo(Math.sqrt(s.kz / s.M), 6)
    for (const m of md) expect(m.zeta).toBeCloseTo(0.03, 8)
    // mode sway pertama jauh di bawah vertikal (kolom langsing secara lentur)
    expect(md[0].kind).toBe('geser–rocking 1')
    expect(md[0].w).toBeLessThan(v.w / 3)
  })

  it('simulasi waktu dari keadaan tunak tetap tunak (rotasi & torak)', () => {
    for (const [m, w] of [
      [rot, 150],
      [rec, 70],
    ] as const) {
      const s = tableSystem(blk, pl, col, 0.03)
      const st0 = steadyState3(s, m, w, 0)
      let x: State3 = { q: st0.q, v: st0.v, th: 0, w }
      const h = 1 / 40000
      let hx = 0
      let hz = 0
      for (let t = 0; t < 0.4; t += h) {
        x = step3(s, m, x, 0, h)
        const [bx, bz] = bearing(s, x.q)
        hx = Math.max(hx, Math.abs(bx))
        hz = Math.max(hz, Math.abs(bz))
      }
      const st = steady3(s, m, w)
      expect(Math.abs(hx / st.hx - 1)).toBeLessThan(0.005)
      expect(Math.abs(hz / st.hz - 1)).toBeLessThan(0.005)
    }
  })
})
