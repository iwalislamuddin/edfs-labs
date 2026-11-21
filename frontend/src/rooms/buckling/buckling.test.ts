import { describe, expect, it } from 'vitest'
import {
  betaL,
  buildFE,
  elastica,
  elasticaRatio,
  elasticaTheory,
  feBuckling,
  firstYield,
  imperfect,
  imperfectTheory,
  inflections,
  kEff,
  kFromRatio,
  modeShape,
  pcr,
  perry,
  shapeAt,
  sniFcr,
  sniLimit,
  southwell,
  SUPPORTS,
  type Support,
} from './buckling'

const EI = 200000 * 1.33e6 // N·mm²
const L = 3000 // mm
const ALL: Support[] = ['sendi', 'jepit-bebas', 'jepit-sendi', 'jepit']

describe('Euler analitis', () => {
  it('akar karakteristik klasik', () => {
    expect(betaL('sendi', 3)).toEqual([Math.PI, 2 * Math.PI, 3 * Math.PI].map((v) => expect.closeTo(v, 9)))
    expect(betaL('jepit-bebas', 2)[1]).toBeCloseTo((3 * Math.PI) / 2, 9)
    expect(betaL('jepit-sendi', 2)[0]).toBeCloseTo(4.493409, 5)
    expect(betaL('jepit-sendi', 2)[1]).toBeCloseTo(7.725252, 5)
    const ff = betaL('jepit', 3)
    expect(ff[0]).toBeCloseTo(2 * Math.PI, 9)
    expect(ff[1]).toBeCloseTo(8.986819, 5) // antisimetris tan(z/2) = z/2
    expect(ff[2]).toBeCloseTo(4 * Math.PI, 9)
  })

  it('K efektif = 1, 2, 0,699, 0,5 dan cocok dengan tabel SUPPORTS', () => {
    for (const s of SUPPORTS) expect(kEff(s.id)).toBeCloseTo(s.K, 9)
    expect(kEff('jepit-sendi')).toBeCloseTo(0.6992, 4)
    expect(pcr('sendi', EI, L)).toBeCloseTo((Math.PI ** 2 * EI) / L ** 2, 6)
  })

  it('bentuk mode memenuhi syarat batas dan maks = 1', () => {
    for (const s of ALL)
      for (let n = 1; n <= 3; n++) {
        const m = modeShape(s, n)
        expect(Math.abs(shapeAt(m, 0))).toBeLessThan(1e-9)
        if (s !== 'jepit-bebas') expect(Math.abs(shapeAt(m, 1))).toBeLessThan(1e-9)
        let mx = -Infinity
        for (let i = 0; i <= 1000; i++) mx = Math.max(mx, shapeAt(m, i / 1000))
        expect(mx).toBeCloseTo(1, 4)
      }
  })

  it('titik belok: jepit–jepit di L/4 dan 3L/4, jepit–sendi di 0,699L dari puncak', () => {
    const ff = inflections(modeShape('jepit', 1))
    expect(ff[0]).toBeCloseTo(0.25, 6)
    expect(ff[1]).toBeCloseTo(0.75, 6)
    const fp = inflections(modeShape('jepit-sendi', 1))
    expect(fp.length).toBe(1)
    expect(1 - fp[0]).toBeCloseTo(0.6992, 4)
  })
})

