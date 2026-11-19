import { describe, expect, it } from 'vitest'
import { step } from './forced'
import {
  classicalDamping,
  fromModal,
  modes,
  pushShape,
  stiffness,
  steadyRel,
  toModal,
  uniformW,
} from './mdof'
import { rk4Vec } from './ode'

const H = 1 / 4000

describe('MDOF — analisis modal', () => {
  it('bangunan seragam N lantai: ωj sesuai rumus tertutup', () => {
    for (const N of [2, 3, 5]) {
      const m = 1e5
      const k = 4e7
      const md = modes(new Array(N).fill(m), new Array(N).fill(k))
      for (let j = 1; j <= N; j++) expect(md.w[j - 1] / uniformW(N, m, k, j)).toBeCloseTo(1, 10)
    }
  })

  it('ortogonalitas: φᵀMφ = I dan φᵀKφ = diag(ω²)', () => {
    const ms = [1.2e5, 1e5, 0.8e5, 0.5e5]
    const ks = [2e7, 5e7, 4e7, 3e7]
    const md = modes(ms, ks)
    const K = stiffness(ks)
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++) {
        let mm = 0
        let kk = 0
        for (let i = 0; i < 4; i++) {
          mm += md.phi[a][i] * ms[i] * md.phi[b][i]
          for (let j = 0; j < 4; j++) kk += md.phi[a][i] * K[i][j] * md.phi[b][j]
        }
        expect(mm).toBeCloseTo(a === b ? 1 : 0, 10)
        expect(kk / (md.w[a] * md.w[a])).toBeCloseTo(a === b ? 1 : 0, 8)
      }
  })

  it('jumlah massa efektif = massa total; Σ Γn·φn = 1', () => {
    const ms = [1e5, 1e5, 0.6e5]
    const md = modes(ms, [3e7, 4e7, 4e7])
    expect(md.meff.reduce((a, b) => a + b, 0) / ms.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
    const one = fromModal(md, md.gamma)
    for (const v of one) expect(v).toBeCloseTo(1, 10)
  })

  it('bentuk dorong statis: K·u sebanding gaya di satu lantai', () => {
    const ks = [2e7, 3e7, 4e7]
    const u = pushShape(ks, 1, 0.05)
    expect(u[1]).toBeCloseTo(0.05, 12)
    const f = stiffness(ks).map((r) => r.reduce((s, v, j) => s + v * u[j], 0))
    expect(Math.abs(f[0]) / Math.abs(f[1])).toBeLessThan(1e-9)
    expect(Math.abs(f[2]) / Math.abs(f[1])).toBeLessThan(1e-9)
  })
})

