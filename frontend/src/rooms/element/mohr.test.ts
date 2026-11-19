import { describe, expect, it } from 'vitest'
import { gauge, hooke, principal, principal3, principalStrain, tauAbs, transform, transformStrain, tresca, vonMises, type Stress } from './mohr'

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol)
const cases: Stress[] = [
  { sx: 80, sy: -40, txy: 30 },
  { sx: 0, sy: 0, txy: 60 },
  { sx: -25, sy: 70, txy: -45 },
  { sx: 100, sy: 0, txy: 0 },
  { sx: -10, sy: -90, txy: 5 },
]

describe('Transformasi tegangan', () => {
  it('invarian: σx + σy dan determinan tetap untuk semua θ', () => {
    for (const s of cases) {
      const I1 = s.sx + s.sy
      const I2 = s.sx * s.sy - s.txy ** 2
      for (let th = -90; th <= 90; th += 7.5) {
        const t = transform(s, th)
        close(t.sx + t.sy, I1)
        close(t.sx * t.sy - t.txy ** 2, I2, 1e-7)
      }
    }
  })

  it('θ = 90° menukar σx dan σy serta membalik tanda τ', () => {
    for (const s of cases) {
      const t = transform(s, 90)
      close(t.sx, s.sy)
      close(t.sy, s.sx)
      close(t.txy, -s.txy)
    }
  })

  it('kesetimbangan baji: traksi pada bidang miring cocok dengan σx′, τx′y′', () => {
    // vektor traksi t = σ·n pada bidang dengan normal n = (cos θ, sin θ)
    for (const s of cases) {
      for (const th of [-60, -20, 15, 33, 80]) {
        const c = Math.cos((th * Math.PI) / 180)
        const n = Math.sin((th * Math.PI) / 180)
        const tx = s.sx * c + s.txy * n
        const ty = s.txy * c + s.sy * n
        const t = transform(s, th)
        close(tx * c + ty * n, t.sx) // komponen normal
        close(-tx * n + ty * c, t.txy) // komponen tangensial (arah +y′)
      }
    }
  })
})

describe('Tegangan utama & lingkaran Mohr', () => {
  it('pada θp: σx′ = σ1, τ = 0; pada θs: τ = ±R dan σ = C', () => {
    for (const s of cases) {
      const p = principal(s)
      const tp = transform(s, p.thetaP)
      close(tp.sx, p.s1)
      close(tp.sy, p.s2)
      close(tp.txy, 0)
      const ts = transform(s, p.thetaS)
      close(Math.abs(ts.txy), p.R)
      close(ts.sx, p.C)
    }
  })

  it('σ1 dan σ2 adalah ekstrem σx′(θ) (pemindaian)', () => {
    for (const s of cases) {
      const p = principal(s)
      let mx = -Infinity
      let mn = Infinity
      for (let th = -90; th <= 90; th += 0.25) {
        const v = transform(s, th).sx
        mx = Math.max(mx, v)
        mn = Math.min(mn, v)
      }
      close(mx, p.s1, 1e-3)
      close(mn, p.s2, 1e-3)
    }
  })

  it('kasus klasik: uniaksial, geser murni, σ–τ campuran', () => {
    const u = principal({ sx: 100, sy: 0, txy: 0 })
    close(u.R, 50)
    close(u.thetaP, 0)
    const g = principal({ sx: 0, sy: 0, txy: 60 })
    close(g.s1, 60)
    close(g.s2, -60)
    close(g.thetaP, 45)
    // σx = −20, σy = 90, τ = 60 → C = 35, R = √(55² + 60²) = 81,39
    const h = principal({ sx: -20, sy: 90, txy: 60 })
    close(h.C, 35)
    close(h.R, Math.hypot(55, 60))
  })

  it('3D: σz = 0 dengan σ1, σ2 bertanda sama → τ mutlak = σ1/2 (lebih besar dari R)', () => {
    const s = { sx: 40, sy: 80, txy: 0 }
    close(principal(s).R, 20)
    close(tauAbs(s, 0), 40)
    expect(principal3(s, 0)).toEqual([80, 40, 0])
  })

  it('Von Mises & Tresca', () => {
    close(vonMises({ sx: 100, sy: 0, txy: 0 }), 100)
    close(vonMises({ sx: 0, sy: 0, txy: 60 }), 60 * Math.sqrt(3))
    close(tresca({ sx: 0, sy: 0, txy: 60 }), 120)
    close(vonMises({ sx: 50, sy: 50, txy: 0 }, 50), 0) // hidrostatik penuh
  })
})

describe('Regangan & Hooke', () => {
  it('tarik uniaksial: εy = −ν εx, G = E / 2(1+ν)', () => {
    const e = hooke({ sx: 200, sy: 0, txy: 0 }, 200, 0.3)
    close(e.ex, 0.001)
    close(e.ey, -0.0003)
    close(e.ez, -0.0003)
    close(e.G, 200 / 2.6)
  })

  it('arah utama regangan = arah utama tegangan (bahan isotrop)', () => {
    for (const s of cases) {
      if (principal(s).R < 1e-9) continue
      const e = hooke(s, 200, 0.3)
      close(principalStrain(e).thetaP, principal(s).thetaP, 1e-9)
    }
  })

  it('transformasi regangan konsisten dengan Hooke pada sumbu putar', () => {
    for (const s of cases) {
      for (const th of [-35, 10, 60]) {
        const e1 = transformStrain(hooke(s, 70, 0.33), th)
        const e2 = hooke(transform(s, th), 70, 0.33)
        close(e1.ex, e2.ex, 1e-12)
        close(e1.ey, e2.ey, 1e-12)
        close(e1.gxy, e2.gxy, 1e-12)
      }
    }
  })

  it('rosette 0-45-90 mengembalikan εx, εy, γxy', () => {
    const e = hooke({ sx: 80, sy: -40, txy: 30 }, 200, 0.3)
    const a = gauge(e, 0)
    const b = gauge(e, 45)
    const c = gauge(e, 90)
    close(a, e.ex, 1e-15)
    close(c, e.ey, 1e-15)
    close(2 * b - a - c, e.gxy, 1e-15)
  })
})
