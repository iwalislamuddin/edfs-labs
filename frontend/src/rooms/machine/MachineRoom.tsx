import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { drawPlot, PlotScale, type Sample } from '../../lab/plot'
import { C } from '../../lab/theme'
import { Segmented, Slider } from '../../ui/controls'
import { defaults, FNDS, foundationOf, machineOf, parseQuery, RANGES, RPM_MAX, SCALES, SETUPS, severity, snapScale, toQuery, type FndKind, type Params, type Setup } from './model'
import { forceHarmonics, rpmToW, wToRpm } from './physics'
import { drawResponse, rpmAt, type RespLayout } from './response'
import { bearing, machineForces, modes3, step3, steady3, steadyState3, type Mode3, type State3 } from './rocking'
import { drawStage, targetScale } from './stage'

const H = 1 / 4000
const V_LIM = 6.3e-3 // m/s, batas indikatif "dapat diterima"
const ORBIT_N = 96

/** Warna pita per jenis mode: [isi grafik, busur takometer]. */
const MODE_COLOR: Record<Mode3['kind'], { fill: string; arc: string; line: string }> = {
  vertikal: { fill: 'rgba(181,69,47,0.08)', arc: 'rgba(181,69,47,0.75)', line: '#b5452f' },
  'geser–rocking 1': { fill: 'rgba(102,20,101,0.08)', arc: 'rgba(102,20,101,0.7)', line: '#661465' },
  'geser–rocking 2': { fill: 'rgba(31,111,139,0.08)', arc: 'rgba(31,111,139,0.7)', line: '#1f6f8b' },
}

interface Readout {
  rpm: number
  t: number
  hx: number | null
  hz: number | null
}

interface Trace {
  hx: { rpm: number; amp: number }[]
  hz: { rpm: number; amp: number }[]
}

