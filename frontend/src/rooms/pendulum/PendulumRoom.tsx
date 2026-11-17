import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { rk4Vec, type Deriv } from '../../lab/ode'
import { drawPlot, PlotScale, type Sample } from '../../lab/plot'
import { C } from '../../lab/theme'
import { Check, Segmented, Slider } from '../../ui/controls'
import {
  DEG,
  defaults,
  initialState,
  is1dof,
  parseQuery,
  ranges,
  SETUPS,
  toPend1,
  toPend2,
  toQuery,
  type Params,
  type Setup,
} from './model'
import {
  pend1Deriv,
  pend1Energy,
  pend1Modal,
  pend2Deriv,
  pend2Energy,
  pend2Modes,
  periodLarge,
  rodInertia,
  rodLeq,
} from './physics'
import { angleFrom, drawStage, hitTest, targetView, type Layout, type View } from './stage'

const WINDOW = 10 // detik pada grafik
const H = 1 / 2000 // langkah integrasi (s)
const SAMPLE_DT = 1 / 120
const TRAIL_S = 2.5 // detik jejak bandul ganda
const TWIN = 0.01 * DEG // gangguan awal bandul kembar

interface Readout {
  T: number | null
  A: number | null
  cycles: number
  ek: number
  ep: number
  ed: number
  e0: number
  y: number[]
  t: number
  sep: number // ganda: selisih θ₂ terhadap kembar (rad)
}

const EMPTY: Readout = { T: null, A: null, cycles: 0, ek: 0, ep: 0, ed: 0, e0: 0, y: [0, 0, 0, 0], t: 0, sep: 0 }

const f = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '∞')
const fd = (rad: number, d = 1) => `${(rad / DEG).toFixed(d)}°`
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const round1 = (v: number) => Math.round(v * 10) / 10

interface System {
  main: Deriv
  ghost: Deriv
  energy: (y: number[]) => { ek: number; ep: number }
  iv: number // indeks kecepatan koordinat pertama
}

function makeSystem(setup: Setup, p: Params): System {
  if (is1dof(setup)) {
    const s = toPend1(setup, p)
    return { main: pend1Deriv(s), ghost: pend1Deriv({ ...s, linear: true }), energy: (y) => pend1Energy(s, y), iv: 1 }
  }
  const s = toPend2(p)
  const d = pend2Deriv(s)
  return { main: d, ghost: d, energy: (y) => pend2Energy(s, y), iv: 2 }
}

const ghostOf = (setup: Setup, y: number[]) => (setup === 'ganda' ? [y[0], y[1] + TWIN, y[2], y[3]] : [...y])

