import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import type { FState } from '../../lab/forced'
import { fromModal, measureRoof, pushShape, shapeRoof, steadyModal, steadyRel, stepModal, toModal, type Modes } from '../../lab/mdof'
import { drawPlot, PlotScale, type Sample } from '../../lab/plot'
import { C } from '../../lab/theme'
import { Check, Segmented, Slider } from '../../ui/controls'
import { drawFreq, rAt, type FreqLayout, type Point } from './freq'
import { defaults, masses, modesOf, parseQuery, RANGES, SETUPS, stiffnesses, STORY_H, toQuery, type Params, type Setup } from './model'
import { drawModes, modeAt } from './modes'
import { drawStage, geometry, hitFloor, targetScale, type Layout } from './stage'

const WINDOW = 10
const H = 1 / 2000
const SAMPLE_DT = 1 / 120
const STEADY_TOL = 0.003
const FLOOR_COLORS = ['#c9c4b5', '#a9b49c', '#8a9a7a', '#6c7e5d']

interface Readout {
  t: number
  roof: number
  T: number | null
  A: number | null
  steady: boolean
  env: number[]
  drift: number[]
}

const EMPTY: Readout = { t: 0, roof: 0, T: null, A: null, steady: false, env: [], drift: [] }

const sysKey = (p: Params) => `${p.N}|${p.m}|${p.k}|${p.a1}|${p.mr}`

function sweepRatios(md: Modes, rMax: number) {
  const set = new Set<number>()
  for (let i = 1; i <= 40; i++) set.add(Number(((i / 40) * rMax).toFixed(3)))
  for (const wn of md.w) {
    const r = wn / md.w[0]
    for (const d of [-0.06, -0.03, -0.015, 0, 0.015, 0.03, 0.06]) set.add(Number((r * (1 + d)).toFixed(4)))
  }
  return [...set].filter((r) => r > 0.02 && r <= rMax).sort((a, b) => a - b)
}

