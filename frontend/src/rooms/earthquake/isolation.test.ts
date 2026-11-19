import { describe, expect, it } from 'vitest'
import { agAt, sdofResponse, synth } from '../../lab/ground'
import { isoModes, isoStep, isoSystem } from './isolation'

describe('Isolasi dasar 2DOF', () => {
  it('isolator sangat kaku → struktur berperilaku seperti terjepit', () => {
    const rec = synth('keras', 0.3, 5, 6)
    const s = isoSystem({ T: 0.5, zeta: 0.05, Tiso: 0.01, zetaIso: 0.05, mbRatio: 0.5 })
    const h = 1e-4
    let y = [0, 0, 0, 0]
    let mx = 0
    for (let t = 0; t < 6 - 1e-9; t += h) {
      y = isoStep(s, y, agAt(rec, t), agAt(rec, t + h), h)
      mx = Math.max(mx, Math.abs(y[1]))
    }
    const fixed = sdofResponse(rec, 0.5, 0.05).Sd
    expect(mx / fixed).toBeCloseTo(1, 2)
  })

  it('frekuensi alami: mode 1 mendekati 2π/Tiso bila struktur jauh lebih kaku', () => {
    const s = isoSystem({ T: 0.2, zeta: 0, Tiso: 3, zetaIso: 0, mbRatio: 0.5 })
    const [w1, w2] = isoModes(s)
    expect(w1 / ((2 * Math.PI) / 3)).toBeCloseTo(1, 1)
    expect(w2).toBeGreaterThan((2 * Math.PI) / 0.2)
  })

  it('isolasi mengurangi drift struktur untuk gempa tanah keras', () => {
    const rec = synth('keras', 0.4, 9)
    const s = isoSystem({ T: 0.4, zeta: 0.05, Tiso: 2.5, zetaIso: 0.15, mbRatio: 0.5 })
    const h = 0.002
    let y = [0, 0, 0, 0]
    let mx = 0
    const dur = (rec.a.length - 1) * rec.dt
    for (let t = 0; t < dur - 1e-9; t += h) {
      y = isoStep(s, y, agAt(rec, t), agAt(rec, t + h), h)
      mx = Math.max(mx, Math.abs(y[1]))
    }
    expect(mx).toBeLessThan(0.4 * sdofResponse(rec, 0.4, 0.05).Sd)
  })
})