export default function PendulumRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [show, setShow] = useState({ linear: false, twin: true, amp: true, period: true, env: true, angles: true, trail: true })
  const [read, setRead] = useState<Readout>(EMPTY)
  const [grabbing, setGrabbing] = useState(false)

  const one = is1dof(setup)
  const sys = useMemo(() => makeSystem(setup, p), [setup, p])
  const m1 = useMemo(() => (one ? pend1Modal(toPend1(setup, p)) : null), [one, setup, p])
  const modes = useMemo(() => (one ? null : pend2Modes(toPend2(p))), [one, p])
  const rg = ranges(setup, p)

  const live = useRef({ setup, p, sys, running, speed, show, m1 })
  live.current = { setup, p, sys, running, speed, show, m1 }

  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const sim = useRef({ y: initialState(init.setup, init.params), t: 0 })
  const ghost = useRef<number[]>(ghostOf(init.setup, sim.current.y))
  const hist = useRef<Sample[]>([])
  const hist2 = useRef<Sample[]>([])
  const histG = useRef<Sample[]>([])
  const trail = useRef<{ x: number; y: number }[]>([])
  const peaks = useRef<Sample[]>([])
  const env = useRef({ t0: 0, a0: Math.abs(sim.current.y[0]), e0: 0 })
  const drag = useRef<{ idx: number; off: number } | null>(null)
  const layout = useRef<Layout | null>(null)
  const view = useRef<View | null>(null)
  const plotScale = useRef(new PlotScale())

  // ---- aksi ----
  const markRelease = () => {
    const L = live.current
    const s = sim.current
    const e = L.sys.energy(s.y)
    let a0 = Math.abs(s.y[0])
    if (L.m1 && L.m1.zeta < 1) {
      const wd = L.m1.w0 * Math.sqrt(1 - L.m1.zeta ** 2)
      a0 = Math.hypot(s.y[0], (s.y[1] + L.m1.zeta * L.m1.w0 * s.y[0]) / wd)
    }
    env.current = { t0: s.t, a0, e0: e.ek + e.ep }
    peaks.current = []
    ghost.current = ghostOf(L.setup, s.y)
  }

  const clearPlot = () => {
    hist.current = []
    hist2.current = []
    histG.current = []
    trail.current = []
    peaks.current = []
    plotScale.current = new PlotScale()
  }

  const reset = (s: Setup = live.current.setup, np: Params = live.current.p) => {
    sim.current = { y: initialState(s, np), t: 0 }
    clearPlot()
    live.current = { ...live.current, setup: s, p: np, sys: makeSystem(s, np), m1: is1dof(s) ? pend1Modal(toPend1(s, np)) : null }
    markRelease()
  }

  const changeSetup = (s: Setup) => {
    const np = defaults(s)
    setSetup(s)
    setP(np)
    view.current = null
    reset(s, np)
    setRunning(true)
  }

  // parameter berubah saat berjalan: sudut awal berubah → bandul dipindah ke sudut itu dan dilepas;
  // parameter lain → keadaan (θ, ω) tetap, sistem berganti seketika.
  const prev = useRef({ setup, p })
  useEffect(() => {
    onQuery(toQuery(setup, p))
    const old = prev.current
    prev.current = { setup, p }
    if (old.setup !== setup || old.p === p) return
    if (old.p.a !== p.a || old.p.a2 !== p.a2) {
      sim.current.y = initialState(setup, p)
      setRunning(true)
    }
    markRelease()
  }, [setup, p]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const ganda = L.setup === 'ganda'
      const iv = L.sys.iv
      if (L.running || drag.current) {
        let rem = dtReal * L.speed
        if (drag.current) {
          s.t += rem
          for (let i = s.y.length / 2; i < s.y.length; i++) s.y[i] = 0
          ghost.current = ghostOf(L.setup, s.y)
        } else {
          while (rem > 1e-12) {
            const h = Math.min(H, rem)
            const prevV = s.y[iv]
            s.y = rk4Vec(L.sys.main, s.y, h)
            ghost.current = rk4Vec(L.sys.ghost, ghost.current, h)
            s.t += h
            rem -= h
            if (prevV > 0 && s.y[iv] <= 0 && s.y[0] > 1e-4) peaks.current.push({ t: s.t, u: s.y[0] })
          }
        }
        if (s.t - lastSample >= SAMPLE_DT || lastSample < 0 || s.t < lastSample) {
          lastSample = s.t
          hist.current.push({ t: s.t, u: s.y[0] })
          histG.current.push({ t: s.t, u: ganda ? ghost.current[1] : ghost.current[0] })
          if (ganda) {
            hist2.current.push({ t: s.t, u: s.y[1] })
            const P = L.p
            trail.current.push({ x: P.L * Math.sin(s.y[0]) + P.L2 * Math.sin(s.y[1]), y: P.L * Math.cos(s.y[0]) + P.L2 * Math.cos(s.y[1]) })
            const maxTrail = Math.round(TRAIL_S / SAMPLE_DT)
            if (trail.current.length > maxTrail) trail.current.splice(0, trail.current.length - maxTrail)
          }
          const cut = s.t - WINDOW - 1
          if (hist.current.length > 3000 || (hist.current[0] && hist.current[0].t < cut)) {
            hist.current = hist.current.filter((x) => x.t >= cut)
            hist2.current = hist2.current.filter((x) => x.t >= cut)
            histG.current = histG.current.filter((x) => x.t >= cut)
            peaks.current = peaks.current.filter((x) => x.t >= cut - WINDOW)
          }
        }
      }

      // panggung
      const sc = stageRef.current
      if (sc) {
        const { w, h, ctx } = fitCanvas(sc)
        const tv = targetView(L.setup, w, h, L.p, s.y)
        const v = view.current
        view.current = v ? { s: v.s + (tv.s - v.s) * 0.12, py: v.py + (tv.py - v.py) * 0.12 } : tv
        layout.current = drawStage(ctx, w, h, L.setup, L.p, s.y, view.current, {
          ghost: (ganda ? L.show.twin : L.show.linear) ? ghost.current : null,
          trail: ganda && L.show.trail ? trail.current : [],
          showAngles: L.show.angles,
        })
      }
      // grafik
      const pc = plotRef.current
      if (pc) {
        const { w, h, ctx } = fitCanvas(pc)
        const m = L.m1
        const extra = ganda
          ? [
              { samples: hist2.current, color: C.green, label: 'θ₂' },
              ...(L.show.twin ? [{ samples: histG.current, color: C.orange, dash: [5, 4], label: 'θ₂ kembar' }] : []),
            ]
          : L.show.linear
            ? [{ samples: histG.current, color: C.orange, dash: [6, 4], label: 'model linear (sin θ ≈ θ)' }]
            : []
        drawPlot(
          ctx,
          w,
          h,
          hist.current,
          {
            window: WINDOW,
            tNow: s.t,
            factor: 1 / DEG,
            unit: '°',
            name: ganda ? 'θ₁, θ₂' : 'θ',
            mainLabel: ganda ? 'θ₁' : 'non-linear (sebenarnya)',
            extra,
            peaks: peaks.current,
            showAmplitude: L.show.amp,
            showPeriod: L.show.period,
            envelope:
              L.show.env && m && m.zeta > 0 && m.zeta < 1 ? { t0: env.current.t0, a0: env.current.a0, decay: m.zeta * m.w0 } : null,
          },
          plotScale.current,
        )
      }

      if (now - lastRead > 100) {
        lastRead = now
        const pk = peaks.current
        const e = L.sys.energy(s.y)
        setRead({
          T: pk.length >= 2 ? pk[pk.length - 1].t - pk[pk.length - 2].t : null,
          A: pk.length ? pk[pk.length - 1].u : null,
          cycles: Math.max(0, pk.length - 1),
          ek: e.ek,
          ep: e.ep,
          ed: Math.max(0, env.current.e0 - e.ek - e.ep),
          e0: Math.max(env.current.e0, e.ek + e.ep),
          y: [...s.y],
          t: s.t,
          sep: ganda ? Math.abs(wrap(s.y[1] - ghost.current[1])) : 0,
        })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- pointer ----
  const local = (e: React.PointerEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }
  /** Titik putar untuk benda idx (ganda idx 1 berputar di massa 1). */
  const origin = (l: Layout, idx: number) => (l.setup === 'ganda' && idx === 1 ? [l.bobs[0].x, l.bobs[0].y] : [l.px, l.py])
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    const idx = hitTest(l, x, y)
    if (idx < 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const [ox, oy] = origin(l, idx)
    drag.current = { idx, off: wrap(angleFrom(ox, oy, x, y) - sim.current.y[idx]) }
    setGrabbing(true)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    const d = drag.current
    if (!d) {
      e.currentTarget.style.cursor = hitTest(l, x, y) >= 0 ? 'grab' : 'default'
      return
    }
    const [ox, oy] = origin(l, d.idx)
    const cur = sim.current.y[d.idx]
    const target = angleFrom(ox, oy, x, y) - d.off
    sim.current.y[d.idx] = cur + wrap(target - cur)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setGrabbing(false)
    // sudut lepas menjadi sudut awal baru (slider ikut, Reset kembali ke sini)
    const y = sim.current.y
    const ang = (v: number) => Math.max(-179, Math.min(179, round1(wrap(v) / DEG)))
    setP((old) => (live.current.setup === 'ganda' ? { ...old, a: ang(y[0]), a2: ang(y[1]) } : { ...old, a: ang(y[0]) }))
    setRunning(true)
  }

  const set = (key: keyof Params) => (v: number) =>
    setP((old) => {
      const n = { ...old, [key]: v }
      if (key === 'L' && n.d > n.L / 2) n.d = Math.round((n.L / 2) * 1000) / 1000
      return n
    })
  const kick = () => {
    sim.current.y[one ? 1 : 2] += 1.5
    markRelease()
    setRunning(true)
  }
  const eMax = Math.max(read.e0, read.ek + read.ep + read.ed, 1e-12)

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Getaran &amp; Dinamika › <b>Room Pendulum</b>
        </span>
        <Segmented value={setup} options={SETUPS.map((s) => ({ id: s.id, label: s.label, title: s.hint }))} onChange={changeSetup} />
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
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            <div className="stage-tip">
              {setup === 'ganda'
                ? 'Tarik salah satu massa ke posisi awal, lalu lepaskan.'
                : setup === 'fisik'
                  ? 'Putar batang dengan mouse/jari, lalu lepaskan.'
                  : 'Tarik massa ke sudut awal, lalu lepaskan.'}
            </div>
            <div className="stage-live">
              <span>t = {read.t.toFixed(2)} s</span>
              {one ? (
                <>
                  <span>θ = {fd(read.y[0])}</span>
                  <span>ω = {read.y[1].toFixed(3)} rad/s</span>
                </>
              ) : (
                <>
                  <span>θ₁ = {fd(read.y[0])}</span>
                  <span>θ₂ = {fd(read.y[1])}</span>
                </>
              )}
            </div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Grafik sudut terhadap waktu</b>
              <div className="plot-opts">
                {one ? (
                  <Check label="Model linear" checked={show.linear} onChange={(v) => setShow({ ...show, linear: v })} />
                ) : (
                  <Check label="Bandul kembar" checked={show.twin} onChange={(v) => setShow({ ...show, twin: v })} />
                )}
                <Check label="Amplitudo" checked={show.amp} onChange={(v) => setShow({ ...show, amp: v })} />
                <Check label="Periode" checked={show.period} onChange={(v) => setShow({ ...show, period: v })} />
                {one && <Check label="Selubung redaman" checked={show.env} onChange={(v) => setShow({ ...show, env: v })} />}
              </div>
            </div>
            <canvas ref={plotRef} className="plot" />
          </div>
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Parameter</h3>
            {setup === 'sederhana' && (
              <>
                <Slider label="Panjang tali" symbol="L" unit="m" value={p.L} {...rg.L} onChange={set('L')} />
                <Slider label="Massa" symbol="m" unit="kg" value={p.m} {...rg.m} onChange={set('m')} />
              </>
            )}
            {setup === 'fisik' && (
              <>
                <Slider label="Panjang batang" symbol="L" unit="m" value={p.L} {...rg.L} onChange={set('L')} />
                <Slider
                  label="Jarak sendi ke titik berat"
                  symbol="d"
                  unit="m"
                  value={p.d}
                  {...rg.d}
                  onChange={set('d')}
                  hint={`periode minimum di d = L/√12 = ${(p.L / Math.sqrt(12)).toFixed(3)} m`}
                />
                <Slider label="Massa batang" symbol="m" unit="kg" value={p.m} {...rg.m} onChange={set('m')} />
              </>
            )}
            {setup === 'ganda' && (
              <>
                <Slider label="Panjang tali 1" symbol="L₁" unit="m" value={p.L} {...rg.L} onChange={set('L')} />
                <Slider label="Panjang tali 2" symbol="L₂" unit="m" value={p.L2} {...rg.L2} onChange={set('L2')} />
                <Slider label="Massa 1" symbol="m₁" unit="kg" value={p.m} {...rg.m} onChange={set('m')} />
                <Slider label="Massa 2" symbol="m₂" unit="kg" value={p.m2} {...rg.m2} onChange={set('m2')} />
              </>
            )}
            <Slider
              label="Redaman sendi"
              symbol="c"
              unit="N·m·s/rad"
              value={p.c}
              {...rg.c}
              onChange={set('c')}
              hint={m1 ? `c kritis (sudut kecil) = ${m1.cCrit.toFixed(2)} N·m·s/rad` : 'peredam rotasi di sendi atas dan sendi tengah'}
            />
            <Slider label={one ? 'Sudut awal' : 'Sudut awal 1'} symbol={one ? 'θ₀' : 'θ₁₀'} unit="°" value={p.a} {...rg.a} onChange={set('a')} />
            {!one && <Slider label="Sudut awal 2" symbol="θ₂₀" unit="°" value={p.a2} {...rg.a2} onChange={set('a2')} />}
            <Slider label="Gravitasi" symbol="g" unit="m/s²" value={p.g} {...rg.g} onChange={set('g')} hint="Bumi 9,81 · Bulan 1,62 · Mars 3,71" />
            <div className="btn-row">
              {m1 && (
                <button className="btn ghost sm" onClick={() => setP({ ...p, c: Number(m1.cCrit.toFixed(3)) })}>
                  c = kritis
                </button>
              )}
              <button className="btn ghost sm" onClick={() => setP({ ...p, c: 0 })}>
                c = 0
              </button>
              <button className="btn ghost sm" onClick={() => setP(defaults(setup))}>
                Bawaan
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Kontrol</h3>
            <div className="btn-row">
              <button className="btn primary sm" onClick={() => setRunning(!running)}>
                {running ? '❚❚ Jeda' : '▶ Jalan'}
              </button>
              <button className="btn ghost sm" onClick={() => reset()} title="Kembali ke sudut awal, grafik dikosongkan">
                ⟲ Reset
              </button>
              <select className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Kecepatan">
                <option value={1}>1×</option>
                <option value={0.5}>0,5×</option>
                <option value={0.25}>0,25×</option>
                <option value={0.1}>0,1×</option>
              </select>
            </div>
            <div className="btn-row">
              {one ? (
                [5, 30, 90, 170].map((a) => (
                  <button key={a} className="btn ghost sm" onClick={() => setP({ ...p, a })} title={`Lepas dari ${a}°`}>
                    θ₀ = {a}°
                  </button>
                ))
              ) : (
                <>
                  {modes && (
                    <>
                      <ModeButton label="Mode 1" ratio={modes.shape[0]} onSet={(a, a2) => setP({ ...p, a, a2 })} />
                      <ModeButton label="Mode 2" ratio={modes.shape[1]} onSet={(a, a2) => setP({ ...p, a, a2 })} />
                    </>
                  )}
                  <button className="btn ghost sm" onClick={() => setP({ ...p, a: 110, a2: 150 })}>
                    Kacau (110°, 150°)
                  </button>
                </>
              )}
              <button className="btn ghost sm" onClick={kick} title="Beri kecepatan sudut awal (impuls)">
                Ketuk
              </button>
            </div>
            <div className="btn-row">
              <Check label="Busur sudut" checked={show.angles} onChange={(v) => setShow({ ...show, angles: v })} />
              {one && (
                <Check
                  label="Tampilkan model linear (sin θ ≈ θ)"
                  checked={show.linear}
                  onChange={(v) => setShow({ ...show, linear: v })}
                />
              )}
              {!one && <Check label="Jejak massa 2" checked={show.trail} onChange={(v) => setShow({ ...show, trail: v })} />}
            </div>
          </div>

          <div className="card">
            <h3>Teori vs terukur</h3>
            {m1 ? <Table1 setup={setup} p={p} m1={m1} read={read} /> : modes && <Table2 modes={modes} read={read} />}
          </div>

          <div className="card">
            <h3>Energi</h3>
            <Bar label="Kinetik" value={read.ek} max={eMax} color="var(--navy)" />
            <Bar label="Potensial gravitasi (terhadap posisi terendah)" value={read.ep} max={eMax} color="var(--green)" />
            <Bar label={p.c > 0 ? 'Diserap peredam' : 'Galat numerik (harus ≈ 0)'} value={read.ed} max={eMax} color="var(--orange)" />
          </div>
        </aside>
      </div>

      <Notes setup={setup} p={p} />
    </div>
  )
}

