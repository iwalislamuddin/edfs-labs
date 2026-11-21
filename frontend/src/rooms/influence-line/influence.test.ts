import { describe, expect, it } from 'vitest'
import { analyze, sampleAt, type Frame } from '../../lab/frame2d'
import { defaults, matrixEffect, responses, trackLength, truckAxles, truckLoads, trussGeom, type Params, type Setup } from './model'
import { beamReactions, findRitter, ilAt, ilCurve, ilEffect, ilStats, supportMoments, truckExtremes } from './theory'

const P = (s: Setup, over: Partial<Params> = {}): Params => ({ ...defaults(s), ...over })
const near = (a: number, b: number, tol = 1e-7) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)))

/** Bandingkan teori vs matriks untuk semua respons di banyak posisi beban. */
function sweep(s: Setup, p: Params, tol = 1e-7) {
  const Lt = trackLength(s, p)
  for (const r of responses(s, p)) {
    for (let k = 0; k <= 37; k++) {
      const x = (Lt * k) / 37
      const t = ilAt(s, p, r.id, x)
      const m = matrixEffect(s, p, r.id, [{ x, P: 1 }])!
      near(m, t, tol)
    }
  }
}

describe('Balok sederhana (+ kantilever)', () => {
  it('rumus garis lurus klasik', () => {
    const p = P('sederhana', { L: 10, xs: 4 })
    near(ilAt('sederhana', p, 'R0', 3), 0.7)
    near(ilAt('sederhana', p, 'M', 4), (4 * 6) / 10) // ab/L di bawah potongan
    near(ilAt('sederhana', p, 'V', 3.999999), -0.4, 1e-5)
    near(ilAt('sederhana', p, 'V', 4.000001), 0.6, 1e-5)
  })
  it('teori = matriks (tanpa dan dengan kantilever, potongan di kantilever / tumpuan)', () => {
    sweep('sederhana', P('sederhana'))
    sweep('sederhana', P('sederhana', { c1: 2.5, c2: 3, xs: 6 }))
    sweep('sederhana', P('sederhana', { c1: 2, c2: 3, xs: 1 })) // potongan di kantilever kiri
    sweep('sederhana', P('sederhana', { c1: 2, c2: 3, xs: 2 })) // potongan tepat di tumpuan A (sisi kanan)
    sweep('sederhana', P('sederhana', { c1: 0, c2: 4, xs: 12 }))
  })
  it('kantilever: reaksi di luar tumpuan > 1 dan negatif', () => {
    const p = P('sederhana', { L: 8, c1: 0, c2: 4 })
    near(ilAt('sederhana', p, 'R1', 12), 1.5)
    near(ilAt('sederhana', p, 'R0', 12), -0.5)
  })
})

describe('Balok menerus — tiga momen', () => {
  it('dua bentang sama: M_B = −3PL/32 (beban di tengah bentang 1), R_B = 11/16', () => {
    const L = 8
    const M = supportMoments([L, L], L / 2)
    near(M[1], (-3 * L) / 32)
    const p = P('menerus', { L, L2: L, nb: 2 })
    near(beamReactions('menerus', p, L / 2)[1], 11 / 16)
  })
  it('teori = matriks (2 dan 3 bentang, bentang tak sama)', () => {
    sweep('menerus', P('menerus'))
    sweep('menerus', P('menerus', { L: 6, L2: 10, nb: 2, xs: 11 }))
    sweep('menerus', P('menerus', { L: 7, L2: 9, L3: 5, nb: 3, xs: 8.5 }))
    sweep('menerus', P('menerus', { L: 7, L2: 9, L3: 5, nb: 3, xs: 7 })) // potongan di tumpuan B
  })
  it('Müller–Breslau: GP R_B = lendutan balok tanpa tumpuan B akibat beban di B, dinormalkan', () => {
    const L1 = 7
    const L2 = 9
    const p = P('menerus', { L: L1, L2, nb: 2 })
    // balok sederhana bentang L1 + L2 dengan satu beban satuan di posisi tumpuan B
    const fr: Frame = {
      nodes: [
        { x: 0, y: 0 },
        { x: L1, y: 0 },
        { x: L1 + L2, y: 0 },
      ],
      members: [
        { i: 0, j: 1, EA: 1e8, EI: 1e4 },
        { i: 1, j: 2, EA: 1e8, EI: 1e4 },
      ],
      supports: [
        { node: 0, ux: true, uy: true },
        { node: 2, uy: true },
      ],
      nodeLoads: [{ node: 1, fy: -1 }],
    }
    const r = analyze(fr, 32)
    const dB = r.disp[1].uy
    for (const x of [1, 3.3, 6, 8, 12, 15]) {
      const mi = x <= L1 ? 0 : 1
      const uy = sampleAt(r.members[mi], mi ? x - L1 : x).uy
      near(uy / dB, ilAt('menerus', p, 'R1', x), 2e-3)
    }
  })
})

