import { describe, expect, it } from 'vitest'
import { buildParts, defaults, type Shape } from './model'
import { gridScan, hull, inside, kern, plastic, props, Q, rotated, shearProfile, sigma, stressPlane, tauAt, width, type Part } from './section'

const parts = (shape: Shape, over: Record<string, number> = {}) => buildParts(shape, { ...defaults('properti', shape), ...over })
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12)

describe('properti penampang', () => {
  it('persegi: A, I, S, Z, faktor bentuk 1,5', () => {
    const b = 300
    const h = 500
    const pr = props(parts('persegi', { b, h }))
    expect(pr.A).toBeCloseTo(b * h, 6)
    expect(pr.yc).toBeCloseTo(h / 2, 9)
    expect(rel(pr.Ix, (b * h ** 3) / 12)).toBeLessThan(1e-12)
    expect(rel(pr.Iy, (h * b ** 3) / 12)).toBeLessThan(1e-12)
    expect(rel(pr.Sxt, (b * h * h) / 6)).toBeLessThan(1e-12)
    const pl = plastic(parts('persegi', { b, h }))
    expect(rel(pl.Zx, (b * h * h) / 4)).toBeLessThan(1e-9)
    expect(pl.Zx / pr.Sxt).toBeCloseTo(1.5, 9)
  })

  it('WF: rumus tangan Ix dan Zx', () => {
    const d = { b: 200, h: 400, tf: 13, tw: 8 }
    const pr = props(parts('wf', d))
    const Ix = (d.b * d.h ** 3 - (d.b - d.tw) * (d.h - 2 * d.tf) ** 3) / 12
    expect(rel(pr.Ix, Ix)).toBeLessThan(1e-12)
    const Zx = d.b * d.tf * (d.h - d.tf) + (d.tw * (d.h - 2 * d.tf) ** 2) / 4
    expect(rel(plastic(parts('wf', d)).Zx, Zx)).toBeLessThan(1e-9)
  })

  it('lingkaran dan pipa: πD⁴/64, Z = D³/6', () => {
    const D = 300
    const solid = parts('pipa', { D, t: D / 2 })
    expect(solid.length).toBe(1)
    const pr = props(solid)
    expect(rel(pr.Ix, (Math.PI * D ** 4) / 64)).toBeLessThan(1e-12)
    expect(rel(plastic(solid).Zx, D ** 3 / 6)).toBeLessThan(1e-9)
    const t = 10
    const pp = props(parts('pipa', { D, t }))
    expect(rel(pp.Ix, (Math.PI * (D ** 4 - (D - 2 * t) ** 4)) / 64)).toBeLessThan(1e-12)
  })

  it('T: titik berat dan garis netral plastis membagi luas sama', () => {
    const d = { b: 250, h: 300, tf: 20, tw: 12 }
    const ps = parts('tee', d)
    const pr = props(ps)
    const Af = d.b * d.tf
    const Aw = d.tw * (d.h - d.tf)
    expect(pr.yc).toBeCloseTo((Af * (d.h - d.tf / 2) + (Aw * (d.h - d.tf)) / 2) / (Af + Aw), 9)
    const pl = plastic(ps)
    // Af > Aw → PNA di dalam sayap
    expect(pl.yp).toBeGreaterThan(d.h - d.tf)
    expect(pr.Sxt).toBeGreaterThan(pr.Sxb) // serat atas lebih dekat ke titik berat
  })

  it('siku sama kaki: sumbu utama 45°, invarian Ix + Iy', () => {
    const ps = parts('siku', { b: 120, h: 120, t: 12 })
    const pr = props(ps)
    expect(pr.Ixy).toBeLessThan(0)
    expect(Math.abs(Math.abs(pr.thP) - 45)).toBeLessThan(1e-9)
    expect(rel(pr.I1 + pr.I2, pr.Ix + pr.Iy)).toBeLessThan(1e-12)
    const r = rotated(pr, pr.thP)
    expect(rel(r.Iu, pr.I1)).toBeLessThan(1e-12)
    expect(Math.abs(r.Iuv)).toBeLessThan(1e-6 * pr.I1)
  })

  it("integrasi grid mendekati hasil eksak (semua bentuk; galat ≈ ukuran sel / tebal pelat)", () => {
    for (const s of ['persegi', 'kotak', 'wf', 'tee', 'kanal', 'siku', 'zee', 'pipa'] as Shape[]) {
      const ps = parts(s)
      const pr = props(ps)
      const g = gridScan(ps, 600)
      expect(rel(g.A, pr.A), s).toBeLessThan(0.03)
      expect(rel(g.Ix, pr.Ix), s).toBeLessThan(0.03)
      expect(rel(g.Iy, pr.Iy), s).toBeLessThan(0.03)
      expect(Math.abs(g.Ixy - pr.Ixy) / pr.Ix, s).toBeLessThan(0.01)
    }
  })
})

/** Integrasi numerik ∫σ dA, ∫σ(y−yc) dA, ∫σ(x−xc) dA pada grid. */
function resultants(ps: Part[], f: (x: number, y: number) => number, n = 500) {
  const pr = props(ps)
  const hx = (pr.xmax - pr.xmin) / n
  const hy = (pr.ymax - pr.ymin) / n
  let N = 0
  let My = 0
  let Mx = 0
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = pr.xmin + (i + 0.5) * hx
      const y = pr.ymin + (j + 0.5) * hy
      if (inside(ps, x, y) <= 0) continue
      const s = f(x, y) * hx * hy
      N += s
      My += s * (y - pr.yc)
      Mx += s * (x - pr.xc)
    }
  return { N, Sy: My, Sx: Mx }
}

