import { describe, expect, it } from 'vitest'
import { agAt, G, groundMotion, njCoef, sdofResponse, sniSa, spectrum, synth, type Record } from './ground'

/** RK4 langkah sangat kecil dengan ag interpolasi linier — pembanding Nigam–Jennings. */
function rk4Ref(rec: Record, T: number, zeta: number) {
  const w = (2 * Math.PI) / T
  const h = rec.dt / 40
  let u = 0
  let v = 0
  let t = 0
  const f = (tt: number, uu: number, vv: number) => -agAt(rec, tt) - 2 * zeta * w * vv - w * w * uu
  const out: number[] = [0]
  const tEnd = (rec.a.length - 1) * rec.dt
  let k = 0
  while (t < tEnd - 1e-12) {
    const a1 = f(t, u, v)
    const a2 = f(t + h / 2, u + (h / 2) * v, v + (h / 2) * a1)
    const a3 = f(t + h / 2, u + (h / 2) * (v + (h / 2) * a1), v + (h / 2) * a2)
    const a4 = f(t + h, u + h * (v + (h / 2) * a2), v + h * a3)
    u += (h / 6) * (v + 2 * (v + (h / 2) * a1) + 2 * (v + (h / 2) * a2) + (v + h * a3))
    v += (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4)
    t += h
    if (++k % 40 === 0) out.push(u)
  }
  return out
}

describe('Gerak tanah — integrasi eksak SDOF', () => {
  it('Nigam–Jennings = RK4 halus pada rekaman acak', () => {
    const rec = synth('keras', 0.3, 7, 6)
    for (const [T, z] of [
      [0.3, 0.05],
      [1.0, 0.02],
      [2.0, 0.1],
    ]) {
      const nj: number[] = []
      sdofResponse(rec, T, z, nj)
      const ref = rk4Ref(rec, T, z)
      const n = Math.min(nj.length, ref.length)
      let err = 0
      let mx = 0
      for (let i = 0; i < n; i++) {
        err = Math.max(err, Math.abs(nj[i] - ref[i]))
        mx = Math.max(mx, Math.abs(ref[i]))
      }
      expect(err / mx).toBeLessThan(1e-6)
    }
  })

  it('getaran bebas: koefisien A, B memberi solusi eksak', () => {
    const w = 5
    const z = 0.05
    const dt = 0.01
    const c = njCoef(w, z, dt)
    let u = 0.1
    let v = 0
    for (let i = 0; i < 300; i++) {
      const un = c.A * u + c.B * v
      v = c.A1 * u + c.B1 * v
      u = un
    }
    const t = 3
    const wd = w * Math.sqrt(1 - z * z)
    const ex = 0.1 * Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t))
    expect(u).toBeCloseTo(ex, 12)
  })
})

describe('Spektrum respons', () => {
  it('T sangat pendek → PSa ≈ PGA; T sangat panjang → Sd ≈ PGD', () => {
    const rec = synth('keras', 0.4, 3)
    const sp = spectrum(rec, 0.05, [0.02, 20])
    expect(sp[0].PSa / (0.4 * G)).toBeCloseTo(1, 1)
    const gm = groundMotion(rec)
    // perpindahan relatif periode sangat panjang mendekati −ug; pakai perpindahan tanpa koreksi → toleransi longgar
    expect(sp[1].Sd).toBeGreaterThan(0.3 * gm.pgd)
  })

  it('sinus 1 Hz: puncak spektrum di T ≈ 1 s', () => {
    const rec = synth('sinus', 0.2, 1)
    const sp = spectrum(rec, 0.05)
    const best = sp.reduce((a, b) => (b.PSa > a.PSa ? b : a))
    expect(best.T).toBeGreaterThan(0.9)
    expect(best.T).toBeLessThan(1.1)
  })

  it('PSa ≈ percepatan mutlak maksimum untuk redaman kecil', () => {
    const rec = synth('lunak', 0.2, 11)
    for (const p of spectrum(rec, 0.02, [0.2, 0.8, 1.7])) expect(p.PSa / p.amax).toBeCloseTo(1, 1)
  })

  it('rekaman sintetis deterministik per seed dan PGA tepat', () => {
    const a = synth('keras', 0.25, 42)
    const b = synth('keras', 0.25, 42)
    const c = synth('keras', 0.25, 43)
    expect(a.a).toEqual(b.a)
    expect(a.a).not.toEqual(c.a)
    expect(Math.max(...a.a.map(Math.abs)) / G).toBeCloseTo(0.25, 10)
  })
})

describe('Spektrum desain SNI 1726', () => {
  const s = { SDS: 0.8, SD1: 0.5, TL: 6 }
  it('cabang-cabang dan kontinuitas di T0, Ts, TL', () => {
    const T0 = (0.2 * 0.5) / 0.8
    const Ts = 0.5 / 0.8
    expect(sniSa(s, 0)).toBeCloseTo(0.32, 12)
    expect(sniSa(s, T0)).toBeCloseTo(0.8, 12)
    expect(sniSa(s, Ts)).toBeCloseTo(0.8, 12)
    expect(sniSa(s, 1)).toBeCloseTo(0.5, 12)
    expect(sniSa(s, 6)).toBeCloseTo(sniSa(s, 6 + 1e-9), 6)
  })
})