describe('Rangka batang — potongan Ritter otomatis', () => {
  for (const tp of [0, 1, 2]) {
    for (const n of [2, 4, 6, 8]) {
      it(`tipe ${tp}, ${n} panel: setiap batang teori = matriks`, () => {
        const base = P('truss', { tp, n, L: 24, h: 3.5 })
        const g = trussGeom(base)
        for (let mem = 0; mem < g.names.length; mem++) {
          const p = { ...base, mem }
          expect(findRitter(p, mem), `${g.names[mem]} punya potongan`).not.toBeNull()
          sweep('truss', p, 1e-6)
        }
      })
    }
  }
  it('Pratt: batang bawah tengah = M/h, diagonal tarik', () => {
    const p = P('truss', { tp: 0, n: 6, L: 24, h: 3 })
    const g = trussGeom(p)
    const B3 = g.names.indexOf('B3')
    const pp = { ...p, mem: B3 }
    // B3 di panel 8–12 m; diagonal panel itu turun dari simpul atas x = 8 → titik momen O = (8, h).
    // Beban di 12 m: M(8) = R_A·8 = 0,5·8 = 4 → N = 4/3 (tarik)
    expect(findRitter(pp, B3)?.O?.x).toBeCloseTo(8, 9)
    near(ilAt('truss', pp, 'N', 12), 4 / 3)
    const D2 = g.names.indexOf('D2')
    expect(ilAt('truss', { ...p, mem: D2 }, 'N', 20)).toBeGreaterThan(0)
  })
})

describe('Beban berjalan', () => {
  it('superposisi: Σ P·η = analisis langsung dengan semua gandar', () => {
    for (const s of ['sederhana', 'menerus', 'truss'] as Setup[]) {
      const p = P(s)
      const resp = s === 'truss' ? 'N' : 'M'
      for (const X of [3, 7.7, 14, 20]) {
        const loads = truckLoads(X, truckAxles(p.g, 1))
        near(matrixEffect(s, p, resp, loads)!, ilEffect(s, p, resp, loads), 1e-6)
      }
    }
  })
  it('truk pada balok sederhana panjang: maks M di tengah ≈ teorema Winkler (gandar di titik patah)', () => {
    const p = P('sederhana', { L: 30, xs: 15 })
    const ext = truckExtremes('sederhana', p, 'M', (d) => truckAxles(5, d))
    // gandar tengah di potongan: 225·7,5 + 225·(10/15)·7,5... dihitung langsung
    const best = Math.max(
      ...[0, -5, -10].map((o) => ilEffect('sederhana', p, 'M', truckLoads(15 - o, truckAxles(5, 1)))),
      ...[0, 5, 10].map((o) => ilEffect('sederhana', p, 'M', truckLoads(15 - o, truckAxles(5, -1)))),
    )
    near(ext.max.val, best, 1e-9)
  })
  it('luas garis pengaruh: M di tengah balok sederhana = L²/8, R_A = L/2', () => {
    const p = P('sederhana', { L: 12, xs: 6 })
    near(ilStats(ilCurve('sederhana', p, 'M')).pos, 144 / 8, 1e-6)
    near(ilStats(ilCurve('sederhana', p, 'R0')).pos, 6, 1e-6)
    const st = ilStats(ilCurve('sederhana', p, 'V'))
    near(st.pos, 1.5, 1e-6)
    near(st.neg, -1.5, 1e-6)
  })
})