describe('tegangan normal', () => {
  it('lentur murni simetris: σ = −M·y/I, garis netral di titik berat', () => {
    const ps = parts('wf')
    const pr = props(ps)
    const pl = stressPlane(pr, 0, 100, 0)
    expect(sigma(pl, pr, pr.xc, pr.ymax)).toBeCloseTo(-100e6 / pr.Sxt, 6)
    expect(sigma(pl, pr, pr.xc, pr.yc)).toBeCloseTo(0, 9)
    expect(pl.a).toBeCloseTo(0, 12)
  })

  it('lentur tak simetris (siku, Z): resultan tegangan = beban', () => {
    for (const s of ['siku', 'zee'] as Shape[]) {
      const ps = parts(s)
      const pr = props(ps)
      const N = -200
      const Mx = 15
      const My = -4
      const pl = stressPlane(pr, N, Mx, My)
      const r = resultants(ps, (x, y) => sigma(pl, pr, x, y))
      expect(rel(r.N / 1e3, N), s).toBeLessThan(0.02)
      expect(rel(-r.Sy / 1e6, Mx), s).toBeLessThan(0.02)
      expect(rel(-r.Sx / 1e6, My), s).toBeLessThan(0.03)
    }
  })

  it('inti persegi: sepertiga tengah (b/6, h/6); beban di sudut inti → σ = 0 pada sisi lawan', () => {
    const b = 300
    const h = 500
    const ps = parts('persegi', { b, h })
    const pr = props(ps)
    const k = kern(pr, hull(ps))
    expect(k.length).toBe(4)
    const ex = k.map(([x]) => Math.abs(x - pr.xc))
    const ey = k.map(([, y]) => Math.abs(y - pr.yc))
    expect(Math.max(...ex)).toBeCloseTo(b / 6, 9)
    expect(Math.max(...ey)).toBeCloseTo(h / 6, 9)
    // P tekan di titik inti atas (ey = +h/6) → serat bawah σ = 0
    const P = -500
    const ey6 = h / 6
    const pl = stressPlane(pr, P, -P * ey6 * 1e-3, 0)
    expect(sigma(pl, pr, 0, 0)).toBeCloseTo(0, 9)
    expect(sigma(pl, pr, 0, h)).toBeCloseTo((2 * P * 1e3) / pr.A, 9)
  })

  it('inti lingkaran: jari-jari D/8', () => {
    const D = 400
    const ps = parts('pipa', { D, t: D / 2 })
    const pr = props(ps)
    for (const [x, y] of kern(pr, hull(ps))) expect(Math.hypot(x - pr.xc, y - pr.yc) / (D / 8)).toBeCloseTo(1, 2)
  })
})

describe('tegangan geser', () => {
  it('persegi: τmaks = 1,5·V/A di garis netral, nol di serat luar', () => {
    const ps = parts('persegi')
    const pr = props(ps)
    const V = 200e3
    expect(tauAt(ps, pr, V, pr.yc) / (V / pr.A)).toBeCloseTo(1.5, 9)
    expect(tauAt(ps, pr, V, pr.ymax)).toBeCloseTo(0, 9)
  })

  it('lingkaran 4/3·V/A, pipa tipis ≈ 2·V/A', () => {
    const V = 100e3
    const solid = parts('pipa', { D: 300, t: 150 })
    const ps = props(solid)
    expect(tauAt(solid, ps, V, ps.yc) / (V / ps.A)).toBeCloseTo(4 / 3, 6)
    const thin = parts('pipa', { D: 300, t: 3 })
    const pt = props(thin)
    expect(tauAt(thin, pt, V, pt.yc) / (V / pt.A)).toBeCloseTo(2, 1)
  })

  it('WF: ∫τ·b dy = V; badan memikul sebagian besar gaya lintang', () => {
    const ps = parts('wf')
    const pr = props(ps)
    const V = 300e3
    const n = 4000
    const dy = (pr.ymax - pr.ymin) / n
    let sum = 0
    let web = 0
    const tf = 13
    for (let k = 0; k < n; k++) {
      const y = pr.ymin + (k + 0.5) * dy
      const f = tauAt(ps, pr, V, y) * width(ps, y) * dy
      sum += f
      if (y > tf && y < pr.ymax - tf) web += f
    }
    expect(rel(sum, V)).toBeLessThan(1e-3)
    expect(web / V).toBeGreaterThan(0.9)
    // profil punya loncatan di pertemuan sayap–badan
    const prof = shearProfile(ps, pr, V)
    const atJ = prof.filter((p) => Math.abs(p.y - (pr.ymax - tf)) < 1e-9)
    expect(atJ.length).toBe(2)
    expect(atJ[1].tau / atJ[0].tau).toBeCloseTo(200 / 8, 6)
  })

  it('Q di titik berat = Zx/2 untuk penampang simetris', () => {
    const ps = parts('wf')
    const pr = props(ps)
    expect(rel(Q(ps, pr, pr.yc).Qx, plastic(ps).Zx / 2)).toBeLessThan(1e-9)
  })
})