export default function ShearBuildingRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [show, setShow] = useState({ floors: true, ground: true })
  const [read, setRead] = useState<Readout>(EMPTY)
  const [points, setPoints] = useState<Point[]>([])
  const [sweeping, setSweeping] = useState(false)
  const [activeMode, setActiveMode] = useState(-1)
  const [grabbing, setGrabbing] = useState(false)

  const md = useMemo(() => modesOf(p), [p.N, p.m, p.k, p.a1, p.mr]) // eslint-disable-line react-hooks/exhaustive-deps
  const ground = setup === 'tanah'
  const w = 2 * Math.PI * p.f
  const ug0 = ground ? p.ug : 0
  const r = w / md.w[0]
  const steadyAmp = useMemo(() => (ground ? steadyRel(md, p.z, w, p.ug) : null), [ground, md, p.z, w, p.ug])
  const key = sysKey(p)

  const live = useRef({ setup, p, md, running, speed, show, points, w: ground ? w : 0, ug0, steadyAmp, key, activeMode })
  live.current = { setup, p, md, running, speed, show, points, w: ground ? w : 0, ug0, steadyAmp, key, activeMode }

  const stageRef = useRef<HTMLCanvasElement>(null)
  const modesRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const freqRef = useRef<HTMLCanvasElement>(null)
  const initV = init.setup === 'tanah' ? -init.params.ug * 2 * Math.PI * init.params.f : 0
  // keadaan awal: diam mutlak (setup tanah: kecepatan relatif −ug0·ω di semua lantai)
  const sim = useRef({ q: toModal(md, new Array(md.n).fill(initV)).map((v): FState => ({ u: 0, v, psi: 0 })), t: 0 })
  const hist = useRef<Sample[][]>([])
  const histG = useRef<Sample[]>([])
  const det = useRef({ y0: 0, y1: 0, amps: [] as number[], times: [] as number[], recorded: '', env: [] as number[], drift: [] as number[] })
  const view = useRef(0)
  const plotScale = useRef(new PlotScale())
  const layout = useRef<Layout | null>(null)
  const freqLayout = useRef<FreqLayout | null>(null)
  const drag = useRef<{ j: number; off: number } | null>(null)
  const prev = useRef({ md, ug0, w: ground ? w : 0 })
  const sweepToken = useRef(0)
  const animT = useRef(0)

  // ---- aksi ----
  const clearDetector = () => {
    const d = det.current
    d.amps = []
    d.times = []
    d.recorded = ''
    d.env = []
    d.drift = []
  }

  /** Mengatur keadaan fisik (u, v relatif) lalu memproyeksikannya ke koordinat modal. */
  const setPhysical = (u: number[], v: number[], psi = sim.current.q[0]?.psi ?? 0) => {
    const m = live.current.md
    const qu = toModal(m, u)
    const qv = toModal(m, v)
    sim.current.q = qu.map((x, k) => ({ u: x, v: qv[k], psi }))
    clearDetector()
  }

  const restart = (steady: boolean) => {
    const L = live.current
    const n = L.md.n
    sim.current.t = 0
    if (steady && L.setup === 'tanah') {
      sim.current.q = steadyModal(L.md, L.p.z, L.w, L.ug0, 0)
      clearDetector()
    } else {
      // diam mutlak: kecepatan relatif = −u̇g(0) = −ug0·ω
      setPhysical(new Array(n).fill(0), new Array(n).fill(-L.ug0 * L.w), 0)
    }
    hist.current = []
    histG.current = []
    plotScale.current = new PlotScale()
    setRunning(true)
  }

  const exciteMode = (k: number) => {
    const L = live.current
    const amp = (L.md.n * STORY_H) / 300
    const shp = shapeRoof(L.md, k)
    setPhysical(
      shp.map((x) => x * amp),
      new Array(L.md.n).fill(-L.ug0 * L.w * Math.cos(sim.current.q[0]?.psi ?? 0)),
    )
    setActiveMode(k)
    setRunning(true)
  }

  const pushRoof = () => {
    const L = live.current
    const n = L.md.n
    setPhysical(pushShape(stiffnesses(L.p), n - 1, (n * STORY_H) / 300), new Array(n).fill(0))
    setActiveMode(-1)
    setRunning(true)
  }

  const kickGround = () => {
    const L = live.current
    const q = sim.current.q
    const u = fromModal(L.md, q.map((x) => x.u))
    const v = fromModal(L.md, q.map((x) => x.v)).map((x) => x - 0.15)
    setPhysical(u, v)
    setActiveMode(-1)
    setRunning(true)
  }

  // parameter berubah: keadaan fisik (mutlak) kontinu, diproyeksikan ke mode baru
  const first = useRef(true)
  useEffect(() => {
    onQuery(toQuery(setup, p))
    const old = prev.current
    const wNow = ground ? w : 0
    if (!first.current) {
      const q = sim.current.q
      const psi = q[0]?.psi ?? 0
      if (old.md.n !== md.n) {
        sim.current.q = toModal(md, new Array(md.n).fill(-ug0 * wNow)).map((v) => ({ u: 0, v, psi }))
        hist.current = []
      } else {
        let u = fromModal(old.md, q.map((x) => x.u))
        let v = fromModal(old.md, q.map((x) => x.v))
        u = u.map((x) => x + (old.ug0 - ug0) * Math.sin(psi))
        v = v.map((x) => x + (old.ug0 * old.w - ug0 * wNow) * Math.cos(psi))
        const qu = toModal(md, u)
        const qv = toModal(md, v)
        sim.current.q = qu.map((x, k) => ({ u: x, v: qv[k], psi }))
      }
      clearDetector()
    }
    first.current = false
    prev.current = { md, ug0, w: wNow }
  }, [setup, p]) // eslint-disable-line react-hooks/exhaustive-deps

  // setup berganti → mulai dari diam
  const firstSetup = useRef(true)
  useEffect(() => {
    if (firstSetup.current) {
      firstSetup.current = false
      return
    }
    restart(false)
    setPoints([])
    setActiveMode(-1)
    view.current = 0
  }, [setup]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sweepToken.current++
    setSweeping(false)
  }, [p.z, setup, key])

  const sweep = () => {
    const token = ++sweepToken.current
    const z = p.z
    const mdl = md
    const k = key
    const rMax = freqLayout.current?.rMax ?? 3
    const list = sweepRatios(mdl, rMax)
    setSweeping(true)
    let i = 0
    const next = () => {
      if (token !== sweepToken.current) return
      const t0 = performance.now()
      const batch: Point[] = []
      while (i < list.length && performance.now() - t0 < 25) {
        const a = measureRoof(mdl, z, list[i] * mdl.w[0], 1)
        if (a !== null) batch.push({ r: list[i], ratio: a, zeta: z, key: k })
        i++
      }
      if (batch.length) setPoints((old) => mergePoints(old, batch))
      if (i < list.length) setTimeout(next, 0)
      else setSweeping(false)
    }
    setTimeout(next, 0)
  }

  // ---- loop animasi ----
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastRead = 0
    let lastSample = -1
    const frame = (now: number) => {
      const L = live.current
      const dtReal = Math.min((now - last) / 1000, 0.05)
      last = now
      const s = sim.current
      const mdl = L.md
      const n = mdl.n
      const d = det.current
      const roofOf = (q: FState[]) => q.reduce((acc, x, k) => acc + mdl.phi[k][n - 1] * x.u, 0)
      if (L.running && !drag.current) {
        let rem = dtReal * L.speed
        animT.current += rem
        while (rem > 1e-12) {
          const h = Math.min(H, rem)
          const tPrev = s.t
          s.q = stepModal(mdl, L.p.z, s.q, L.w, L.ug0, h)
          s.t += h
          rem -= h
          const y2 = roofOf(s.q)
          if (d.y1 > d.y0 && d.y1 >= y2 && d.y1 > 1e-7) {
            d.amps.push(d.y1)
            d.times.push(tPrev)
            if (d.amps.length > 8) {
              d.amps.shift()
              d.times.shift()
            }
          }
          d.y0 = d.y1
          d.y1 = y2
          // selubung simpangan & drift
          const u = fromModal(mdl, s.q.map((x) => x.u))
          for (let j = 0; j < n; j++) {
            d.env[j] = Math.max(d.env[j] ?? 0, Math.abs(u[j]))
            d.drift[j] = Math.max(d.drift[j] ?? 0, Math.abs(u[j] - (j ? u[j - 1] : 0)))
          }
        }
        if (s.t - lastSample >= SAMPLE_DT || lastSample < 0 || s.t < lastSample) {
          const u = fromModal(mdl, s.q.map((x) => x.u))
          for (let j = 0; j < n; j++) {
            if (!hist.current[j]) hist.current[j] = []
            hist.current[j].push({ t: s.t, u: u[j] })
          }
          hist.current.length = n
          histG.current.push({ t: s.t, u: L.ug0 * Math.sin(s.q[0]?.psi ?? 0) })
          lastSample = s.t
          const cut = s.t - WINDOW - 1
          if (histG.current[0] && histG.current[0].t < cut) {
            hist.current = hist.current.map((a) => a.filter((x) => x.t >= cut))
            histG.current = histG.current.filter((x) => x.t >= cut)
          }
        }
      }

      // status tunak (setup tanah) + catat titik
      const a = d.amps
      const k = a.length
      const steady = k >= 4 && [a[k - 2], a[k - 3], a[k - 4]].every((b) => Math.abs(a[k - 1] - b) <= STEADY_TOL * a[k - 1])
      if (steady && L.setup === 'tanah' && L.ug0 > 0 && L.p.z > 0) {
        const rr = L.w / mdl.w[0]
        const kk = `${rr.toFixed(4)}|${L.p.z}|${L.key}`
        if (d.recorded !== kk) {
          d.recorded = kk
          setPoints((old) => mergePoints(old, [{ r: rr, ratio: a[k - 1] / L.ug0, zeta: L.p.z, key: L.key }]))
        }
      }

      const u = fromModal(mdl, s.q.map((x) => x.u))
      const ugNow = L.ug0 * Math.sin(s.q[0]?.psi ?? 0)
      // panggung
      const sc = stageRef.current
      if (sc) {
        const { w: cw, h: ch, ctx } = fitCanvas(sc)
        const g = geometry(cw, ch, n)
        if (!drag.current) {
          let amp = Math.max(...u.map(Math.abs), ...(d.env.length ? d.env : [0]), L.ug0, (n * STORY_H) / 2000)
          if (L.steadyAmp && L.p.z > 0) amp = Math.max(amp, ...L.steadyAmp.filter(Number.isFinite))
          const target = targetScale(g.bw, amp)
          view.current = view.current === 0 || target < view.current ? target : view.current + (target - view.current) * 0.02
        }
        layout.current = drawStage(ctx, cw, ch, {
          setup: L.setup,
          u,
          ug: ugNow,
          scale: view.current,
          env: u.map((_, j) => d.env[j] ?? 0),
          steady: L.steadyAmp && L.p.z > 0 ? L.steadyAmp : null,
          active: drag.current ? drag.current.j : -1,
        })
      }
      // panel mode
      const mc = modesRef.current
      if (mc) {
        const { w: cw, h: ch, ctx } = fitCanvas(mc)
        drawModes(ctx, cw, ch, mdl, animT.current, L.activeMode)
      }
      // grafik waktu
      const pc = plotRef.current
      if (pc && hist.current[n - 1]) {
        const { w: cw, h: ch, ctx } = fitCanvas(pc)
        const extra: { samples: Sample[]; color: string; dash?: number[]; label: string }[] = []
        if (L.show.floors)
          for (let j = n - 2; j >= 0; j--) extra.push({ samples: hist.current[j] ?? [], color: FLOOR_COLORS[j % 4], label: `lt ${j + 1}` })
        if (L.setup === 'tanah' && L.show.ground) extra.push({ samples: histG.current, color: C.orange, dash: [6, 4], label: 'ug' })
        drawPlot(
          ctx,
          cw,
          ch,
          hist.current[n - 1],
          {
            window: WINDOW,
            tNow: s.t,
            factor: 100,
            unit: 'cm',
            name: 'u',
            mainLabel: 'atap',
            peaks: [],
            showAmplitude: false,
            showPeriod: false,
            envelope: null,
            extra,
          },
          plotScale.current,
        )
      }
      // grafik respons frekuensi
      const fc = freqRef.current
      if (fc && L.setup === 'tanah') {
        const { w: cw, h: ch, ctx } = fitCanvas(fc)
        freqLayout.current = drawFreq(ctx, cw, ch, mdl, L.p.z, L.w / mdl.w[0], L.points, L.key)
      }

      if (now - lastRead > 120) {
        lastRead = now
        setRead({
          t: s.t,
          roof: u[n - 1],
          T: k >= 2 ? d.times[k - 1] - d.times[k - 2] : null,
          A: k ? a[k - 1] : null,
          steady,
          env: u.map((_, j) => d.env[j] ?? 0),
          drift: u.map((_, j) => d.drift[j] ?? 0),
        })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      sweepToken.current++
    }
  }, [])

  // ---- pointer: tarik lantai ----
  const local = (e: React.PointerEvent) => {
    const rc = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return [e.clientX - rc.left, e.clientY - rc.top] as const
  }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    const j = hitFloor(l, x, y)
    if (j < 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { j, off: x - l.floorX[j] }
    setGrabbing(true)
    setActiveMode(-1)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    const dr = drag.current
    if (!dr) {
      e.currentTarget.style.cursor = hitFloor(l, x, y) >= 0 ? 'grab' : 'default'
      return
    }
    const L = live.current
    const ugNow = L.ug0 * Math.sin(sim.current.q[0]?.psi ?? 0)
    const lim = (L.md.n * STORY_H) / 50
    const dj = Math.max(-lim, Math.min(lim, (x - dr.off - l.cx) / l.scale - ugNow))
    const u = pushShape(stiffnesses(L.p), dr.j, dj)
    setPhysical(u, new Array(L.md.n).fill(0))
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setGrabbing(false)
    clearDetector()
    setRunning(true)
  }

  const setFreqFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = freqLayout.current
    if (!l) return
    const rc = e.currentTarget.getBoundingClientRect()
    const rr = rAt(l, e.clientX - rc.left)
    const fHz = Math.min(RANGES.f.max, Math.max(RANGES.f.min, Math.round(((rr * md.w[0]) / (2 * Math.PI)) * 100) / 100))
    setP((old) => (old.f === fHz ? old : { ...old, f: fHz }))
  }
  const freqDrag = useRef(false)

  const set = (k: keyof Params) => (v: number) => setP((old) => ({ ...old, [k]: v }))
  const mTot = masses(p).reduce((s, x) => s + x, 0)
  const n = md.n
  const k1 = stiffnesses(p)[0]
  const fmtCm = (v: number) => `${(v * 100).toFixed(2)} cm`
  const maxDrift = read.drift.length ? Math.max(...read.drift) : 0
  const maxDriftJ = read.drift.indexOf(maxDrift)
  const setF = (fHz: number) => setP({ ...p, f: Math.min(RANGES.f.max, Math.max(RANGES.f.min, Math.round(fHz * 100) / 100)) })

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Getaran &amp; Dinamika › <b>Room Shear Building</b>
        </span>
        <Segmented value={setup} options={SETUPS.map((s) => ({ id: s.id, label: s.label, title: s.hint }))} onChange={setSetup} />
        <button
          className="btn ghost sm"
          onClick={() => navigator.clipboard?.writeText(location.href)}
          title="Salin tautan eksperimen ini (parameter tersimpan di URL)"
        >
          Salin tautan
        </button>
      </div>

      <div className="room-grid">
        <section className="stage-col">
          <div className="card stage-card">
            <canvas
              ref={stageRef}
              className={`stage ${grabbing ? 'grabbing' : ''}`}
              style={{ height: 440 }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            <div className="stage-tip wide-only">Tarik pelat lantai ke samping lalu lepaskan.</div>
            <div className="stage-live">
              <span>t = {read.t.toFixed(2)} s</span>
              <span>u atap = {fmtCm(read.roof)}</span>
              {ground && <span style={{ color: read.steady ? 'var(--green)' : 'var(--orange)' }}>{read.steady ? 'tunak ✓' : 'transien…'}</span>}
            </div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Mode getar — klik untuk menggetarkan satu mode</b>
              <small style={{ color: 'var(--mute)' }}>animasi diperlambat, rasio frekuensi dipertahankan</small>
            </div>
            <canvas
              ref={modesRef}
              className="plot"
              style={{ height: 190, cursor: 'pointer' }}
              onClick={(e) => {
                const rc = e.currentTarget.getBoundingClientRect()
                exciteMode(modeAt(rc.width, n, e.clientX - rc.left))
              }}
            />
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Simpangan relatif terhadap waktu</b>
              <div className="plot-opts">
                <Check label="Lantai bawah" checked={show.floors} onChange={(v) => setShow({ ...show, floors: v })} />
                {ground && <Check label="Gerak tanah" checked={show.ground} onChange={(v) => setShow({ ...show, ground: v })} />}
              </div>
            </div>
            <canvas ref={plotRef} className="plot" />
          </div>
          {ground && (
            <div className="card plot-card">
              <div className="plot-head">
                <b>Respons frekuensi — amplitudo tunak u₀/ug₀ tiap lantai</b>
                <small style={{ color: 'var(--mute)' }}>geser untuk memilih ω</small>
              </div>
              <canvas
                ref={freqRef}
                className="plot"
                style={{ height: 300, cursor: 'ew-resize', touchAction: 'none' }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  freqDrag.current = true
                  setFreqFromPointer(e)
                }}
                onPointerMove={(e) => freqDrag.current && setFreqFromPointer(e)}
                onPointerUp={() => (freqDrag.current = false)}
                onPointerCancel={() => (freqDrag.current = false)}
              />
            </div>
          )}
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Gedung</h3>
            <Slider label="Jumlah lantai" symbol="N" unit="" value={p.N} {...RANGES.N} onChange={set('N')} />
            <Slider label="Massa per lantai" symbol="m" unit="ton" value={p.m} {...RANGES.m} onChange={set('m')} />
            <Slider label="Kekakuan tingkat" symbol="k" unit="kN/m" value={p.k} {...RANGES.k} onChange={set('k')} hint="k = Σ 12EI/h³ kolom satu tingkat" />
            <Slider
              label="Kekakuan tingkat dasar"
              symbol="k₁/k"
              unit=""
              value={p.a1}
              {...RANGES.a1}
              onChange={set('a1')}
              hint={p.a1 < 0.7 ? 'lantai lunak (soft story)!' : undefined}
            />
            <Slider label="Massa atap" symbol="m_atap/m" unit="" value={p.mr} {...RANGES.mr} onChange={set('mr')} />
            <Slider label="Rasio redaman" symbol="ζ" unit="" value={p.z} {...RANGES.z} onChange={set('z')} hint="sama untuk semua mode (redaman klasik)" />
            <div className="btn-row">
              <button className="btn ghost sm" onClick={() => setP({ ...p, a1: 0.3 })}>
                Lantai lunak
              </button>
              <button className="btn ghost sm" onClick={() => setP({ ...defaults(), f: p.f, ug: p.ug })}>
                Bawaan
              </button>
            </div>
          </div>

          {ground ? (
            <div className="card">
              <h3>Gerak tanah</h3>
              <Slider label="Frekuensi" symbol="f" unit="Hz" value={p.f} {...RANGES.f} onChange={set('f')} hint={`ω/ω₁ = ${r.toFixed(3)}`} />
              <Slider
                label="Amplitudo tanah"
                symbol="ug₀"
                unit="cm"
                value={Number((p.ug * 100).toFixed(1))}
                min={RANGES.ug.min * 100}
                max={RANGES.ug.max * 100}
                step={RANGES.ug.step * 100}
                onChange={(v) => setP({ ...p, ug: v / 100 })}
              />
              <div className="btn-row">
                {md.w.map((wn, k) => (
                  <button key={k} className="btn ghost sm" onClick={() => setF(wn / (2 * Math.PI))} title={`Resonansi mode ${k + 1}`}>
                    f = f{k + 1}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="card">
              <h3>Getarkan</h3>
              <div className="btn-row">
                {md.w.map((_, k) => (
                  <button key={k} className={`btn sm ${activeMode === k ? 'primary' : 'ghost'}`} onClick={() => exciteMode(k)}>
                    Mode {k + 1}
                  </button>
                ))}
              </div>
              <div className="btn-row">
                <button className="btn ghost sm" onClick={pushRoof} title="Lendutan statis akibat gaya lateral di atap, lalu dilepas">
                  Dorong atap
                </button>
                <button className="btn ghost sm" onClick={kickGround} title="Tanah tersentak (impuls kecepatan): semua mode ikut bergetar">
                  Sentak tanah
                </button>
              </div>
            </div>
          )}

          <div className="card">
            <h3>Kontrol</h3>
            <div className="btn-row">
              <button className="btn primary sm" onClick={() => setRunning(!running)}>
                {running ? '❚❚ Jeda' : '▶ Jalan'}
              </button>
              <button className="btn ghost sm" onClick={() => restart(false)}>
                ⟲ Dari diam
              </button>
              {ground && (
                <button className="btn ghost sm" onClick={() => restart(true)} title="Langsung pada keadaan tunak">
                  Mulai tunak
                </button>
              )}
              <select className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Kecepatan">
                <option value={1}>1×</option>
                <option value={0.5}>0,5×</option>
                <option value={0.25}>0,25×</option>
                <option value={0.1}>0,1×</option>
              </select>
            </div>
            {ground && (
              <div className="btn-row">
                <button className="btn ghost sm" disabled={sweeping || p.z === 0} onClick={sweep} title="Simulasikan banyak ω sampai tunak dan plot amplitudo atap">
                  {sweeping ? 'Menyapu…' : 'Sapu frekuensi'}
                </button>
                <button className="btn ghost sm" onClick={() => setPoints([])} disabled={!points.length}>
                  Hapus titik ({points.length})
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Mode getar (teori)</h3>
            <table className="readout">
              <tbody>
                <tr>
                  <th>Mode</th>
                  <th>T (s)</th>
                  <th>f (Hz)</th>
                  <th>Γ·φ atap</th>
                  <th>Mₑ</th>
                </tr>
                {md.w.map((wn, k) => (
                  <tr key={k}>
                    <th>{k + 1}</th>
                    <td>{md.T[k].toFixed(3)}</td>
                    <td>{(wn / (2 * Math.PI)).toFixed(2)}</td>
                    <td>{(md.gamma[k] * md.phi[k][n - 1]).toFixed(3)}</td>
                    <td>{((md.meff[k] / mTot) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="slider-hint" style={{ marginTop: 6 }}>
              Bentuk mode (atap = 1):{' '}
              {md.w.map((_, k) => (
                <span key={k}>
                  <b>φ{k + 1}</b> = [{shapeRoof(md, k).map((v) => v.toFixed(2)).join(', ')}]{k < n - 1 ? ' · ' : ''}
                </span>
              ))}
            </p>
          </div>

          <div className="card">
            <h3>Terukur</h3>
            <table className="readout">
              <tbody>
                <tr>
                  <th>T atap terukur</th>
                  <td>{read.T ? `${read.T.toFixed(3)} s` : '—'}</td>
                  <th>{ground ? 'u₀ atap terukur' : 'Puncak atap'}</th>
                  <td>{read.A !== null ? fmtCm(read.A) : '—'}</td>
                </tr>
                {ground && steadyAmp && (
                  <tr>
                    <th>u₀ atap teori</th>
                    <td>{Number.isFinite(steadyAmp[n - 1]) ? fmtCm(steadyAmp[n - 1]) : '∞'}</td>
                    <th>Rasio u₀/ug₀</th>
                    <td>{read.A !== null ? (read.A / p.ug).toFixed(2) : '—'}</td>
                  </tr>
                )}
                <tr>
                  <th>Drift maks</th>
                  <td>
                    {maxDriftJ >= 0 ? `${((maxDrift / STORY_H) * 100).toFixed(2)}%` : '—'} <small>{maxDriftJ >= 0 ? `tingkat ${maxDriftJ + 1}` : ''}</small>
                  </td>
                  <th>Geser dasar maks</th>
                  <td>{read.drift.length ? `${((k1 * read.drift[0]) / 1000).toFixed(1)} kN` : '—'}</td>
                </tr>
              </tbody>
            </table>
            <p className="slider-hint" style={{ marginTop: 6 }}>
              Drift = selisih simpangan dua lantai berurutan / tinggi tingkat ({STORY_H} m). Selubung maks direset setiap parameter berubah.
            </p>
          </div>
        </aside>
      </div>

      <Notes p={p} md={md} ground={ground} />
    </div>
  )
}

function mergePoints(old: Point[], add: Point[]) {
  const out = old.filter((o) => !add.some((a) => Math.abs(a.r - o.r) < 0.003 && a.zeta === o.zeta && a.key === o.key))
  return [...out, ...add].slice(-500)
}

function Notes({ p, md, ground }: { p: Params; md: Modes; ground: boolean }) {
  const n = md.n
  const mTot = md.ms.reduce((a, b) => a + b, 0)
  const m1 = (md.meff[0] / mTot) * 100
  return (
    <div className="notes">
      <div className="card">
        <h3>Catatan konsep</h3>
        <ul>
          <li>
            <b>Bangunan geser:</b> pelat lantai dianggap kaku dan memusatkan massa; kolom hanya melentur (ujung jepit) sehingga tiap tingkat
            berperilaku seperti pegas geser k. Persamaan gerak: <code>M·ü + C·u̇ + K·u = −M·1·üg</code>, dengan K tridiagonal.
          </li>
          <li>
            <b>Mode getar:</b> solusi K·φ = ω²·M·φ memberi {n} frekuensi alami dan bentuk mode. Mode n punya n − 1 titik balik arah (simpul).
            Gedung yang digetarkan tepat dalam satu bentuk mode bergetar selamanya dalam bentuk itu, pada periode Tn-nya.
          </li>
          <li>
            <b>Superposisi modal:</b> gerakan apa pun = jumlah mode, u = Σ φn·qn(t); tiap qn adalah SDOF tersendiri (Room Spring/Resonance).
          </li>
          <li>
            <b>Massa efektif</b> Mₑ = Γn² menunjukkan porsi massa yang “ikut” di tiap mode akibat gerak tanah. Di sini mode 1 = {m1.toFixed(1)}%.
            SNI 1726 meminta jumlah ragam ≥ 90% massa.
          </li>
          {ground && (
            <li>
              <b>Gerak tanah harmonik:</b> resonansi terjadi di setiap ωn; puncak pada mode tinggi lebih kecil karena Γn dan Mₑ-nya kecil.
            </li>
          )}
        </ul>
      </div>
      <div className="card">
        <h3>Coba ini</h3>
        <ol>
          <li>Klik Mode 2 di panel mode: lantai atas dan bawah bergerak berlawanan. T terukur di atap = T₂ teori.</li>
          <li>Tarik pelat atap lalu lepas: gerakan didominasi mode 1, dengan “riak” kecil dari mode lain.</li>
          <li>Klik “Lantai lunak” (k₁ = 0,3k): mode 1 terpusat di tingkat dasar, drift tingkat 1 melonjak — mekanisme runtuh soft story.</li>
          <li>Tambah jumlah lantai: T₁ naik kira-kira sebanding N (rumus praktis T ≈ 0,1·N detik untuk rangka momen).</li>
          {ground ? (
            <>
              <li>Klik “f = f1”, lalu “f = f2”: bentuk selubung (profil kanan) berubah mengikuti bentuk mode yang beresonansi.</li>
              <li>“Sapu frekuensi”: titik hijau hasil simulasi jatuh di kurva atap, dengan {n} puncak resonansi.</li>
            </>
          ) : (
            <li>Atur ζ = 0 dan getarkan Mode 1: energi tidak pernah pindah ke mode lain (ortogonalitas mode).</li>
          )}
          {p.mr < 0.5 && <li>Massa atap kecil (seperti menara/penthouse ringan): perhatikan efek cambuk (whiplash) di mode tinggi.</li>}
        </ol>
      </div>
    </div>
  )
}
