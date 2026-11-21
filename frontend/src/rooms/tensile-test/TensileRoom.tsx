import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt } from '../../lab/chart'
import { fitCanvas } from '../../lab/draw'
import { Check, Segmented, Slider } from '../../ui/controls'
import { drawCompareChart, drawConcreteChart, drawSteelChart, type CompareItem, type SteelChart } from './charts'
import {
  Ag,
  analyze,
  chordFromData,
  chordModulus,
  concreteEc,
  concreteEnd,
  eFracture,
  elongation,
  envelope,
  eUpper,
  hasNeck,
  neck,
  noise,
  permanentSet,
  popovics,
  popovicsParams,
  presetById,
  resilience,
  respond,
  ruptureModulus,
  splitFromLoad,
  splitStrength,
  STEELS,
  theoryCurve,
  toughness,
  trueCurve,
  type Measured,
  type Point,
  type Steel,
} from './material'
import { clampParams, fromPreset, GAUGES, parseQuery, RANGES, SETUPS, steelOf, toQuery, type ConcMode, type Params, type Setup } from './model'
import { drawCompareStage, drawConcreteStage, drawSteelStage, steelLayout, type Broken } from './stage'

type XY = [number, number]
const MAT_COL: Record<string, string> = {
  bj37: '#8a9a7a',
  bj41: '#566449',
  bj50: '#3d4833',
  bjts420: '#ed8d3b',
  hs: '#0d304b',
  al: '#5b8fb0',
  ci: '#b5452f',
}
const D_CYL = 150
const H_CYL = 300

interface Cycle {
  emax: number
  smax: number
  ep: number
}

/** Keadaan uji baja yang berubah tiap frame (di luar React). */
interface SteelRun {
  e: number
  emax: number
  dir: number // 1 tarik, −1 bongkar, 0 diam
  broken: boolean
  pt: Point
  data: XY[]
  trueData: XY[]
  cycles: Cycle[]
  auto: number // indeks program siklus otomatis (−1 = manual)
  idx: number
}
interface ConcRun {
  e: number // tekan: regangan; belah: waktu (s)
  P: number // kN
  running: boolean
  broken: boolean
  data: XY[]
  idx: number
}

const newSteel = (): SteelRun => ({
  e: 0,
  emax: 0,
  dir: 0,
  broken: false,
  pt: { s: 0, eu: 0, t: null, luders: 0, broken: false },
  data: [[0, 0]],
  trueData: [[0, 0]],
  cycles: [],
  auto: -1,
  idx: 0,
})
const newConc = (): ConcRun => ({ e: 0, P: 0, running: false, broken: false, data: [[0, 0]], idx: 0 })

/** Rentang perbesaran: plateau sampai 1,5εsh, tanpa plateau 3× regangan Rp0,2. */
const zoomOf = (m: Steel, eF: number) => Math.min(eF, m.kind === 'plateau' ? Math.max(1.5 * m.esh, eUpper(m) * 4) : 3 * (m.fy / m.E + 0.002))

/** Target program siklus otomatis (regangan total). */
function program(m: Steel, eF: number) {
  if (m.kind === 'plateau') {
    const a = m.esh
    return [0.6 * a, a + 0.3 * (m.eu - a), a + 0.75 * (m.eu - a), m.eu + 0.45 * (eF - m.eu)].filter((x) => x < eF * 0.98)
  }
  return [0.3 * m.eu, 0.6 * m.eu, 0.9 * m.eu, m.eu + 0.45 * (eF - m.eu)].filter((x) => x < eF * 0.98 && x > m.fy / m.E)
}

