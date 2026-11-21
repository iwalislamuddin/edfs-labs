import { describe, expect, it } from 'vitest'
import {
  Ag,
  analyze,
  chordFromData,
  chordModulus,
  clampSteel,
  concreteEc,
  eFracture,
  elongation,
  envelope,
  eUpper,
  hasNeck,
  hognestad,
  neck,
  neckSigma,
  permanentSet,
  popovics,
  popovicsParams,
  presetById,
  respond,
  sigmaUniform,
  splitFromLoad,
  splitStress,
  STEELS,
  theoryCurve,
  toughness,
} from './material'

const bj41 = presetById('bj41').m
const hs = presetById('hs').m
const ci = presetById('ci').m

describe('kurva seragam', () => {
  it('plateau: elastis → leleh atas → leleh bawah → pengerasan kontinu, Rm di εu', () => {
    const eH = eUpper(bj41)
    expect(sigmaUniform(bj41, eH)).toBeCloseTo(bj41.up * bj41.fy, 6)
    expect(sigmaUniform(bj41, eH + 0.0004)).toBeCloseTo(bj41.fy, 6)
    expect(sigmaUniform(bj41, bj41.esh)).toBeCloseTo(bj41.fy, 6)
    expect(sigmaUniform(bj41, bj41.esh + 1e-7)).toBeCloseTo(bj41.fy, 3)
    expect(sigmaUniform(bj41, bj41.eu)).toBeCloseTo(bj41.fu, 6)
    // kemiringan awal pengerasan = Esh
    const d = 1e-6
    expect((sigmaUniform(bj41, bj41.esh + d) - bj41.fy) / d).toBeCloseTo(bj41.Esh, -1)
    // mendatar di εu
    expect((bj41.fu - sigmaUniform(bj41, bj41.eu - d)) / d).toBeLessThan(1)
  })
  it('Ramberg–Osgood melewati (fy/E + 0,2%, fy) dan (εu, fu)', () => {
    expect(sigmaUniform(hs, hs.fy / hs.E + 0.002)).toBeCloseTo(hs.fy, 4)
    expect(sigmaUniform(hs, hs.eu)).toBeCloseTo(hs.fu, 3)
    expect(sigmaUniform(hs, 0.001)).toBeCloseTo(hs.E * 0.001, -1)
  })
})

describe('necking', () => {
  const nk = neck(bj41)
  it('Considère: tegangan teknik leher maksimum tepat di εt = n', () => {
    expect(neckSigma(nk, nk.etu)).toBeCloseTo(bj41.fu, 6)
    expect(neckSigma(nk, nk.etu + 0.01)).toBeLessThan(bj41.fu)
    expect(neckSigma(nk, nk.etu - 0.01)).toBeLessThan(bj41.fu)
    // dσt/dεt = σt pada titik necking
    const h = 1e-6
    const st = (t: number) => nk.K * t ** nk.n
    expect((st(nk.etu + h) - st(nk.etu - h)) / (2 * h)).toBeCloseTo(st(nk.etu), 2)
  })
  it('selubung kontinu di awal necking dan turun sampai putus', () => {
    expect(envelope(bj41, 5, bj41.eu + 1e-7).s).toBeCloseTo(bj41.fu, 2)
    const ef = eFracture(bj41, 5)
    const a = envelope(bj41, 5, bj41.eu + 0.3 * (ef - bj41.eu)).s
    const b = envelope(bj41, 5, bj41.eu + 0.8 * (ef - bj41.eu)).s
    expect(b).toBeLessThan(a)
    expect(envelope(bj41, 5, ef + 1e-6).broken).toBe(true)
    // luas leher di patahan = A0(1 − Z)
    expect(Math.exp(-envelope(bj41, 5, ef - 1e-9).t!)).toBeCloseTo(1 - bj41.Z, 5)
  })
  it('perpanjangan putus = A5 pada L0 = 5d0 dan mengikuti hukum Barba (A − Ag ∝ d0/L0)', () => {
    for (const p of STEELS) {
      if (!hasNeck(p.m)) continue
      expect(elongation(p.m, 5)).toBeCloseTo(p.m.A5, 6)
    }
    const g = (k: number) => elongation(bj41, k) - Ag(bj41)
    expect(g(10) / g(5)).toBeCloseTo(0.5, 6)
    expect(elongation(bj41, 10)).toBeLessThan(elongation(bj41, 5))
  })
  it('bahan getas putus di εu tanpa leher', () => {
    expect(hasNeck(ci)).toBe(false)
    expect(eFracture(ci, 5)).toBeCloseTo(ci.eu, 9)
    expect(envelope(ci, 5, ci.eu * 1.01).broken).toBe(true)
  })
})

describe('bongkar–muat', () => {
  it('bongkar sejajar E, regangan permanen = εmax − σ/E, muat ulang bertemu selubung', () => {
    const emax = 0.06
    const s = envelope(bj41, 5, emax).s
    const ep = permanentSet(bj41, 5, emax)
    expect(ep).toBeCloseTo(emax - s / bj41.E, 12)
    expect(respond(bj41, 5, emax, ep).s).toBeCloseTo(0, 6)
    expect(respond(bj41, 5, emax, ep - 0.001).s).toBe(0)
    expect(respond(bj41, 5, emax, emax - 0.0005).s).toBeCloseTo(s - bj41.E * 0.0005, 6)
    expect(respond(bj41, 5, emax, emax).s).toBeCloseTo(s, 9)
  })
})