function ModeButton({ label, ratio, onSet }: { label: string; ratio: number; onSet: (a: number, a2: number) => void }) {
  // amplitudo kecil (≤ 10°) agar tetap linear
  const a = Math.abs(ratio) > 1 ? 10 / Math.abs(ratio) : 10
  return (
    <button
      className="btn ghost sm"
      onClick={() => onSet(round1(a), round1(a * ratio))}
      title={`Lepas pada bentuk mode: θ₂/θ₁ = ${ratio.toFixed(3)}`}
    >
      {label}
    </button>
  )
}

function Table1({ setup, p, m1, read }: { setup: Setup; p: Params; m1: ReturnType<typeof pend1Modal>; read: Readout }) {
  const amp = read.A ?? Math.abs(p.a * DEG)
  const TL = periodLarge(m1.T0, amp)
  const dev = read.T ? (read.T / m1.T0 - 1) * 100 : null
  const d = Math.min(p.d, p.L / 2)
  return (
    <table className="readout">
      <tbody>
        <tr>
          <th>T₀ sudut kecil</th>
          <td>{f(m1.T0)} s</td>
          <th>T terukur</th>
          <td>{read.T ? `${f(read.T)} s` : '—'}</td>
        </tr>
        <tr>
          <th>T eksak di A</th>
          <td>{f(TL)} s</td>
          <th>Selisih thd T₀</th>
          <td>{dev !== null ? `${dev >= 0 ? '+' : ''}${dev.toFixed(2)} %` : '—'}</td>
        </tr>
        <tr>
          <th>Frekuensi f₀</th>
          <td>{f(m1.f0)} Hz</td>
          <th>Amplitudo A</th>
          <td>{read.A ? fd(read.A) : '—'}</td>
        </tr>
        <tr>
          <th>Rasio redaman ζ</th>
          <td>{f(m1.zeta, 3)}</td>
          <th>Siklus terhitung</th>
          <td>{read.cycles}</td>
        </tr>
        {setup === 'fisik' && (
          <tr>
            <th>Inersia sendi I</th>
            <td>{f(rodInertia(p.m, p.L, d), 4)} kg·m²</td>
            <th>Leq = I/(m·d)</th>
            <td>{f(rodLeq(p.L, d))} m</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function Table2({ modes, read }: { modes: ReturnType<typeof pend2Modes>; read: Readout }) {
  return (
    <table className="readout">
      <tbody>
        <tr>
          <th>Mode 1 T₁</th>
          <td>{f(modes.T[0])} s</td>
          <th>T terukur θ₁</th>
          <td>{read.T ? `${f(read.T)} s` : '—'}</td>
        </tr>
        <tr>
          <th>Mode 2 T₂</th>
          <td>{f(modes.T[1])} s</td>
          <th>Amplitudo θ₁</th>
          <td>{read.A ? fd(read.A) : '—'}</td>
        </tr>
        <tr>
          <th>Bentuk θ₂/θ₁</th>
          <td>
            {modes.shape[0].toFixed(3)} · {modes.shape[1].toFixed(3)}
          </td>
          <th>Selisih kembar</th>
          <td>{fd(read.sep, read.sep < 1 * DEG ? 3 : 1)}</td>
        </tr>
        <tr>
          <th>Energi total</th>
          <td>{f(read.ek + read.ep)} J</td>
          <th>Siklus terhitung</th>
          <td>{read.cycles}</td>
        </tr>
      </tbody>
    </table>
  )
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="ebar">
      <div className="ebar-head">
        <span>{label}</span>
        <span>{value.toFixed(3)} J</span>
      </div>
      <div className="ebar-track">
        <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </div>
    </div>
  )
}

function Notes({ setup, p }: { setup: Setup; p: Params }) {
  if (setup === 'ganda') {
    const md = pend2Modes(toPend2(p))
    return (
      <div className="notes">
        <div className="card">
          <h3>Catatan konsep</h3>
          <ul>
            <li>
              <b>Dua derajat kebebasan:</b> keadaan bandul ditentukan dua sudut θ₁ dan θ₂. Persamaan geraknya (Lagrange) saling terkopel
              dan non-linear — tidak ada rumus periode tunggal.
            </li>
            <li>
              <b>Mode normal (sudut kecil):</b> persamaan dilinearkan menjadi <code>M·θ̈ + K·θ = 0</code>, sama seperti struktur MDOF.
              Dari det(K − ω²M) = 0 diperoleh T₁ = <b>{md.T[0].toFixed(3)} s</b> (θ₂/θ₁ = {md.shape[0].toFixed(3)}, sefase) dan T₂ ={' '}
              <b>{md.T[1].toFixed(3)} s</b> (θ₂/θ₁ = {md.shape[1].toFixed(3)}, berlawanan fase).
            </li>
            <li>
              <b>Chaos:</b> pada sudut besar gerak sangat peka terhadap kondisi awal. Bandul kembar (oranye) dimulai hanya 0,01° berbeda
              pada θ₂, namun setelah beberapa detik geraknya sama sekali lain — walau energi total tetap kekal.
            </li>
            <li>
              Jembatan ke dinamika struktur: portal geser 2 lantai juga punya 2 mode, dengan periode dan bentuk mode yang dicari dengan
              cara yang sama (lihat Room Shear Building, menyusul).
            </li>
          </ul>
        </div>
        <div className="card">
          <h3>Coba ini</h3>
          <ol>
            <li>Klik “Mode 1”: kedua massa berayun searah dengan satu periode T₁. Bandingkan T terukur dengan T₁.</li>
            <li>Klik “Mode 2”: massa berayun berlawanan arah, lebih cepat (T₂).</li>
            <li>Lepas dengan θ₁₀ = 10°, θ₂₀ = 0°: gerak adalah campuran dua mode, grafik θ₂ terlihat “berdenyut”.</li>
            <li>Klik “Kacau”, perhatikan kapan bandul kembar mulai berpisah. Kecilkan m₂ — apa yang terjadi?</li>
            <li>Beri redaman kecil (c = 0,05): energi hilang, gerak kacau berangsur menjadi ayunan mode 1.</li>
          </ol>
        </div>
      </div>
    )
  }

  const fisik = setup === 'fisik'
  const sys = toPend1(setup, p)
  const md = pend1Modal(sys)
  const d = Math.min(p.d, p.L / 2)
  return (
    <div className="notes">
      <div className="card">
        <h3>Catatan konsep</h3>
        <ul>
          <li>
            <b>Persamaan gerak:</b> <code>I·θ̈ + c·θ̇ + m·g·d·sin θ = 0</code>. Karena ada sin θ, persamaan ini <b>non-linear</b>.
          </li>
          {fisik ? (
            <li>
              <b>Bandul fisik:</b> inersia terhadap sendi I = m·(L²/12 + d²) (teorema sumbu sejajar) = {sys.I.toFixed(4)} kg·m². Untuk sudut
              kecil T₀ = 2π·√(I/(m·g·d)) = <b>{md.T0.toFixed(3)} s</b>, sama dengan bandul sederhana sepanjang Leq = I/(m·d) ={' '}
              {rodLeq(p.L, d).toFixed(3)} m (titik oranye = pusat osilasi).
            </li>
          ) : (
            <li>
              <b>Sudut kecil</b> (sin θ ≈ θ): T₀ = 2π·√(L/g) = 2π·√({p.L} / {p.g}) = <b>{md.T0.toFixed(3)} s</b>. Massa tidak berpengaruh —
              massa muncul di gaya pemulih dan di inersia, lalu saling menghapus.
            </li>
          )}
          <li>
            <b>Sudut besar:</b> periode eksak T = T₀ / AGM(1, cos(θ₀/2)) (integral eliptik lengkap), selalu lebih panjang dari T₀: +0,05% di
            5°, +1,7% di 30°, +18% di 90°. Kira-kira T ≈ T₀·(1 + θ₀²/16).
          </li>
          <li>
            <b>Model linear</b> (oranye, aktifkan lewat “Tampilkan model linear”) memakai θ sebagai pengganti sin θ. Di sudut kecil keduanya berimpit; di sudut besar model linear
            “mendahului” karena periodenya selalu T₀.
          </li>
          <li>
            <b>Redaman sendi:</b> ζ = c / (2·√(m·g·d·I)) = {md.zeta.toFixed(3)}.
          </li>
        </ul>
      </div>
      <div className="card">
        <h3>Coba ini</h3>
        <ol>
          {fisik ? (
            <>
              <li>Geser d dari kecil ke L/2. Periode turun lalu naik lagi — minimum di d = L/√12 ≈ 0,289·L.</li>
              <li>Sendi di ujung batang (d = L/2): Leq = 2L/3, jadi batang 1 m berayun seperti bandul sederhana 0,667 m.</li>
              <li>Pindahkan sendi ke pusat osilasi (d baru = Leq − d): periodenya sama! (titik sendi dan pusat osilasi bisa ditukar).</li>
            </>
          ) : (
            <>
              <li>Ubah massa dari 0,1 sampai 10 kg: periode tidak berubah.</li>
              <li>Jadikan L empat kali: periode menjadi dua kali.</li>
            </>
          )}
          <li>Klik θ₀ = 5°, 30°, 90°, 170° bergantian dan catat “Selisih thd T₀”. Kapan anggapan sudut kecil masih wajar (&lt; 1%)?</li>
          <li>Di θ₀ = 170° bandul hampir terbalik: periode lebih dari dua kali T₀ dan bentuk grafik tidak lagi sinus.</li>
          <li>Beri redaman kecil: amplitudo mengecil, dan T terukur makin mendekati T₀.</li>
        </ol>
      </div>
    </div>
  )
}