export default function TensileRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [mat, setMat] = useState(init.mat)
  const [mode, setMode] = useState<ConcMode>(init.mode)
  const [p, setP] = useState<Params>(init.p)
  const [showTrue, setShowTrue] = useState(false)
  const [, setTick] = useState(0)
  const [grabbing, setGrabbing] = useState(false)

  useEffect(() => onQuery(toQuery({ setup, mat, mode, p })), [setup, mat, mode, p]) // eslint-disable-line react-hooks/exhaustive-deps

  const m = useMemo(() => steelOf(mat, p), [mat, p.E, p.fy, p.fu, p.eu, p.A, p.Z]) // eslint-disable-line react-hooks/exhaustive-deps
  const k = p.k
  const d0 = p.d
  const L0 = k * d0
  const A0 = (Math.PI * d0 * d0) / 4
  const eF = eFracture(m, k)
  const theory = useMemo(() => theoryCurve(m, k), [m, k])
  const trueTheory = useMemo(() => {
    const out: XY[] = []
    for (const [e] of theory) out.push(trueCurve(envelope(m, k, Math.min(e, eF - 1e-9)), e))
    return out
  }, [theory, m, k, eF])
  const nk = hasNeck(m) ? neck(m) : null
  const zoomE = zoomOf(m, eF)

  // beton
  const fc = p.fc
  const eEnd = concreteEnd(fc)
  const PmaxSplit = (splitStrength(fc) * Math.PI * H_CYL * D_CYL) / 2 / 1000

  const run = useRef<SteelRun>(newSteel())
  const crun = useRef<ConcRun>(newConc())
  const resetSteel = () => {
    run.current = newSteel()
    setTick((t) => t + 1)
  }
  const resetConc = () => {
    crun.current = newConc()
    setTick((t) => t + 1)
  }
  // benda uji baru bila material / ukuran berubah
  useEffect(resetSteel, [m, k, d0, setup])
  useEffect(resetConc, [fc, mode, setup])

  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const hits = useRef<[number, number][]>([])
  const live = useRef({ setup, m, k, d0, L0, A0, eF, theory, trueTheory, showTrue, zoomE, v: p.v, fc, eEnd, mode, PmaxSplit, mat })
  live.current = { setup, m, k, d0, L0, A0, eF, theory, trueTheory, showTrue, zoomE, v: p.v, fc, eEnd, mode, PmaxSplit, mat }

  // ---- langkah uji baja: maju ke regangan target dengan sub-langkah, merekam data seperti sel beban ----
  const stepSteel = (target: number) => {
    const L = live.current
    const R = run.current
    const m = L.m
    if (R.broken) return
    const floor = permanentSet(m, L.k, R.emax)
    target = Math.max(target, Math.min(R.e, floor))
    const h = Math.min(m.fy / m.E / 30, 0.0015)
    const n = Math.max(1, Math.ceil(Math.abs(target - R.e) / h))
    const e0 = R.e
    const amp = 0.0015 * m.fu
    let last = R.data[R.data.length - 1]
    for (let i = 1; i <= n; i++) {
      const e = e0 + ((target - e0) * i) / n
      const pt = respond(m, L.k, R.emax, e)
      if (e > R.emax) R.emax = e
      R.e = e
      R.pt = pt
      if (pt.broken) {
        R.broken = true
        R.dir = 0
        R.data.push([e, last[1]], [e, 0])
        R.trueData.push([R.trueData[R.trueData.length - 1][0], 0])
        break
      }
      if (pt.s <= 0 && e < R.emax) {
        // bongkar penuh: benda uji kendur
        if (R.dir < 0) {
          R.cycles.push({ emax: R.emax, smax: envelope(m, L.k, R.emax).s, ep: e })
          R.dir = R.auto >= 0 ? 1 : 0
        }
        R.data.push([e, 0])
        last = [e, 0]
        break
      }
      const dE = Math.abs(e - last[0]) / Math.max(1e-9, 0.004 * L.eF) + Math.abs(e - last[0]) / (0.012 * L.zoomE)
      const dS = Math.abs(pt.s - last[1]) / (0.004 * m.fu)
      if (dE + dS > 1 || i === n) {
        R.idx++
        const sm = pt.s + amp * noise(R.idx)
        last = [e, sm]
        R.data.push(last)
        const [et, stt] = trueCurve(pt, e)
        R.trueData.push([et, stt * (sm / Math.max(1e-9, pt.s))])
      }
    }
  }

  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    let lastUi = 0
    const frame = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - prev) / 1000))
      prev = now
      const L = live.current
      const steel = L.setup === 'tarik' || L.setup === 'siklus'
      if (steel) {
        const R = run.current
        const m = L.m
        if (!R.broken && R.dir !== 0) {
          const ey = m.fy / m.E
          let rate: number
          if (R.dir < 0) rate = -ey / 1.2
          else if (R.e < R.emax) rate = ey / 1.2
          else if (R.e < 1.1 * (m.kind === 'plateau' ? eUpper(m) : ey + 0.002)) rate = ey / 2.5
          else if (R.e < L.zoomE) rate = L.zoomE / 4
          else rate = Math.max(L.eF / 6, ey / 2.5)
          let target = R.e + rate * L.v * dt
          if (R.dir > 0 && R.auto >= 0) {
            const prog = program(m, L.eF)
            const goal = prog[R.auto]
            if (goal !== undefined && target >= goal && R.emax < goal + 1e-12) {
              target = goal
              stepSteel(target)
              R.dir = -1
              R.auto++
              target = R.e
            }
          }
          stepSteel(target)
        }
        if (now - lastUi > 90) {
          lastUi = now
          setTick((t) => t + 1)
        }
      } else if (L.setup === 'beton') {
        const R = crun.current
        if (R.running && !R.broken) {
          if (L.mode === 'tekan') {
            const e = Math.min(L.eEnd, R.e + (L.eEnd / 9) * L.v * dt)
            const steps = Math.max(1, Math.ceil((e - R.e) / (L.eEnd / 500)))
            const e0 = R.e
            for (let i = 1; i <= steps; i++) {
              const ee = e0 + ((e - e0) * i) / steps
              R.idx++
              const s = popovics(L.fc, ee) * (1 + 0.004 * noise(R.idx))
              R.data.push([ee, s])
            }
            R.e = e
            R.P = (R.data[R.data.length - 1][1] * Math.PI * D_CYL * D_CYL) / 4 / 1000
            if (e >= L.eEnd) {
              R.broken = true
              R.running = false
            }
          } else {
            const tEnd = 6
            R.e += dt * L.v
            R.P = (L.PmaxSplit * R.e) / tEnd
            if (R.P >= L.PmaxSplit) {
              R.data.push([R.e, L.PmaxSplit], [R.e, 0])
              R.P = 0
              R.broken = true
              R.running = false
            } else {
              R.idx++
              R.data.push([R.e, R.P * (1 + 0.003 * noise(R.idx))])
            }
          }
        }
        if (now - lastUi > 90) {
          lastUi = now
          setTick((t) => t + 1)
        }
      }
      draw()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- gambar ----
  const draw = () => {
    const L = live.current
    const c = stageRef.current
    const pc = plotRef.current
    if (!c || !pc) return
    const sg = fitCanvas(c)
    const pg = fitCanvas(pc)
    if (L.setup === 'tarik' || L.setup === 'siklus') {
      const R = run.current
      const m = L.m
      const brk = R.broken
      const nkk = hasNeck(m) ? neck(m) : null
      // setelah patah: pegas elastis kembali, panjang = perpanjangan plastis
      const ext = brk ? elongation(m, L.k) * L.L0 : R.e * L.L0
      const st = {
        spec: { d0: L.d0, L0: L.L0, ext, pt: R.pt, brittle: !nkk, lam: nkk?.lam ?? 0.5 },
        extMax: L.eF * L.L0,
        P: brk ? 0 : (R.pt.s * L.A0) / 1000,
        sigma: brk ? 0 : R.pt.s,
        e: brk ? elongation(m, L.k) : R.e,
        phase: phaseOf(m, R),
        dir: R.dir,
        A0: L.A0,
      }
      drawSteelStage(sg.ctx, sg.w, sg.h, st)
      const meas = analyze(R.data, R.broken)
      const ch: SteelChart = {
        m,
        theory: L.theory,
        data: R.data,
        trueData: R.trueData,
        trueTheory: L.trueTheory,
        showTrue: L.showTrue,
        cur: [R.e, brk ? 0 : R.pt.s],
        meas,
        eF: L.eF,
        zoomE: L.zoomE,
      }
      drawSteelChart(pg.ctx, pg.w, pg.h, ch)
    } else if (L.setup === 'banding') {
      const list: Broken[] = STEELS.map((ps) => {
        const mm = ps.m
        const nkk = hasNeck(mm) ? neck(mm) : null
        const A = elongation(mm, L.k)
        return {
          label: ps.short,
          A,
          Z: nkk ? mm.Z : 0,
          color: MAT_COL[ps.id],
          selected: ps.id === L.mat,
          spec: {
            d0: 10,
            L0: 10 * L.k,
            ext: A * 10 * L.k,
            pt: { s: 0, eu: mm.eu - mm.fu / mm.E, t: nkk ? nkk.etf : null, luders: 1, broken: true },
            brittle: !nkk,
            lam: nkk?.lam ?? 0.5,
          },
        }
      })
      hits.current = drawCompareStage(sg.ctx, sg.w, sg.h, list)
      const items: CompareItem[] = STEELS.map((ps) => ({
        label: ps.label,
        color: MAT_COL[ps.id],
        curve: theoryCurve(ps.m, L.k, 200),
        U: toughness(ps.m, L.k),
        A: elongation(ps.m, L.k),
        selected: ps.id === L.mat,
      }))
      drawCompareChart(pg.ctx, pg.w, pg.h, items)
    } else {
      const R = crun.current
      const pp = popovicsParams(L.fc)
      const sigma = L.mode === 'tekan' ? (R.data.length ? R.data[R.data.length - 1][1] : 0) : splitFromLoad(R.P * 1000, H_CYL, D_CYL)
      drawConcreteStage(sg.ctx, sg.w, sg.h, {
        mode: L.mode,
        D: D_CYL,
        H: H_CYL,
        e: L.mode === 'tekan' ? R.e : 0,
        e0: pp.e0,
        eEnd: L.eEnd,
        P: R.broken && L.mode === 'belah' ? 0 : R.P,
        sigma: R.broken && L.mode === 'belah' ? 0 : sigma,
        crack: L.mode === 'tekan' ? Math.max(0, Math.min(1, (R.e - 0.7 * pp.e0) / (L.eEnd - 0.7 * pp.e0))) : R.P / L.PmaxSplit,
        broken: R.broken,
        running: R.running,
      })
      drawConcreteChart(pg.ctx, pg.w, pg.h, {
        mode: L.mode,
        fc: L.fc,
        data: R.data,
        eEnd: L.eEnd,
        Pmax: L.PmaxSplit,
        tEnd: 6,
        chordData: L.mode === 'tekan' ? chordFromData(R.data, 0.4 * L.fc) : null,
      })
    }
  }

  // ---- aksi ----
  const set = (key: keyof Params) => (v: number) => setP((o) => clampParams({ ...o, [key]: v }))
  const choose = (id: string) => {
    setMat(id)
    setP((o) => clampParams({ ...o, ...fromPreset(id) }))
  }
  const R = run.current
  const CR = crun.current
  const start = () => {
    if (R.broken) run.current = newSteel()
    run.current.auto = -1
    run.current.dir = 1
    setTick((t) => t + 1)
  }
  const unload = () => {
    if (R.broken || R.pt.s <= 0) return
    R.auto = -1
    R.dir = -1
    setTick((t) => t + 1)
  }
  const pause = () => {
    R.dir = 0
    R.auto = -1
    setTick((t) => t + 1)
  }
  const autoCycle = () => {
    run.current = newSteel()
    run.current.auto = 0
    run.current.dir = 1
    setTick((t) => t + 1)
  }
  const startConc = () => {
    if (CR.broken) crun.current = newConc()
    crun.current.running = true
    setTick((t) => t + 1)
  }

  // drag crosshead: geser vertikal = ubah perpanjangan
  const drag = useRef<{ y: number; e: number } | null>(null)
  const steelSetup = setup === 'tarik' || setup === 'siklus'
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (setup === 'banding') {
      const r = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - r.left
      const i = hits.current.findIndex(([a, b]) => x >= a && x < b)
      if (i >= 0) choose(STEELS[i].id)
      return
    }
    if (!steelSetup || R.broken) return
    e.currentTarget.setPointerCapture(e.pointerId)
    R.dir = 0
    R.auto = -1
    drag.current = { y: e.clientY, e: R.e }
    setGrabbing(true)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    if (!drag.current) {
      c.style.cursor = setup === 'banding' ? 'pointer' : steelSetup && !R.broken ? 'ns-resize' : 'default'
      return
    }
    const lay = steelLayout(c.clientWidth, c.clientHeight, {
      spec: { d0, L0, ext: 0, pt: R.pt, brittle: false, lam: 0.5 },
      extMax: eF * L0,
      P: 0,
      sigma: 0,
      e: 0,
      phase: '',
      dir: 0,
      A0,
    })
    // 1 px ≈ ΔL nyata; di daerah elastis perpanjangan sangat kecil, jadi seret diperhalus 20×
    const dy = drag.current.y - e.clientY
    const fine = R.emax < zoomE ? 20 : 1
    stepSteel(Math.max(0, drag.current.e + dy / (lay.extPx * fine)))
  }
  const onUp = () => {
    drag.current = null
    setGrabbing(false)
  }

  const preset = presetById(mat)
  const meas = steelSetup ? analyze(R.data, R.broken) : null
  const tip =
    setup === 'banding'
      ? 'Klik benda uji untuk memilih material. Semua digambar setelah patah pada panjang ukur yang sama.'
      : setup === 'beton'
        ? mode === 'tekan'
          ? 'Silinder 150 × 300 mm ditekan dengan laju regangan tetap sampai hancur.'
          : 'Silinder dibaringkan dan dibebani garis: tarik merata memecah silinder di bidang vertikal.'
        : 'Seret ke atas/bawah untuk menarik/membongkar (perlahan di daerah elastis), atau pakai tombol.'

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Material &amp; Elemen › <b>Room Tensile Test</b>
        </span>
        <Segmented value={setup} options={SETUPS.map((x) => ({ id: x.id, label: x.label, title: x.hint }))} onChange={setSetup} />
        <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(location.href)} title="Salin tautan eksperimen ini (parameter tersimpan di URL)">
          Salin tautan
        </button>
      </div>

      <div className="room-grid">
        <section className="stage-col">
          <div className="card stage-card">
            <canvas
              ref={stageRef}
              className={`stage ${grabbing ? 'grabbing' : ''}`}
              style={{ height: 500 }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            <div className="stage-tip wide-only">{tip}</div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>
                {setup === 'banding'
                  ? 'Kurva tegangan–regangan teknik tujuh material'
                  : setup === 'beton'
                    ? mode === 'tekan'
                      ? 'Kurva tegangan–regangan tekan beton'
                      : 'Gaya terhadap waktu dan tegangan di bidang belah'
                    : setup === 'siklus'
                      ? 'Bongkar–muat: garis bongkar sejajar kemiringan elastis'
                      : 'Kurva tegangan–regangan (σ = P/A0, ε = ΔL/L0)'}
              </b>
              <span style={{ color: 'var(--mute)', fontSize: 13 }}>
                {setup === 'beton'
                  ? mode === 'tekan'
                    ? 'σ = fc′·n(ε/ε0)/(n − 1 + (ε/ε0)^(nk))'
                    : 'fct = 2P/(πLD)'
                  : setup === 'banding'
                    ? 'U = ∫σ dε'
                    : showTrue
                      ? 'σt = σ(1+ε), εt = ln(1+ε) · leher: σt = P/A'
                      : 'kanan: perbesaran daerah elastis & leleh'}
              </span>
            </div>
            <canvas ref={plotRef} className="plot" style={{ height: 290 }} />
          </div>
        </section>

        <aside className="side-col">
          {steelSetup && (
            <div className="card">
              <h3>Uji</h3>
              <div className="btn-row" style={{ marginTop: 0 }}>
                {R.dir > 0 && !R.broken ? (
                  <button className="btn primary sm" onClick={pause}>
                    Jeda
                  </button>
                ) : (
                  <button className="btn primary sm" onClick={start}>
                    {R.broken ? 'Benda uji baru & tarik' : R.e > 0 ? 'Lanjut tarik' : 'Mulai tarik'}
                  </button>
                )}
                <button className="btn ghost sm" onClick={unload} disabled={R.broken || R.pt.s <= 0 || R.dir < 0}>
                  Bongkar
                </button>
                {setup === 'siklus' && (
                  <button className="btn ghost sm" onClick={autoCycle} title="tarik–bongkar otomatis di beberapa regangan lalu tarik sampai putus">
                    Siklus otomatis
                  </button>
                )}
                <button className="btn ghost sm" onClick={resetSteel}>
                  Reset
                </button>
              </div>
              <Slider label="Laju uji" symbol="×" unit="" value={p.v} {...RANGES.v} onChange={set('v')} />
              {setup === 'tarik' && <Check label="Tampilkan kurva sebenarnya (true stress–strain)" checked={showTrue} onChange={setShowTrue} />}
            </div>
          )}

          {setup === 'beton' && (
            <div className="card">
              <h3>Uji beton</h3>
              <div style={{ marginBottom: 12 }}>
                <Segmented
                  value={mode}
                  options={[
                    { id: 'tekan', label: 'Tekan silinder', title: 'SNI 1974 / ASTM C39' },
                    { id: 'belah', label: 'Tarik belah', title: 'SNI 2491 / ASTM C496' },
                  ]}
                  onChange={setMode}
                />
              </div>
              <Slider label="Kuat tekan rencana" symbol="fc′" unit="MPa" value={p.fc} {...RANGES.fc} onChange={set('fc')} hint="K-250 ≈ 21 MPa · K-300 ≈ 25 MPa · beton prategang 40–50 MPa" />
              <Slider label="Laju uji" symbol="×" unit="" value={p.v} {...RANGES.v} onChange={set('v')} />
              <div className="btn-row" style={{ marginTop: 0 }}>
                {CR.running ? (
                  <button className="btn primary sm" onClick={() => ((CR.running = false), setTick((t) => t + 1))}>
                    Jeda
                  </button>
                ) : (
                  <button className="btn primary sm" onClick={startConc}>
                    {CR.broken ? 'Benda uji baru' : CR.e > 0 ? 'Lanjut' : 'Mulai uji'}
                  </button>
                )}
                <button className="btn ghost sm" onClick={resetConc}>
                  Reset
                </button>
              </div>
            </div>
          )}

          {setup !== 'beton' && (
            <div className="card">
              <h3>Material</h3>
              <div className="btn-row" style={{ marginTop: 0, marginBottom: 8, flexWrap: 'wrap' }}>
                {STEELS.map((s) => (
                  <button key={s.id} className={`btn sm ${s.id === mat ? 'primary' : 'ghost'}`} onClick={() => choose(s.id)} title={s.note}>
                    {s.label}
                  </button>
                ))}
              </div>
              <small className="slider-hint" style={{ marginTop: 0, marginBottom: 10 }}>
                {preset.note}. {m.kind === 'plateau' ? 'Titik leleh jelas (plateau).' : 'Tanpa plateau: kekuatan leleh pakai offset 0,2%.'}
              </small>
              {steelSetup && (
                <>
                  <Slider label="Modulus elastisitas" symbol="E" unit="GPa" value={p.E} {...RANGES.E} onChange={set('E')} />
                  <Slider label={m.kind === 'plateau' ? 'Tegangan leleh bawah' : 'Tegangan leleh (offset 0,2%)'} symbol={m.kind === 'plateau' ? 'ReL' : 'Rp0,2'} unit="MPa" value={p.fy} {...RANGES.fy} onChange={set('fy')} />
                  <Slider label="Kuat tarik" symbol="Rm" unit="MPa" value={p.fu} {...RANGES.fu} onChange={set('fu')} />
                  <Slider label="Regangan saat Rm (seragam)" symbol="εu" unit="%" value={p.eu} {...RANGES.eu} onChange={set('eu')} />
                  <Slider label="Perpanjangan putus pada L0 = 5d0" symbol="A5" unit="%" value={p.A} {...RANGES.A} onChange={set('A')} />
                  <Slider label="Reduksi luas penampang" symbol="Z" unit="%" value={p.Z} {...RANGES.Z} onChange={set('Z')} />
                </>
              )}
            </div>
          )}

          {setup !== 'beton' && (
            <div className="card">
              <h3>Benda uji</h3>
              {steelSetup && <Slider label="Diameter" symbol="d0" unit="mm" value={p.d} {...RANGES.d} onChange={set('d')} />}
              <Slider label="Panjang ukur relatif" symbol="L0/d0" unit="" value={p.k} {...RANGES.k} onChange={set('k')} hint={steelSetup ? `L0 = ${fmt(L0, 1)} mm · A0 = ${fmt(A0, 1)} mm²` : undefined} />
              <div className="btn-row" style={{ marginTop: 0 }}>
                {GAUGES(d0).map((g) => (
                  <button key={g.label} className="btn ghost sm" title={g.title} onClick={() => set('k')(Math.round(g.k * 10) / 10)}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h3>{setup === 'banding' ? 'Perbandingan' : setup === 'siklus' ? 'Siklus bongkar–muat' : setup === 'beton' ? 'Teori vs terukur' : 'Teori vs terukur'}</h3>
            {setup === 'tarik' && meas && <TensileTable m={m} k={k} meas={meas} broken={R.broken} A0={A0} d0={d0} mat={mat} nk={nk} />}
            {setup === 'siklus' && meas && <CycleTable m={m} cycles={R.cycles} meas={meas} />}
            {setup === 'banding' && <CompareTable k={k} mat={mat} />}
            {setup === 'beton' && <ConcreteTable mode={mode} fc={fc} run={CR} eEnd={eEnd} />}
          </div>
        </aside>
      </div>

      <Notes setup={setup} mode={mode} />
    </div>
  )
}

function phaseOf(m: Steel, R: SteelRun) {
  if (R.broken) return 'Putus'
  if (R.e <= 0) return 'Siap — benda uji terpasang'
  if (R.e < R.emax - 1e-9) return R.pt.s <= 0 ? 'Bongkar penuh — kendur' : 'Bongkar / muat ulang elastis'
  const pt = R.pt
  if (pt.t !== null) return 'Necking — leher mengecil, gaya turun'
  if (m.kind === 'plateau') {
    if (R.e < eUpper(m)) return 'Elastis (hukum Hooke)'
    if (pt.luders < 1) return 'Leleh — pita Lüders menjalar'
    return 'Pengerasan regangan'
  }
  if (R.e < m.fy / m.E) return 'Elastis (hukum Hooke)'
  return 'Plastis — pengerasan regangan'
}

// ---------- tabel ----------

type Row = [string, number | null, number | null, string, number?]

function Readout({ rows, first, second }: { rows: Row[]; first: string; second: string }) {
  return (
    <table className="readout">
      <thead>
        <tr>
          <th />
          <th>{first}</th>
          <th>{second}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([lab, a, b, u, d = 1], i) => (
          <tr key={i}>
            <th>{lab}</th>
            <td>
              {a === null ? '—' : fmt(a, d)} <small>{u}</small>
            </td>
            <td>{b === null ? '—' : fmt(b, d)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TensileTable(o: { m: Steel; k: number; meas: Measured; broken: boolean; A0: number; d0: number; mat: string; nk: ReturnType<typeof neck> | null }) {
  const { m, meas } = o
  const plate = m.kind === 'plateau'
  const A = elongation(m, o.k)
  // diameter patahan diukur jangka sorong (resolusi 0,05 mm)
  const df = o.d0 * Math.sqrt(1 - (o.nk ? m.Z : 0))
  const dfMeas = Math.round(df / 0.05) * 0.05
  const Zmeas = 1 - (dfMeas / o.d0) ** 2
  const rows: Row[] = [
    ['E', m.E / 1000, meas.E ? meas.E / 1000 : null, 'GPa'],
    ...(plate && m.up > 1 ? ([['ReH (leleh atas)', m.up * m.fy, meas.ReH, 'MPa', 0]] as Row[]) : []),
    plate ? ['ReL (leleh bawah)', m.fy, meas.ReL ?? meas.Rp02, 'MPa', 0] : ['Rp0,2 (offset)', m.fy, meas.Rp02, 'MPa', 0],
    ['Rm (kuat tarik)', m.fu, meas.Rm, 'MPa', 0],
    ['Rm/Re', m.fu / m.fy, meas.Rm && (meas.ReL ?? meas.Rp02) ? meas.Rm / (meas.ReL ?? meas.Rp02)! : null, '', 3],
    ['Ag (seragam, plastis)', Ag(m) * 100, meas.Ag !== null ? meas.Ag * 100 : null, '%'],
    [`A (putus, L0 = ${fmt(o.k, 1)}d0)`, A * 100, o.broken && meas.A !== null ? meas.A * 100 : null, '%'],
    ['Z (reduksi luas)', (o.nk ? m.Z : 0) * 100, o.broken ? Zmeas * 100 : null, '%'],
    ['Pmax = Rm·A0', (m.fu * o.A0) / 1000, meas.Rm ? (meas.Rm * o.A0) / 1000 : null, 'kN', 2],
    ['Ketangguhan U = ∫σdε', toughness(m, o.k), o.broken ? meas.U : null, 'MJ/m³'],
    ['Resiliensi fy²/2E', resilience(m), null, 'MJ/m³', 3],
  ]
  const ratio = meas.Rm && (meas.ReL ?? meas.Rp02) ? meas.Rm / (meas.ReL ?? meas.Rp02)! : null
  return (
    <>
      <Readout rows={rows} first="Model" second="Terukur" />
      {o.nk && (
        <small className="slider-hint" style={{ marginTop: 6 }}>
          Considère: necking mulai saat dσt/dεt = σt, yaitu εt = n = ln(1 + εu) = {fmt(o.nk.n, 3)} (Hollomon σt = {fmt(o.nk.K, 0)}·εt^{fmt(o.nk.n, 3)} MPa).
          Diameter patahan diukur jangka sorong: {o.broken ? `${fmt(dfMeas, 2)} mm` : '—'}.
        </small>
      )}
      {o.mat === 'bjts420' && ratio !== null && (
        <p style={{ fontSize: 13, margin: '8px 0 0' }}>
          Syarat tulangan gempa (SNI 2052 BjTS 420B): Rm/Re ≥ 1,25 → <b style={{ color: ratio >= 1.25 ? 'var(--green, #566449)' : '#b5452f' }}>{ratio >= 1.25 ? 'memenuhi' : 'tidak memenuhi'}</b>
          {meas.ReL ? `, Re ≤ 1,3·420 = 546 MPa → ${meas.ReL <= 546 ? 'memenuhi' : 'tidak memenuhi'}` : ''}.
        </p>
      )}
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Kolom terukur diolah dari data sel beban (dengan derau) seperti perangkat lunak mesin uji: E dari regresi 10–45% Rm, Rp0,2 dari garis offset, A dari
        regangan saat putus dikurangi pemulihan elastis.
      </small>
    </>
  )
}

function CycleTable({ m, cycles, meas }: { m: Steel; cycles: Cycle[]; meas: Measured }) {
  return (
    <>
      {cycles.length === 0 ? (
        <p style={{ fontSize: 13, margin: 0 }}>Tekan "Siklus otomatis", atau tarik lalu "Bongkar" di tengah uji. Tiap bongkar penuh dicatat di sini.</p>
      ) : (
        <table className="readout">
          <thead>
            <tr>
              <th>#</th>
              <th>εmaks</th>
              <th>σmaks</th>
              <th>εelastis</th>
              <th>εpermanen</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c, i) => (
              <tr key={i}>
                <th>{i + 1}</th>
                <td>
                  {fmt(c.emax * 100, 2)} <small>%</small>
                </td>
                <td>
                  {fmt(c.smax, 0)} <small>MPa</small>
                </td>
                <td>
                  {fmt((c.smax / m.E) * 100, 3)} <small>%</small>
                </td>
                <td>
                  {fmt(c.ep * 100, 2)} <small>%</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="readout" style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <th>E dari data</th>
            <td>
              {meas.E ? fmt(meas.E / 1000, 1) : '—'} <small>GPa</small>
            </td>
          </tr>
          <tr>
            <th>Leleh awal (Re / Rp0,2)</th>
            <td>
              {meas.ReL ?? meas.Rp02 ? fmt((meas.ReL ?? meas.Rp02)!, 0) : '—'} <small>MPa</small>
            </td>
          </tr>
          {cycles.length > 0 && (
            <tr>
              <th>Leleh saat muat ulang terakhir</th>
              <td>
                {fmt(cycles[cycles.length - 1].smax, 0)} <small>MPa</small>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <small className="slider-hint" style={{ marginTop: 6 }}>
        εpermanen = εmaks − σmaks/E: regangan elastis pulih penuh, plastis tetap. Saat dimuat ulang, benda uji elastis sampai σmaks — batas leleh naik
        (pengerasan dingin), tetapi sisa keuletan berkurang.
      </small>
    </>
  )
}

function CompareTable({ k, mat }: { k: number; mat: string }) {
  return (
    <>
      <table className="readout">
        <thead>
          <tr>
            <th />
            <th>Re</th>
            <th>Rm</th>
            <th>Rm/Re</th>
            <th>A</th>
            <th>U</th>
          </tr>
        </thead>
        <tbody>
          {STEELS.map((s) => {
            const A = elongation(s.m, k)
            return (
              <tr key={s.id} style={s.id === mat ? { background: '#f4f3ee' } : undefined}>
                <th style={{ color: MAT_COL[s.id], fontWeight: 600 }}>{s.label}</th>
                <td>{fmt(s.m.fy, 0)}</td>
                <td>{fmt(s.m.fu, 0)}</td>
                <td>{fmt(s.m.fu / s.m.fy, 2)}</td>
                <td>
                  {fmt(A * 100, 1)}
                  <small>%</small>
                </td>
                <td>{fmt(toughness(s.m, k), 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Re dan Rm dalam MPa, U dalam MJ/m³. A berubah dengan panjang ukur: makin panjang L0, makin kecil persentase (leher hanya sepotong pendek) —
        karena itu standar menetapkan L0 = 5,65√S0.
      </small>
    </>
  )
}

function ConcreteTable({ mode, fc, run, eEnd }: { mode: ConcMode; fc: number; run: ConcRun; eEnd: number }) {
  const pp = popovicsParams(fc)
  const Acyl = (Math.PI * D_CYL * D_CYL) / 4
  if (mode === 'tekan') {
    let smax = 0
    let eAt = 0
    for (const [e, s] of run.data)
      if (s > smax) {
        smax = s
        eAt = e
      }
    const th = chordModulus((e) => popovics(fc, e), 0.4 * fc)
    const meas = chordFromData(run.data, 0.4 * fc)
    const rows: Row[] = [
      ['fc′ = Pmax/A', fc, run.broken ? smax : null, 'MPa'],
      ['Pmax', (fc * Acyl) / 1000, run.broken ? (smax * Acyl) / 1000 : null, 'kN', 0],
      ['Ec = 4700√fc′', concreteEc(fc) / 1000, null, 'GPa'],
      ['E chord (ASTM C469)', th.E / 1000, meas ? meas.E / 1000 : null, 'GPa'],
      ['ε0 di puncak', pp.e0 * 1000, run.broken ? eAt * 1000 : null, '‰', 3],
      ['ε akhir uji', eEnd * 1000, null, '‰', 3],
      ['n Popovics = 0,8 + fc′/17', pp.n, null, '', 3],
    ]
    return (
      <>
        <Readout rows={rows} first="Teori" second="Terukur" />
        <small className="slider-hint" style={{ marginTop: 6 }}>
          SNI 2847 memakai εcu = 0,003 untuk desain lentur; kurva uji nyata turun setelah puncak di ε0 ≈ 0,002. Beton mutu tinggi lebih getas: cabang turun
          lebih curam.
        </small>
      </>
    )
  }
  let Pmax = 0
  for (const [, P] of run.data) Pmax = Math.max(Pmax, P)
  const fct = splitStrength(fc)
  const rows: Row[] = [
    ['Pmax', (fct * Math.PI * H_CYL * D_CYL) / 2 / 1000, run.broken ? Pmax : null, 'kN', 0],
    ['fct = 2P/(πLD)', fct, run.broken ? splitFromLoad(Pmax * 1000, H_CYL, D_CYL) : null, 'MPa', 2],
    ['fct/fc′', fct / fc, run.broken ? splitFromLoad(Pmax * 1000, H_CYL, D_CYL) / fc : null, '', 3],
    ['fr = 0,62√fc′ (lentur)', ruptureModulus(fc), null, 'MPa', 2],
  ]
  return (
    <>
      <Readout rows={rows} first="Teori" second="Terukur" />
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Teori fct ≈ 0,56√fc′ (penjelasan SNI 2847 / ACI 318). Kuat tarik beton hanya ±10% kuat tekan — karena itu beton diberi tulangan baja di daerah tarik.
      </small>
    </>
  )
}

// ---------- catatan ----------

function Notes({ setup, mode }: { setup: Setup; mode: ConcMode }) {
  const concept: React.ReactNode[] = []
  const tryThis: React.ReactNode[] = []
  if (setup === 'tarik') {
    concept.push(
      <>
        <b>Tegangan & regangan teknik</b> σ = P/A0 dan ε = ΔL/L0 memakai ukuran semula. Kemiringan awal adalah modulus elastisitas E (hukum Hooke); di
        sini regangan pulih penuh bila beban dilepas.
      </>,
      <>
        <b>Leleh:</b> baja karbon lunak punya leleh atas ReH lalu turun ke leleh bawah ReL, dan meregang di tegangan tetap (plateau) sementara pita Lüders
        menjalar di sepanjang batang. Baja mutu tinggi dan aluminium tidak punya plateau — kekuatan leleh ditentukan dengan offset 0,2%.
      </>,
      <>
        <b>Pengerasan regangan</b> menaikkan tegangan sampai kuat tarik Rm. Setelah itu deformasi terpusat di satu tempat (<b>necking</b>): luas leher
        mengecil lebih cepat daripada material mengeras, sehingga gaya turun walau tegangan sebenarnya di leher terus naik (kriteria Considère).
      </>,
      <>
        <b>Keuletan</b> dinyatakan dengan perpanjangan putus A dan reduksi luas Z. Patahan ulet berbentuk mangkuk–kerucut; patahan getas datar tanpa leher.
      </>,
    )
    tryThis.push('Tekan "Mulai tarik" pada BJ 41 dan lihat grafik perbesaran: puncak ReH, jatuh ke ReL, lalu plateau sementara pita Lüders menjalar.')
    tryThis.push('Centang "kurva sebenarnya": setelah necking kurva teknik turun, tetapi tegangan sebenarnya di leher terus naik sampai putus.')
    tryThis.push('Ganti panjang ukur dari 5d0 ke 10d0: Rm dan Ag tetap, tetapi perpanjangan putus A mengecil — pembanding A harus pada L0 yang sama.')
    tryThis.push('Pilih Besi cor: putus tanpa leher dan tanpa leleh jelas, luas di bawah kurva (ketangguhan) sangat kecil.')
    tryThis.push('Turunkan E ke 70 GPa (aluminium): garis elastis jauh lebih landai, regangan leleh tiga kali baja.')
  } else if (setup === 'siklus') {
    concept.push(
      <>
        <b>Bongkar elastis:</b> dari titik mana pun di daerah plastis, beban dilepas mengikuti garis lurus berkemiringan E. Regangan elastis σ/E pulih,
        regangan plastis tetap sebagai <b>regangan permanen</b>.
      </>,
      <>
        <b>Muat ulang</b> mengikuti garis yang sama sampai tegangan sebelumnya, lalu melanjutkan kurva semula. Batas leleh efektif naik — prinsip{' '}
        <b>pengerasan dingin</b> (cold work) pada baja tarik dingin dan kawat prategang — tetapi sisa perpanjangan sampai putus berkurang.
      </>,
      <>
        Model ini memakai pengerasan isotropik sederhana: tidak ada efek Bauschinger (leleh tekan lebih rendah setelah tarik) dan tidak ada penuaan regangan
        (strain ageing) yang memunculkan leleh atas lagi.
      </>,
    )
    tryThis.push('Tekan "Siklus otomatis" dan perhatikan semua garis bongkar sejajar — kemiringan E tidak berubah oleh deformasi plastis.')
    tryThis.push('Bongkar di tengah plateau: regangan permanen sudah ada walau tegangan belum naik di atas ReL.')
    tryThis.push('Bongkar setelah necking: garis bongkar tetap sejajar E, tetapi gaya yang dipulihkan makin kecil.')
  } else if (setup === 'banding') {
    concept.push(
      <>
        <b>Kekuatan vs keuletan:</b> baja mutu tinggi punya Rm terbesar tetapi perpanjangan lebih kecil; baja lunak lemah tetapi sangat ulet. Ketangguhan
        U = luas di bawah kurva = energi per volume yang diserap sampai putus.
      </>,
      <>
        <b>Rm/Re</b> (rasio kuat tarik terhadap leleh) penting untuk desain gempa: rasio besar berarti sendi plastis dapat menyebar sebelum putus. SNI 2052
        mensyaratkan ≥ 1,25 untuk tulangan BjTS 420B.
      </>,
      <>
        <b>Bahan getas</b> (besi cor, beton tarik) putus hampir tanpa regangan plastis: tidak ada peringatan sebelum runtuh, sehingga dirancang dengan
        faktor keamanan lebih besar.
      </>,
    )
    tryThis.push('Bandingkan BJ 37 dan Mutu tinggi: Rm berlipat dua tetapi batang di panggung jauh lebih pendek setelah putus.')
    tryThis.push('Perbesar L0/d0 ke 20: semua perpanjangan putus turun — kecuali besi cor, yang tidak punya leher.')
    tryThis.push('Klik BjTS 420B lalu buka tab Uji Tarik: periksa syarat Rm/Re ≥ 1,25 dari data uji.')
  } else {
    concept.push(
      <>
        <b>Beton kuat tekan, lemah tarik.</b> Kuat tekan fc′ diuji dengan silinder 150 × 300 mm umur 28 hari. Kurva naik tak linear (retak mikro antara pasta
        dan agregat) sampai puncak di ε ≈ 0,002, lalu turun.
      </>,
      <>
        <b>Modulus elastisitas</b> SNI 2847: Ec = 4700√fc′. Di laboratorium diukur sebagai modulus chord (ASTM C469) antara ε = 50·10⁻⁶ dan 0,4fc′ —
        sedikit lebih kecil dari kemiringan awal.
      </>,
      <>
        <b>Uji tarik belah</b> (Brazil): silinder dibaringkan dan dibebani garis. Teori elastis memberi tarik merata σx = 2P/(πLD) di bidang vertikal,
        sehingga silinder terbelah dua. Tarik langsung sulit diuji karena jepitan merusak beton.
      </>,
    )
    if (mode === 'tekan') {
      tryThis.push('Jalankan uji tekan: titik merah di grafik kanan adalah modulus chord; bandingkan dengan garis Ec = 4700√fc′.')
      tryThis.push('Naikkan fc′ ke 70 MPa: puncak lebih runcing dan cabang turun lebih curam — beton mutu tinggi lebih getas.')
      tryThis.push('Bandingkan kurva Popovics (data) dengan parabola Hognestad yang sering dipakai di buku beton bertulang.')
    } else {
      tryThis.push('Jalankan uji belah: fct terukur ≈ 0,56√fc′, hanya sekitar sepersepuluh fc′.')
      tryThis.push('Lihat grafik kanan: σx konstan di sepanjang diameter, sedangkan σy tekan sangat besar di dekat bilah beban.')
      tryThis.push('Naikkan fc′ empat kali: kuat tarik hanya naik dua kali (sebanding √fc′).')
    }
  }
  return (
    <div className="notes">
      <div className="card">
        <h3>Catatan konsep</h3>
        <ul>
          {concept.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3>Coba ini</h3>
        <ol>
          {tryThis.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}