describe('pengolahan data uji', () => {
  const run = (m: typeof bj41, k: number) => {
    const pts: [number, number][] = []
    const ef = eFracture(m, k)
    // daerah elastis–leleh dirapatkan seperti laju pembebanan mesin
    const ez = Math.min(0.02, ef)
    for (let i = 0; i < 8000; i++) pts.push([(ez * i) / 8000, envelope(m, k, (ez * i) / 8000).s])
    for (let i = 0; i <= 8000; i++) {
      const e = ez + ((ef * 1.001 - ez) * i) / 8000
      pts.push([e, envelope(m, k, e).s])
    }
    return pts
  }
  it('baja plateau: E, ReH, ReL, Rm, Ag, A terbaca dari data', () => {
    const r = analyze(run(bj41, 5), true)
    expect(r.E! / bj41.E).toBeCloseTo(1, 3)
    expect(r.ReH!).toBeCloseTo(bj41.up * bj41.fy, 0)
    expect(r.ReL!).toBeCloseTo(bj41.fy, 3)
    expect(r.Rm!).toBeCloseTo(bj41.fu, 1)
    expect(r.Ag!).toBeCloseTo(Ag(bj41), 2)
    expect(r.A!).toBeCloseTo(bj41.A5, 3)
    expect(r.U).toBeCloseTo(toughness(bj41, 5), 0)
  })
  it('tanpa plateau: Rp0,2 = fy, tidak ada leleh atas', () => {
    const r = analyze(run(hs, 5), true)
    expect(r.ReH).toBeNull()
    expect(r.Rp02!).toBeCloseTo(hs.fy, 0)
  })
  it('besi cor: tidak salah membaca leleh atas dari patah getas', () => {
    expect(analyze(run(ci, 5), true).ReH).toBeNull()
  })
  it('ketangguhan di antara fy·εf dan fu·εf', () => {
    for (const p of STEELS) {
      const U = toughness(p.m, 5)
      const ef = eFracture(p.m, 5)
      expect(U).toBeLessThan(p.m.fu * ef)
      expect(U).toBeGreaterThan(0.4 * p.m.fy * ef)
    }
  })
  it('clamp menjaga urutan εy < εsh < εu dan Z cukup untuk necking', () => {
    const m = clampSteel({ ...bj41, fy: 600, fu: 500, eu: 0.01, Z: 0.05 })
    expect(m.fu).toBeGreaterThan(m.fy)
    expect(m.esh).toBeGreaterThan(eUpper(m))
    expect(m.eu).toBeGreaterThan(m.esh)
    expect(hasNeck(m)).toBe(true)
    const pts = theoryCurve(m, 5)
    for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeGreaterThanOrEqual(pts[i - 1][0])
  })
})

describe('beton', () => {
  it('Popovics: puncak fc′ di ε0, kemiringan awal = Ec', () => {
    for (const fc of [20, 30, 50, 80]) {
      const p = popovicsParams(fc)
      expect(popovics(fc, p.e0)).toBeCloseTo(fc, 6)
      expect(popovics(fc, p.e0 * 1.01)).toBeLessThan(fc)
      expect(popovics(fc, 1e-7) / 1e-7).toBeCloseTo(concreteEc(fc), -2)
    }
  })
  it('Hognestad: puncak fc′ di 2fc′/Ec, 0,85fc′ di 0,0038', () => {
    const fc = 30
    expect(hognestad(fc, (2 * fc) / concreteEc(fc))).toBeCloseTo(fc, 9)
    expect(hognestad(fc, 0.0038)).toBeCloseTo(0.85 * fc, 9)
  })
  it('modulus chord ASTM C469 sedikit di bawah modulus awal, data = teori', () => {
    const fc = 30
    const c = chordModulus((e) => popovics(fc, e), 0.4 * fc)
    expect(c.E / concreteEc(fc)).toBeGreaterThan(0.85)
    expect(c.E / concreteEc(fc)).toBeLessThan(1)
    const pts: [number, number][] = []
    for (let i = 0; i <= 4000; i++) pts.push([i * 1e-6, popovics(fc, i * 1e-6)])
    expect(chordFromData(pts, 0.4 * fc)!.E / c.E).toBeCloseTo(1, 3)
  })
  it('uji belah: σx = 2P/(πLD) merata, σy pusat = −3·σx', () => {
    const P = 200e3
    const s = splitStress(P, 300, 150, 75)
    expect(s.sx).toBeCloseTo(splitFromLoad(P, 300, 150), 9)
    expect(s.sy).toBeCloseTo(-3 * s.sx, 9)
  })
})

describe('pengolahan data bongkar–muat', () => {
  it('titik bongkar dan muat ulang tidak mengganggu ReL, E, dan ketangguhan', () => {
    const m = presetById('bj41').m
    const pts: [number, number][] = []
    let emax = 0
    const go = (a: number, b: number, n: number) => {
      for (let i = 0; i <= n; i++) {
        const e = a + ((b - a) * i) / n
        emax = Math.max(emax, e)
        pts.push([e, respond(m, 5, emax, e).s])
      }
    }
    go(0, 0.009, 4000)
    go(0.009, permanentSet(m, 5, 0.009), 200)
    go(permanentSet(m, 5, 0.009), 0.05, 4000)
    const r = analyze(pts, false)
    expect(r.ReL!).toBeCloseTo(m.fy, 3)
    expect(r.E! / m.E).toBeCloseTo(1, 3)
  })
})