export default function MachineRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [motorOn, setMotorOn] = useState(false)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(0.1)
  const [read, setRead] = useState<Readout>({ rpm: 0, t: 0, hx: null, hz: null })

  const tanah = p.fd === 'tanah'
  const mach = useMemo(() => machineOf(setup, p), [setup, p])
  const fnd = useMemo(() => foundationOf(p), [p])
  const sys = fnd.sys
  const modes = useMemo<Mode3[]>(
    () => (tanah ? modes3(sys) : [{ w: Math.sqrt(fnd.k / fnd.M), zeta: fnd.c / (2 * Math.sqrt(fnd.k * fnd.M)), phi: [0, 1, 0], kind: 'vertikal' }]),
    [sys, tanah, fnd],
  )
  const rpmMax = RPM_MAX[setup]
  const target = motorOn ? p.rpm : 0
  const bands = modes.map((m) => ({ rpm: wToRpm(m.w), color: MODE_COLOR[m.kind].fill, arc: MODE_COLOR[m.kind].arc, label: `${m.kind} ${Math.round(wToRpm(m.w))} rpm` }))
  // harmonik kedua mesin torak hanya vertikal → memicu mode vertikal, dan rocking bila poros tidak di tengah
  const bands2 =
    setup === 'torak'
      ? modes
          .filter((m) => m.kind === 'vertikal' || (tanah && Math.abs(p.ex) > 1e-9))
          .map((m) => ({ rpm: wToRpm(m.w) / 2, color: 'rgba(237,141,59,0.10)', arc: 'rgba(237,141,59,0.6)', label: `2ω = ω ${m.kind}` }))
      : []

  // kurva teori di-cache: 400 titik rpm, dihitung ulang hanya bila parameter berubah
  const table = useMemo(() => {
    const n = 400
    const hx: number[] = []
    const hz: number[] = []
    for (let i = 0; i <= n; i++) {
      const st = steady3(sys, mach, rpmToW((i / n) * rpmMax))
      hx.push(st.hx)
      hz.push(st.hz)
    }
    const look = (arr: number[]) => (rpm: number) => {
      const x = Math.min(n, Math.max(0, (rpm / rpmMax) * n))
      const i = Math.min(n - 1, Math.floor(x))
      return arr[i] + (arr[i + 1] - arr[i]) * (x - i)
    }
    return { hx: look(hx), hz: look(hz) }
  }, [sys, mach, rpmMax])

  const live = useRef({ setup, p, mach, sys, target, running, speed, rpmMax, bands, bands2, tanah, table })
  live.current = { setup, p, mach, sys, target, running, speed, rpmMax, bands, bands2, tanah, table }

  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const respRef = useRef<HTMLCanvasElement>(null)
  const sim = useRef<State3 & { t: number }>({ q: [0, 0, 0], v: [0, 0, 0], th: 0, w: 0, t: 0 })
  const hist = useRef<Sample[]>([])
  const histX = useRef<Sample[]>([])
  const histF = useRef<Sample[]>([])
  const trace = useRef<Trace>({ hx: [], hz: [] })
  const rev = useRef({ hx: 0, hz: 0, last: 0 })
  const orbit = useRef<[number, number][]>([])
  const orbitTh = useRef(0)
  const view = useRef(0)
  const plotScale = useRef(new PlotScale())
  const respLayout = useRef<RespLayout | null>(null)

  useEffect(() => onQuery(toQuery(setup, p)), [setup, p]) // eslint-disable-line react-hooks/exhaustive-deps
  // jenis pondasi berganti → keadaan lama tidak berlaku
  useEffect(() => {
    sim.current = { ...sim.current, q: [0, 0, 0], v: [0, 0, 0] }
    trace.current = { hx: [], hz: [] }
    orbit.current = []
    view.current = 0
  }, [p.fd])

  const clearTrace = () => {
    trace.current = { hx: [], hz: [] }
    orbit.current = []
  }

  const changeSetup = (s: Setup) => {
    setSetup(s)
    setP({ ...defaults(s), fd: p.fd, sk: p.sk })
    setMotorOn(false)
    sim.current = { q: [0, 0, 0], v: [0, 0, 0], th: 0, w: 0, t: 0 }
    clearTrace()
    hist.current = []
    histX.current = []
    histF.current = []
    view.current = 0
  }

  const start = () => {
    clearTrace()
    setMotorOn(true)
    setRunning(true)
  }
  const stop = () => {
    clearTrace()
    setMotorOn(false)
    setRunning(true)
  }
  /** Langsung pada putaran kerja dalam keadaan tunak (superposisi harmonik 1 dan 2). */
  const jump = () => {
    const w = rpmToW(p.rpm)
    const th = sim.current.th
    const st = steadyState3(sys, mach, w, th)
    sim.current = { ...sim.current, q: st.q, v: st.v, w }
    clearTrace()
    setMotorOn(true)
    setRunning(true)
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
      const wT = rpmToW(L.target)
      const rateW = rpmToW(L.p.rate)
      const winSim = Math.min(3, Math.max(0.08, (6 * 60) / Math.max(wToRpm(s.w), 60)))
      if (L.running) {
        let rem = dtReal * L.speed
        while (rem > 1e-12) {
          const h = Math.min(H, rem)
          const dw = wT - s.w
          const a = Math.abs(dw) > rateW * h ? Math.sign(dw) * rateW : 0
          const n = step3(L.sys, L.mach, s, a, h)
          const thPrev = s.th
          s.q = n.q
          s.v = n.v
          s.th = n.th
          s.w = a === 0 ? wT : Math.max(0, n.w)
          s.t += h
          rem -= h
          const [bx, bz] = bearing(L.sys, s.q)
          if (s.t - lastSample >= winSim / 400 || lastSample < 0) {
            hist.current.push({ t: s.t, u: bz })
            histX.current.push({ t: s.t, u: bx })
            histF.current.push({ t: s.t, u: machineForces(L.mach, s.th, s.w, 0)[1] / L.sys.kz })
            lastSample = s.t
            if (hist.current.length > 4000) {
              const cut = s.t - winSim * 1.3
              hist.current = hist.current.filter((x) => x.t >= cut)
              histX.current = histX.current.filter((x) => x.t >= cut)
              histF.current = histF.current.filter((x) => x.t >= cut)
            }
          }
          // orbit bantalan: satu putaran terakhir
          if (Math.abs(s.th - orbitTh.current) >= (2 * Math.PI) / ORBIT_N || orbit.current.length === 0) {
            orbitTh.current = s.th
            orbit.current.push([bx, bz])
            if (orbit.current.length > ORBIT_N + 1) orbit.current.shift()
          }
          // jejak amplitudo per putaran
          const r = rev.current
          r.hx = Math.max(r.hx, Math.abs(bx))
          r.hz = Math.max(r.hz, Math.abs(bz))
          if (Math.floor(s.th / (2 * Math.PI)) !== Math.floor(thPrev / (2 * Math.PI)) || s.t - r.last > 0.5) {
            const rpm = wToRpm(s.w)
            for (const [key, amp] of [
              ['hx', r.hx],
              ['hz', r.hz],
            ] as const) {
              const tr = trace.current[key]
              const prev = tr[tr.length - 1]
              if (prev && Math.abs(prev.rpm - rpm) <= L.rpmMax / 600) tr[tr.length - 1] = { rpm, amp }
              else tr.push({ rpm, amp })
              if (tr.length > 3000) tr.shift()
            }
            r.hx = 0
            r.hz = 0
            r.last = s.t
          }
        }
      }

      const rpmNow = wToRpm(s.w)
      const stNow = steady3(L.sys, L.mach, s.w)
      const stTgt = steady3(L.sys, L.mach, rpmToW(Math.max(L.p.rpm, 1)))
      const [F1t, F2t] = forceHarmonics(L.mach, Math.max(s.w, rpmToW(L.p.rpm)))
      const fRot = L.mach.kind === 'rotasi' ? F1t : L.mach.mRot * L.mach.r * Math.max(s.w, rpmToW(L.p.rpm)) ** 2
      const [bx, bz] = bearing(L.sys, s.q)
      // panggung
      const sc = stageRef.current
      if (sc) {
        const { w: cw, h: ch, ctx } = fitCanvas(sc)
        const amp = Math.max(stNow.hx, stNow.hz, stTgt.hx, stTgt.hz, Math.abs(bx), Math.abs(bz), 1e-7)
        const tg = targetScale(amp)
        if (L.p.sk > 0) view.current = L.p.sk * 1e6
        else view.current = view.current === 0 || tg < view.current ? tg : view.current + (tg - view.current) * 0.02
        const [Fx, Fz] = machineForces(L.mach, s.th, s.w, 0)
        drawStage(ctx, cw, ch, {
          setup: L.setup,
          fd: L.p.fd,
          x: s.q[0],
          z: s.q[1],
          psi: s.q[2],
          th: s.th,
          rpm: rpmNow,
          rpmTarget: L.p.rpm,
          rpmMax: L.rpmMax,
          bands: L.bands.map((b) => ({ rpm: b.rpm, color: b.arc })),
          bands2: L.bands2.map((b) => ({ rpm: b.rpm, color: b.arc })),
          fRel: [fRot > 0 ? Fx / (F1t + F2t) : 0, F1t + F2t > 0 ? Fz / (F1t + F2t) : 0],
          r: L.mach.r,
          l: L.mach.l,
          L: L.p.L,
          Hb: L.p.Hb,
          hs: L.p.hs,
          ex: L.p.ex,
          zc: L.sys.zc,
          scale: view.current,
          fixed: L.p.sk > 0,
          // simpangan terbesar yang digambar: bantalan, atau sudut blok akibat rocking
          ampMax: Math.max(stNow.hx, stNow.hz, Math.abs(bx), Math.abs(bz), stNow.psi * Math.max(L.p.L / 2, L.p.Hb + L.p.hs)),
          orbit: orbit.current,
          level: Math.min(1, stNow.v / 0.01),
        })
      }
      // grafik waktu
      const pc = plotRef.current
      if (pc) {
        const { w: cw, h: ch, ctx } = fitCanvas(pc)
        const extra = [{ samples: histF.current, color: C.red, dash: [5, 4], label: 'Fz(t)/kz' }]
        if (L.tanah) extra.unshift({ samples: histX.current, color: '#661465', dash: [], label: 'horizontal' })
        drawPlot(
          ctx,
          cw,
          ch,
          hist.current,
          {
            window: winSim,
            tNow: s.t,
            factor: 1e6,
            unit: 'µm',
            name: 'u',
            mainLabel: 'vertikal',
            peaks: [],
            showAmplitude: false,
            showPeriod: false,
            envelope: null,
            extra,
          },
          plotScale.current,
        )
      }
      // respons vs rpm
      const rc = respRef.current
      if (rc) {
        const { w: cw, h: ch, ctx } = fitCanvas(rc)
        const curves = [{ fn: L.table.hz, color: C.navy, label: 'vertikal di bantalan', trace: trace.current.hz }]
        if (L.tanah) curves.push({ fn: L.table.hx, color: '#661465', label: 'horizontal di bantalan', trace: trace.current.hx })
        respLayout.current = drawResponse(ctx, cw, ch, {
          curves,
          bands: L.bands,
          bands2: L.bands2,
          rpmMax: L.rpmMax,
          rpm: rpmNow,
          target: L.p.rpm,
          vLim: V_LIM,
        })
      }

      if (now - lastRead > 120) {
        lastRead = now
        const tx = trace.current.hx
        const tz = trace.current.hz
        setRead({ rpm: rpmNow, t: s.t, hx: tx.length ? tx[tx.length - 1].amp : null, hz: tz.length ? tz[tz.length - 1].amp : null })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const respDrag = useRef(false)
  const setRpmFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = respLayout.current
    if (!l) return
    const r = e.currentTarget.getBoundingClientRect()
    const rpm = Math.round(rpmAt(l, e.clientX - r.left) / 10) * 10
    setP((old) => (old.rpm === rpm ? old : { ...old, rpm }))
  }

  const set = (key: Exclude<keyof Params, 'fd'>) => (v: number) => setP((old) => ({ ...old, [key]: v }))
  const wOp = rpmToW(p.rpm)
  const op = steady3(sys, mach, wOp)
  const [F1, F2] = forceHarmonics(mach, wOp)
  const sev = severity(op.v * 1000)
  const warns: string[] = []
  for (const m of modes) {
    const b = wOp / m.w
    if (b >= 0.8 && b <= 1.25) warns.push(`Putaran kerja di zona resonansi mode ${m.kind} (±20%)!`)
    if (setup === 'torak' && m.kind === 'vertikal' && 2 * b >= 0.8 && 2 * b <= 1.25) warns.push('Harmonik kedua (2ω) di zona resonansi vertikal!')
  }
  const atOp = Math.abs(read.rpm - p.rpm) < 5
  const um = (v: number) => `${(v * 1e6).toFixed(v * 1e6 < 10 ? 2 : 1)} µm`
  const kN = (v: number) => `${(v / 1000).toFixed(v < 1e4 ? 2 : 1)} kN`

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Getaran &amp; Dinamika › <b>Room Machine Foundation</b>
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
            <canvas ref={stageRef} className="stage" style={{ height: 400 }} />
            <div className="stage-scale">
              <Segmented
                value={p.sk > 0 ? 'tetap' : 'auto'}
                options={[
                  { id: 'auto', label: 'Skala auto', title: 'Skala gambar mengikuti amplitudo saat ini' },
                  { id: 'tetap', label: 'Tetap', title: 'Kunci skala agar simpangan bisa dibandingkan langsung saat parameter diubah' },
                ]}
                onChange={(m) => setP((old) => ({ ...old, sk: m === 'auto' ? 0 : snapScale(view.current / 1e6) }))}
              />
              {p.sk > 0 && (
                <select className="speed" value={p.sk} onChange={(e) => setP((old) => ({ ...old, sk: Number(e.target.value) }))} aria-label="Skala simpangan">
                  {SCALES.map((v) => (
                    <option key={v} value={v}>
                      1 µm = {String(v).replace('.', ',')} px
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="stage-tip wide-only">Gerak lambat {speed}× — putaran & getaran digambar pada waktu simulasi.</div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Simpangan di bantalan terhadap waktu</b>
              <small style={{ color: 'var(--mute)' }}>t = {read.t.toFixed(3)} s (waktu simulasi)</small>
            </div>
            <canvas ref={plotRef} className="plot" />
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Amplitudo di bantalan terhadap putaran — klik Start untuk merekam jejak run-up</b>
              <small style={{ color: 'var(--mute)' }}>geser untuk memilih putaran kerja</small>
            </div>
            <canvas
              ref={respRef}
              className="plot"
              style={{ height: 320, cursor: 'ew-resize', touchAction: 'none' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                respDrag.current = true
                setRpmFromPointer(e)
              }}
              onPointerMove={(e) => respDrag.current && setRpmFromPointer(e)}
              onPointerUp={() => (respDrag.current = false)}
              onPointerCancel={() => (respDrag.current = false)}
            />
          </div>
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Operasi</h3>
            <div className="btn-row">
              <button className="btn primary sm" onClick={motorOn ? stop : start}>
                {motorOn ? '■ Stop (coast-down)' : '▶ Start (run-up)'}
              </button>
              <button className="btn ghost sm" onClick={jump} title="Langsung pada putaran kerja, keadaan tunak">
                Langsung tunak
              </button>
              <button className="btn ghost sm" onClick={() => setRunning(!running)}>
                {running ? '❚❚ Jeda' : '▶ Lanjut'}
              </button>
              <select className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Kecepatan">
                <option value={1}>1×</option>
                <option value={0.25}>0,25×</option>
                <option value={0.1}>0,1×</option>
                <option value={0.05}>0,05×</option>
                <option value={0.01}>0,01×</option>
              </select>
            </div>
            <Slider label="Putaran kerja" symbol="n" unit="rpm" value={p.rpm} {...RANGES.rpm} max={rpmMax} onChange={set('rpm')} hint={`f = ${(p.rpm / 60).toFixed(2)} Hz`} />
            <Slider label="Laju start/stop" symbol="ṅ" unit="rpm/s" value={p.rate} {...RANGES.rate} onChange={set('rate')} />
          </div>

          <div className="card">
            <h3>Mesin</h3>
            <Slider label="Massa mesin" symbol="m_mesin" unit="ton" value={p.Mm} {...RANGES.Mm} onChange={set('Mm')} />
            {setup === 'rotasi' ? (
              <Slider label="Ketidakseimbangan" symbol="m·e" unit="kg·mm" value={p.me} {...RANGES.me} onChange={set('me')} hint="mis. rotor 2 t dengan e = 0,15 mm → 300 kg·mm" />
            ) : (
              <>
                <Slider label="Massa bolak-balik" symbol="m_rec" unit="kg" value={p.mRec} {...RANGES.mRec} onChange={set('mRec')} hint="torak + ⅓ batang penghubung" />
                <Slider label="Massa berputar" symbol="m_rot" unit="kg" value={p.mRot} {...RANGES.mRot} onChange={set('mRot')} hint="engkol tak seimbang + ⅔ batang — juga memberi gaya horizontal" />
                <Slider label="Jari-jari engkol" symbol="r" unit="cm" value={p.r} {...RANGES.r} onChange={set('r')} />
                <Slider label="Rasio batang" symbol="l/r" unit="" value={p.lr} {...RANGES.lr} onChange={set('lr')} />
              </>
            )}
            {tanah && (
              <>
                <Slider label="Tinggi poros di atas blok" symbol="h_s" unit="m" value={p.hs} {...RANGES.hs} onChange={set('hs')} hint="lengan momen gaya horizontal → rocking" />
                <Slider label="Offset poros dari pusat blok" symbol="e_x" unit="m" value={p.ex} {...RANGES.ex} onChange={set('ex')} hint="gaya vertikal eksentris → rocking" />
              </>
            )}
          </div>

          <div className="card">
            <h3>Pondasi</h3>
            <div style={{ marginBottom: 8 }}>
              <Segmented value={p.fd} options={FNDS.map((f) => ({ id: f.id, label: f.label, title: f.hint }))} onChange={(v: FndKind) => setP({ ...p, fd: v })} />
            </div>
            {tanah ? (
              <>
                <Slider label="Panjang blok ⊥ poros" symbol="L" unit="m" value={p.L} {...RANGES.L} onChange={set('L')} hint="menentukan kekakuan rocking (∝ L³)" />
                <Slider label="Lebar blok ∥ poros" symbol="B" unit="m" value={p.B} {...RANGES.B} onChange={set('B')} />
                <Slider label="Tebal blok" symbol="H" unit="m" value={p.Hb} {...RANGES.Hb} onChange={set('Hb')} hint={`massa blok ${(sys.Mb / 1000).toFixed(1)} ton (beton 2,4 t/m³)`} />
                <Slider label="Modulus geser tanah" symbol="G" unit="MPa" value={p.G} {...RANGES.G} onChange={set('G')} hint="lempung lunak ≈ 10–20 · pasir padat ≈ 50–100" />
                <Slider label="Rasio Poisson" symbol="ν" unit="" value={p.nu} {...RANGES.nu} onChange={set('nu')} />
              </>
            ) : (
              <>
                <Slider label="Massa pelat meja" symbol="m_p" unit="ton" value={p.Mb} {...RANGES.Mb} onChange={set('Mb')} />
                <Slider label="Kekakuan vertikal" symbol="k" unit="MN/m" value={p.k} {...RANGES.k} onChange={set('k')} />
                <Slider label="Rasio redaman" symbol="ζ" unit="" value={p.z} {...RANGES.z} onChange={set('z')} />
              </>
            )}
          </div>

          <div className="card">
            <h3>Mode getar pondasi</h3>
            <table className="readout">
              <tbody>
                <tr>
                  <th>Mode</th>
                  <th>f (Hz)</th>
                  <th>rpm</th>
                  <th>ζ</th>
                </tr>
                {modes.map((m) => (
                  <tr key={m.kind}>
                    <th style={{ color: MODE_COLOR[m.kind].line }}>{m.kind}</th>
                    <td>{(m.w / (2 * Math.PI)).toFixed(2)}</td>
                    <td>{Math.round(wToRpm(m.w))}</td>
                    <td>{m.zeta.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tanah && (
              <p className="slider-hint" style={{ marginTop: 6 }}>
                CG {sys.zc.toFixed(2)} m di atas dasar · r₀ = {sys.r0.toFixed(2)} m · r₀ψ = {sys.r0p.toFixed(2)} m · Bz = {sys.Bz.toFixed(2)} · Bψ = {sys.Bp.toFixed(2)}. Mode
                geser–rocking terkopel karena CG berada di atas dasar.
              </p>
            )}
          </div>

          <div className="card">
            <h3>Hasil pada putaran kerja</h3>
            {warns.map((w) => (
              <p key={w} style={{ color: '#b5452f', fontWeight: 600, margin: '0 0 6px', fontSize: 13 }}>
                ⚠ {w}
              </p>
            ))}
            <table className="readout">
              <tbody>
                <tr>
                  <th>Gaya F₁ (ω)</th>
                  <td>{kN(F1)}</td>
                  <th>F₂ (2ω)</th>
                  <td>{setup === 'torak' ? kN(F2) : '—'}</td>
                </tr>
                <tr>
                  <th>Vertikal bantalan</th>
                  <td>{um(op.hz)}</td>
                  <th>terukur</th>
                  <td>{atOp && read.hz !== null ? um(read.hz) : '—'}</td>
                </tr>
                {tanah && (
                  <tr>
                    <th>Horizontal bantalan</th>
                    <td>{um(op.hx)}</td>
                    <th>terukur</th>
                    <td>{atOp && read.hx !== null ? um(read.hx) : '—'}</td>
                  </tr>
                )}
                {tanah && (
                  <tr>
                    <th>Rocking ψ</th>
                    <td>{(op.psi * 1e6).toFixed(1)} µrad</td>
                    <th>Geser dasar</th>
                    <td>{um(op.xb)}</td>
                  </tr>
                )}
                <tr>
                  <th>Kecepatan puncak</th>
                  <td>{(op.v * 1000).toFixed(2)} mm/s</td>
                  <th>Kategori</th>
                  <td style={{ color: sev.color }}>{sev.label}</td>
                </tr>
                <tr>
                  <th>Gaya vertikal ke {tanah ? 'tanah' : 'kolom'}</th>
                  <td>{kN(op.V)}</td>
                  <th>{tanah ? 'Geser ke tanah' : ''}</th>
                  <td>{tanah ? kN(op.H) : ''}</td>
                </tr>
                {tanah && (
                  <tr>
                    <th>Momen guling ke tanah</th>
                    <td colSpan={3}>{(op.Mo / 1000).toFixed(2)} kN·m</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="slider-hint" style={{ marginTop: 6 }}>
              {tanah
                ? 'Blok kaku 3 DOF (geser, vertikal, rocking), konstanta tanah Lysmer/Hall tak bergantung frekuensi, tanpa penanaman. '
                : 'Pondasi meja: hanya mode vertikal. '}
              Kategori dari kecepatan puncak bersifat indikatif — desain nyata memakai kriteria pabrikan / ISO 10816 / ACI 351.3R.
            </p>
          </div>
        </aside>
      </div>

      <Notes setup={setup} tanah={tanah} />
    </div>
  )
}

function Notes({ setup, tanah }: { setup: Setup; tanah: boolean }) {
  return (
    <div className="notes">
      <div className="card">
        <h3>Catatan konsep</h3>
        <ul>
          {setup === 'rotasi' ? (
            <li>
              <b>Mesin rotasi:</b> massa tak seimbang m·e berputar → gaya berputar m·e·ω²: komponen vertikal cos ωt dan horizontal sin ωt. Gaya naik
              dengan kuadrat putaran.
            </li>
          ) : (
            <li>
              <b>Mesin torak:</b> gaya vertikal ≈ (m_rec + m_rot)·r·ω²·cos ωt + m_rec·r·ω²·(r/l)·cos 2ωt, ditambah gaya horizontal m_rot·r·ω²·sin ωt
              dari engkol yang tak seimbang.
            </li>
          )}
          {tanah ? (
            <>
              <li>
                <b>Rocking:</b> gaya horizontal bekerja setinggi poros, jauh di atas dasar → momen guling. Bersama gaya vertikal yang eksentris, momen
                ini menggoyang blok. Geser dan rocking <b>terkopel</b> karena titik berat berada di atas bidang dasar, menghasilkan dua mode
                “geser–rocking”.
              </li>
              <li>
                <b>Tanah:</b> kz = 4Gr₀/(1−ν), kx = 32(1−ν)Gr₀/(7−8ν), kψ = 8Gr₀ψ³/(3(1−ν)). Redaman radiasi rocking (analog Hall) jauh lebih kecil
                daripada vertikal, sehingga resonansi rocking lebih tajam dan sering menentukan.
              </li>
              <li>
                Yang dinilai adalah getaran di <b>bantalan</b>: horizontal = x − h·ψ (terhadap CG), vertikal = z + e·ψ. Orbit oranye di panggung
                menunjukkan lintasan bantalan selama satu putaran.
              </li>
            </>
          ) : (
            <li>
              <b>Pondasi meja (table-top):</b> redaman struktur beton hanya ≈ 2%, sehingga resonansi sangat tajam. Di Room ini meja hanya dimodelkan
              arah vertikal.
            </li>
          )}
          <li>
            <b>Start & stop:</b> mesin yang bekerja di atas resonansi pasti melewati resonansi saat run-up dan coast-down. Laju start yang cepat membuat
            puncak lewat lebih kecil daripada amplitudo tunak resonansi.
          </li>
        </ul>
      </div>
      <div className="card">
        <h3>Coba ini</h3>
        <ol>
          <li>Klik Start: jejak run-up melewati beberapa puncak — satu untuk tiap mode yang terlewati.</li>
          {tanah && <li>Naikkan tinggi poros h_s: amplitudo horizontal naik dan mode geser–rocking 1 turun (lengan momen & inersia membesar).</li>}
          {tanah && <li>Perpanjang blok L (⊥ poros): kekakuan rocking naik ∝ L³ — cara paling efektif menjinakkan rocking.</li>}
          {tanah && <li>Geser offset e_x: gaya vertikal kini juga memicu rocking, orbit bantalan memiring.</li>}
          <li>Geser putaran kerja ke salah satu pita berwarna: muncul peringatan resonansi untuk mode tersebut.</li>
          {setup === 'torak' && <li>Cari putaran saat 2ω = ωn vertikal (pita oranye): pondasi bergetar dua kali per putaran engkol.</li>}
        </ol>
      </div>
    </div>
  )
}
