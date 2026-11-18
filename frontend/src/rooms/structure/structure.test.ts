import { describe, expect, it } from 'vitest'
import { analyze, sampleAt, type Frame } from '../../lab/frame2d'
import { build, defaults, type Params, type Setup } from './model'
import { cantilever, continuous2, portalHingedH, simpleBeam, trussChord } from './theory'

const run = (s: Setup, over: Partial<Params> = {}) => {
  const p = { ...defaults(s), ...over }
  const b = build(s, p)
  return { p, b, r: analyze(b.frame) }
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-9, Math.abs(b))
const maxM = (st: { M: number }[]) => Math.max(...st.map((x) => x.M))

describe('Solver kekakuan — balok', () => {
  it('balok sederhana: reaksi, momen maks, lendutan tengah', () => {
    for (const [P, a, q] of [
      [20, 3, 0],
      [20, 1.2, 5],
      [0, 0, 8],
      [35, 4.7, 2],
    ]) {
      const { p, r } = run('sederhana', { P, a, q, L: 6 })
      const t = simpleBeam(p.L, P, a, q, p.EI)
      expect(rel(r.reactions[0].ry, t.RA)).toBeLessThan(1e-9)
      expect(rel(r.reactions[1].ry, t.RB)).toBeLessThan(1e-9)
      expect(rel(maxM(r.members[0].stations), t.Mmax)).toBeLessThan(2e-3)
      const mid = sampleAt(r.members[0], p.L / 2)
      expect(rel(-mid.uy, t.dMid)).toBeLessThan(1e-6)
    }
  })

  it('kantilever: reaksi, momen jepit, lendutan ujung', () => {
    const { p, r } = run('kantilever', { L: 4, P: 10, a: 2.5, q: 3 })
    const t = cantilever(p.L, p.P, p.a, p.q, p.EI)
    expect(rel(r.reactions[0].ry, t.R)).toBeLessThan(1e-9)
    // reaksi momen (berlawanan jarum jam) = −MA
    expect(rel(r.reactions[0].mz, -t.MA)).toBeLessThan(1e-9)
    expect(rel(r.members[0].stations[0].M, t.MA)).toBeLessThan(1e-9)
    const tip = r.members[0].stations.at(-1)!
    expect(rel(-tip.uy, t.dTip)).toBeLessThan(1e-6)
  })

  it('balok jepit–jepit beban merata: momen ujung qL²/12, tengah qL²/24', () => {
    const L = 8
    const q = 6
    const fr: Frame = {
      nodes: [
        { x: 0, y: 0 },
        { x: L, y: 0 },
      ],
      members: [{ i: 0, j: 1, EA: 1e9, EI: 5000, qy: -q }],
      supports: [
        { node: 0, ux: true, uy: true, rz: true },
        { node: 1, ux: true, uy: true, rz: true },
      ],
    }
    const r = analyze(fr)
    const st = r.members[0].stations
    expect(rel(st[0].M, (-q * L * L) / 12)).toBeLessThan(1e-9)
    expect(rel(sampleAt(r.members[0], L / 2).M, (q * L * L) / 24)).toBeLessThan(1e-9)
    expect(rel(-sampleAt(r.members[0], L / 2).uy, (q * L ** 4) / (384 * 5000))).toBeLessThan(1e-9)
  })

  it('balok menerus dua bentang = persamaan tiga momen', () => {
    for (const [L, L2, P, a, q] of [
      [5, 5, 0, 0, 10],
      [5, 5, 20, 2.5, 5],
      [4, 7, 30, 8, 2],
    ]) {
      const { r } = run('menerus', { L, L2, P, a, q })
      const t = continuous2(L, L2, P, a, q)
      expect(rel(r.members[0].stations.at(-1)!.M, t.MB)).toBeLessThan(1e-6)
      expect(rel(r.reactions[0].ry, t.RA)).toBeLessThan(1e-6)
      expect(rel(r.reactions[1].ry, t.RB)).toBeLessThan(1e-6)
      expect(rel(r.reactions[2].ry, t.RC)).toBeLessThan(1e-6)
    }
    // kasus klasik: dua bentang sama, q penuh → R tengah = 1,25·qL, M_B = −qL²/8
    const { r } = run('menerus', { L: 5, L2: 5, P: 0, q: 10 })
    expect(rel(r.reactions[1].ry, 1.25 * 10 * 5)).toBeLessThan(1e-6)
  })
})

describe('Solver kekakuan — portal, gable, rangka', () => {
  it('keseimbangan global portal & gable', () => {
    for (const s of ['portal', 'gable'] as const) {
      for (const bj of [0, 1]) {
        const { p, b, r } = run(s, { bj, W: 12 })
        const sumY = r.reactions.reduce((acc, x) => acc + x.ry, 0)
        const sumX = r.reactions.reduce((acc, x) => acc + x.rx, 0)
        expect(r.ok).toBe(true)
        expect(sumY).toBeCloseTo(p.q * p.L + (s === 'portal' ? p.P : 0), 6)
        expect(sumX).toBeCloseTo(-p.W, 6)
        expect(b.frame.members.length).toBeGreaterThan(2)
      }
    }
  })

  it('portal dua sendi: H = qL²/(4h(2k+3)) + suku P', () => {
    for (const [q, P, a, r] of [
      [10, 0, 3, 1],
      [0, 40, 2, 2.5],
      [6, 25, 4.5, 0.5],
    ]) {
      const { p, r: res } = run('portal', { bj: 0, W: 0, q, P, a, r, EI: 10000 })
      const H = portalHingedH(p.L, p.h, q, P, a, r)
      // EA terbatas → selisih kecil dari rumus (yang mengabaikan deformasi aksial)
      expect(rel(res.reactions[0].rx, H)).toBeLessThan(5e-3)
      expect(rel(-res.reactions[1].rx, H)).toBeLessThan(5e-3)
    }
  })

  it('rangka: gaya batang bawah tengah = M/h (metode potongan), semua tipe', () => {
    for (const tp of [0, 1, 2]) {
      for (const [n, P, a, w] of [
        [6, 50, 6, 0],
        [8, 30, 3, 10],
        [2, 40, 6, 0],
      ]) {
        const { p, b, r } = run('truss', { tp, n, P, a, w })
        expect(r.ok).toBe(true)
        const t = trussChord(p)
        const N = r.members[b.focus].stations[0].N
        expect(rel(N, t.F)).toBeLessThan(1e-6)
        expect(rel(r.reactions[0].ry, t.RA)).toBeLessThan(1e-9)
        // gaya batang konstan sepanjang batang, tanpa momen
        for (const m of r.members) for (const st of m.stations) expect(Math.abs(st.M)).toBeLessThan(1e-9)
      }
    }
  })

  it('struktur labil terdeteksi (balok di atas dua rol)', () => {
    const r = analyze({
      nodes: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
      members: [{ i: 0, j: 1, EA: 1e6, EI: 1e4, qy: -1 }],
      supports: [{ node: 0, uy: true }, { node: 1, uy: true }],
    })
    expect(r.ok).toBe(false)
  })
})