describe('elemen hingga balok-kolom', () => {
  it('eigen K·φ = P·G·φ = Pcr analitis (3 mode, 4 tumpuan)', () => {
    for (const s of ALL) {
      const fe = feBuckling(buildFE(s, EI, L, 24), 3)
      for (let n = 1; n <= 3; n++) expect(fe.P[n - 1] / pcr(s, EI, L, n)).toBeCloseTo(1, 3)
    }
  })

  it('vektor eigen = bentuk mode analitis di simpul', () => {
    for (const s of ALL) {
      const fe = feBuckling(buildFE(s, EI, L, 24), 1)
      const m = modeShape(s, 1)
      fe.w[0].forEach((v, i) => expect(v).toBeCloseTo(shapeAt(m, i / 24), 2))
    }
  })

  it('lengkung awal: δ = e0·α/(1−α) dan M = P·e0/(1−α) (sendi–sendi)', () => {
    const fe = buildFE('sendi', EI, L, 24)
    const P1 = pcr('sendi', EI, L)
    for (const a of [0.2, 0.5, 0.9]) {
      const r = imperfect(fe, 'sendi', a * P1, 3, 0)
      expect(r.dMax / ((3 * a) / (1 - a))).toBeCloseTo(1, 4)
      expect(r.Mmax / ((a * P1 * 3) / (1 - a))).toBeCloseTo(1, 2)
      const t = imperfectTheory('sendi', EI, L, a * P1, 3, 0)
      expect(t.d).toBeCloseTo((3 * a) / (1 - a), 9)
    }
  })

  it('lengkung awal semua tumpuan cocok dengan teori', () => {
    for (const s of ALL) {
      const fe = buildFE(s, EI, L, 24)
      const P = 0.6 * pcr(s, EI, L)
      const r = imperfect(fe, s, P, 2, 0)
      const t = imperfectTheory(s, EI, L, P, 2, 0)
      expect(r.dMax / t.d).toBeCloseTo(1, 2)
      expect(Math.abs(r.Mmax / t.M - 1)).toBeLessThan(0.01)
    }
  })

  it('eksentrisitas: rumus secant δ = e(sec(kL/2) − 1), M = P·e·sec (sendi–sendi, jepit–bebas)', () => {
    for (const s of ['sendi', 'jepit-bebas'] as const) {
      const fe = buildFE(s, EI, L, 24)
      const P = 0.5 * pcr(s, EI, L)
      const r = imperfect(fe, s, P, 0, 10)
      const t = imperfectTheory(s, EI, L, P, 0, 10)
      expect(r.w[s === 'sendi' ? 12 : 24]).toBeGreaterThan(0) // searah lengkung (+)
      expect(r.dMax / t.d).toBeCloseTo(1, 2)
      expect(Math.abs(r.Mmax / t.M - 1)).toBeLessThan(0.01)
    }
  })

  it('jepit–jepit: eksentrisitas dipikul tumpuan (lendutan nol)', () => {
    const r = imperfect(buildFE('jepit', EI, L, 24), 'jepit', 1e5, 0, 10)
    expect(r.dMax).toBeLessThan(1e-9)
  })

  it('Southwell mengembalikan Pcr dan e0 dari data uji', () => {
    const fe = buildFE('sendi', EI, L, 24)
    const P1 = pcr('sendi', EI, L)
    const pts = [0.3, 0.45, 0.6, 0.75, 0.9].map((a) => ({ P: a * P1, d: imperfect(fe, 'sendi', a * P1, 4, 0).dMax }))
    const sw = southwell(pts)!
    expect(sw.Pcr / P1).toBeCloseTo(1, 4)
    expect(sw.e0).toBeCloseTo(4, 3)
    // dengan eksentrisitas: masih mendekati Pcr (di atas 0,5Pcr)
    const pe = [0.5, 0.6, 0.7, 0.8, 0.9].map((a) => ({ P: a * P1, d: imperfect(fe, 'sendi', a * P1, 2, 5).dMax }))
    expect(southwell(pe)!.Pcr / P1).toBeGreaterThan(0.97)
  })

  it('leleh pertama: kolom sempurna = min(A·fy, Pcr)', () => {
    const A = 2600
    const P1 = pcr('sendi', EI, L)
    expect(firstYield(() => 0, A, 1e5, 100, P1)).toBeCloseTo(Math.min(A * 100, P1), 0)
    const t = (P: number) => imperfectTheory('sendi', EI, L, P, 3, 0).M
    const py = firstYield(t, A, 2.66e4, 250, P1)
    expect(py / A + t(py) / 2.66e4).toBeCloseTo(250, 3)
  })
})

describe('kurva kolom', () => {
  it('SNI 1729 E3 kontinu di 4,71√(E/fy) dan = fy di λ → 0', () => {
    const E = 200000
    const fy = 250
    const l = sniLimit(E, fy)
    expect(sniFcr(l * (1 - 1e-9), E, fy).Fcr).toBeCloseTo(sniFcr(l * (1 + 1e-9), E, fy).Fcr, 4)
    expect(sniFcr(1e-3, E, fy).Fcr).toBeCloseTo(fy, 6)
    expect(sniFcr(200, E, fy).Fcr).toBeCloseTo((0.877 * Math.PI ** 2 * E) / 200 ** 2, 6)
  })

  it('Perry–Robertson memenuhi persamaannya dan di bawah Euler & fy', () => {
    const E = 200000
    const fy = 250
    for (const lam of [30, 80, 150]) {
      const s = perry(lam, E, fy, 0.3)
      const se = (Math.PI ** 2 * E) / lam ** 2
      expect((fy - s) * (se - s)).toBeCloseTo(0.3 * s * se, 4)
      expect(s).toBeLessThan(Math.min(fy, se))
    }
    expect(perry(80, E, fy, 0)).toBeCloseTo(Math.min(fy, (Math.PI ** 2 * E) / 6400), 6)
  })
})

describe('elastica', () => {
  it('P/Pcr klasik: α = 60° → 1,152; α = 120° → 1,885 (tabel Timoshenko)', () => {
    expect(elasticaRatio(Math.sin(Math.PI / 6))).toBeCloseTo(1.1517, 3)
    expect(elasticaRatio(Math.sin(Math.PI / 3))).toBeCloseTo(1.8848, 3)
    expect(kFromRatio(elasticaRatio(0.7))).toBeCloseTo(0.7, 9)
  })

  it('RK4 = integral eliptik (δ, perpendekan, ujung kembali ke sumbu)', () => {
    for (const s of ['sendi', 'jepit-bebas', 'jepit'] as const)
      for (const k of [0.2, 0.6, 0.9]) {
        const num = elastica(s, k)
        const th = elasticaTheory(s, k)
        expect(num.d).toBeCloseTo(th.d, 4)
        expect(num.short).toBeCloseTo(th.short, 4)
        if (s !== 'jepit-bebas') expect(Math.abs(num.tipX)).toBeLessThan(1e-5)
        expect(num.ratio).toBeCloseTo(elasticaRatio(k), 9)
      }
  })

  it('ujung kolom sendi bertemu (perpendekan = L) di α ≈ 130,7°', () => {
    const k = Math.sin((130.7 * Math.PI) / 180 / 2)
    expect(elasticaTheory('sendi', k).short).toBeCloseTo(1, 2)
  })
})