describe('MDOF — respons dinamis', () => {
  const ms = [1e5, 1e5, 0.8e5]
  const ks = [3e7, 4e7, 4e7]
  const zeta = 0.03
  const md = modes(ms, ks)
  const n = ms.length

  /** Integrasi langsung sistem penuh M ü + C u̇ + K u = −M·1·üg(t). */
  function direct(u0: number[], tEnd: number, ag: (t: number) => number) {
    const K = stiffness(ks)
    const C = classicalDamping(md, zeta)
    let t = 0
    // y = [u…, v…, t]
    let y = [...u0, ...new Array(n).fill(0), 0]
    const f = (s: number[]) => {
      const out = new Array(2 * n + 1).fill(0)
      for (let i = 0; i < n; i++) {
        out[i] = s[n + i]
        let r = -ms[i] * ag(s[2 * n])
        for (let j = 0; j < n; j++) r -= K[i][j] * s[j] + C[i][j] * s[n + j]
        out[n + i] = r / ms[i]
      }
      out[2 * n] = 1
      return out
    }
    while (t < tEnd - 1e-12) {
      y = rk4Vec(f, y, H)
      t += H
    }
    return y.slice(0, n)
  }

  /** Integrasi modal (SDOF per mode, pakai step Room Resonance). */
  function modal(u0: number[], tEnd: number, w: number, ug0: number) {
    let st = toModal(md, u0).map((q, k) => ({ u: q, v: 0, psi: 0, k }))
    let t = 0
    while (t < tEnd - 1e-12) {
      st = st.map((s) => {
        const wn = md.w[s.k]
        const nx = step({ m: 1, k: wn * wn, c: 2 * zeta * wn, p0: md.gamma[s.k] * w * w * ug0, w }, s, H)
        return { ...nx, k: s.k }
      })
      t += H
    }
    return fromModal(
      md,
      st.map((s) => s.u),
    )
  }

  it('getaran bebas dari bentuk dorong: modal = integrasi langsung sistem penuh', () => {
    const u0 = pushShape(ks, 2, 0.03)
    const a = direct(u0, 2, () => 0)
    const b = modal(u0, 2, 0, 0)
    for (let i = 0; i < n; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-9)
  })

  it('gerak tanah harmonik: modal = langsung', () => {
    const w = 0.9 * md.w[0]
    const ug0 = 0.01
    const a = direct([0, 0, 0], 3, (t) => -w * w * ug0 * Math.sin(w * t))
    const b = modal([0, 0, 0], 3, w, ug0)
    for (let i = 0; i < n; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-8)
  })

  it('getaran pada satu mode: periode terukur = Tn dan bentuk tetap', () => {
    const k = 1
    const u0 = md.phi[k].map((x) => (x * 0.02) / md.phi[k][n - 1])
    let st = toModal(md, u0).map((q) => ({ u: q, v: 0, psi: 0 }))
    const peaks: number[] = []
    let prevV = 0
    for (let t = 0; t < 3; t += H) {
      st = st.map((s, i) => step({ m: 1, k: md.w[i] ** 2, c: 0, p0: 0, w: 0 }, s, H))
      const roofV = fromModal(
        md,
        st.map((s) => s.v),
      )[n - 1]
      if (prevV > 0 && roofV <= 0) peaks.push(t)
      prevV = roofV
    }
    expect(peaks[2] - peaks[1]).toBeCloseTo(md.T[k], 3)
  })

  it('amplitudo tunak (modal kompleks) = puncak simulasi panjang', () => {
    const w = 1.3 * md.w[0]
    const ug0 = 0.01
    const amp = steadyRel(md, zeta, w, ug0)
    // simulasi dari keadaan diam sampai transien hilang, lalu cari puncak atap
    let st = md.w.map(() => ({ u: 0, v: 0, psi: 0 }))
    let maxRoof = 0
    const T = (2 * Math.PI) / w
    const tSettle = 12 / (zeta * md.w[0])
    for (let t = 0; t < tSettle + 2 * T; t += H) {
      st = st.map((s, i) => step({ m: 1, k: md.w[i] ** 2, c: 2 * zeta * md.w[i], p0: md.gamma[i] * w * w * ug0, w }, s, H))
      if (t > tSettle) {
        const u = fromModal(
          md,
          st.map((s) => s.u),
        )
        maxRoof = Math.max(maxRoof, Math.abs(u[n - 1]))
      }
    }
    expect(maxRoof / amp[n - 1]).toBeCloseTo(1, 3)
  })
})

describe('MDOF — pengukuran tunak', () => {
  it('measureRoof dari diam = steadyRel; steadyModal konsisten dengan steadyRel', async () => {
    const { measureRoof, steadyModal, fromModal: fm } = await import('./mdof')
    const md = modes([1e5, 1e5, 1e5], [4e7, 4e7, 4e7])
    for (const r of [0.6, 1, 2.2]) {
      const w = r * md.w[0]
      const th = steadyRel(md, 0.05, w, 0.01)[2]
      expect(measureRoof(md, 0.05, w, 0.01)! / th).toBeCloseTo(1, 2)
      // puncak dari keadaan tunak analitis di banyak fase
      let mx = 0
      for (let i = 0; i < 400; i++) {
        const q = steadyModal(md, 0.05, w, 0.01, (i / 400) * 2 * Math.PI)
        mx = Math.max(mx, fm(md, q.map((x) => x.u))[2])
      }
      expect(mx / th).toBeCloseTo(1, 3)
    }
  })
})
