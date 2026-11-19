import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { drawPlot, PlotScale, type Sample } from '../../lab/plot'
import { C } from '../../lab/theme'
import { Check, Segmented, Slider } from '../../ui/controls'
import { betaAt, drawFreq, type FreqLayout, type Point } from './freq'
import { defaults, excite, parseQuery, RANGES, SETUPS, theory, toForced, toQuery, type Params, type Setup } from './model'
import { measure, rdPeak, step, steadyState, TR, wrap2pi } from './physics'
import { drawStage, targetScale } from './stage'

const WINDOW = 10 // detik pada grafik waktu
const H = 1 / 2000 // langkah integrasi (s)
const SAMPLE_DT = 1 / 120
const STEADY_TOL = 0.003 // selisih relatif puncak berturut-turut untuk dianggap tunak

interface Readout {
  t: number
  y: number
  A: number | null
  phi: number | null
  T: number | null
  steady: boolean
}

const EMPTY: Readout = { t: 0, y: 0, A: null, phi: null, T: null, steady: false }

const f3 = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '∞')
const deg = (r: number) => (r * 180) / Math.PI

/** Titik-titik β untuk sapuan otomatis: rata di 0,1–3 dan rapat di sekitar puncak. */
function sweepBetas(zeta: number, base: boolean) {
  const set = new Set<number>()
  for (let b = 0.1; b <= 3.0001; b += 0.1) set.add(Number(b.toFixed(3)))
  const bp = base ? 1 : rdPeak(zeta).beta
  if (bp > 0.05) for (const d of [-0.12, -0.06, -0.03, -0.015, 0, 0.015, 0.03, 0.06, 0.12]) set.add(Number((bp + d).toFixed(3)))
  if (base) set.add(Number(Math.SQRT2.toFixed(3)))
  return [...set].filter((b) => b > 0.02 && b <= 3).sort((a, b) => a - b)
}

export default function ResonanceRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [show, setShow] = useState({ phasor: true, ref: true, exc: true, theo: true, amp: true })
  const [read, setRead] = useState<Readout>(EMPTY)
  const [points, setPoints] = useState<Point[]>([])
  const [sweeping, setSweeping] = useState(false)

  const th = useMemo(() => theory(setup, p), [setup, p])
  const fd = useMemo(() => toForced(setup, p), [setup, p])
  const ex = excite(setup)

  const live = useRef({ setup, p, th, fd, running, speed, show, points })
  live.current = { setup, p, th, fd, running, speed, show, points }

  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const freqRef = useRef<HTMLCanvasElement>(null)
  const sim = useRef({ u: 0, v: init.setup === 'dasar' ? -init.params.ug * 2 * Math.PI * init.params.f : 0, psi: 0, t: 0 })
  const hist = useRef<Sample[]>([])
  const histE = useRef<Sample[]>([])
  const peaks = useRef<Sample[]>([])
  /** Pelacak puncak & tunak sejak parameter terakhir berubah. */
  const det = useRef({ prevY: 0, prevDy: 0, amps: [] as number[], phis: [] as number[], times: [] as number[], recorded: '' })
  const view = useRef(0)
  const plotScale = useRef(new PlotScale())
  const freqLayout = useRef<FreqLayout | null>(null)
  const sweepToken = useRef(0)

  // ---- aksi ----
  const clearDetector = () => {
    const d = det.current
    d.amps = []
    d.phis = []
    d.times = []
    d.recorded = ''
    peaks.current = []
  }

  const restart = (steady: boolean) => {
    const L = live.current
    const psi = 0
    // "dari diam" = massa diam secara mutlak; pada eksitasi dasar kecepatan relatifnya −u̇g(0) = −ug0·ω
    const st = steady ? steadyState(L.fd, psi) : { u: 0, v: L.setup === 'dasar' ? -L.p.ug * L.fd.w : 0 }
    sim.current = { u: st.u, v: st.v, psi, t: 0 }
    hist.current = []
    histE.current = []
    plotScale.current = new PlotScale()
    det.current.prevY = 0
    det.current.prevDy = 0
    clearDetector()
    setRunning(true)
  }

  const changeSetup = (s: Setup) => {
    sweepToken.current++
    setSweeping(false)
    setSetup(s)
    setPoints([])
    view.current = 0
  }

  // parameter berubah saat berjalan: keadaan mutlak massa tetap, transien baru dimulai
  const first = useRef(true)
  const prevExc = useRef({ ug: setup === 'dasar' ? p.ug : 0, w: fd.w })
  useEffect(() => {
    onQuery(toQuery(setup, p))
    const ugNew = setup === 'dasar' ? p.ug : 0
    const old = prevExc.current
    if (!first.current && (old.ug || ugNew)) {
      // jaga posisi & kecepatan mutlak massa kontinu saat ug0 atau ω tanah berubah
      const s = sim.current
      const c = Math.cos(s.psi)
      const sn = Math.sin(s.psi)
      s.u += (old.ug - ugNew) * sn
      s.v += (old.ug * old.w - ugNew * fd.w) * c
    }
    prevExc.current = { ug: ugNew, w: fd.w }
    if (first.current) {
      first.current = false
      return
    }
    clearDetector()
  }, [setup, p]) // eslint-disable-line react-hooks/exhaustive-deps

  // setup berganti → mulai lagi dari diam (setelah render, supaya live.current sudah setup baru)
  const firstSetup = useRef(true)
  useEffect(() => {
    if (firstSetup.current) {
      firstSetup.current = false
      return
    }
    restart(false)
  }, [setup]) // eslint-disable-line react-hooks/exhaustive-deps

  // ζ berubah → sapuan yang sedang berjalan dibatalkan
  useEffect(() => {
    sweepToken.current++
    setSweeping(false)
  }, [p.z, setup])

  const sweep = () => {
    const token = ++sweepToken.current
    const z = p.z
    const e = ex
    const list = sweepBetas(z, e === 'base')
    setSweeping(true)
    let i = 0
    const next = () => {
      if (token !== sweepToken.current) return
      const t0 = performance.now()
      const batch: Point[] = []
      while (i < list.length && performance.now() - t0 < 25) {
        const m = measure(list[i], z, e)
        if (m) batch.push({ ...m, zeta: z })
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
      const fdl = L.fd
      const base = L.setup === 'dasar'
      const ug0 = base ? L.p.ug : 0
      const yOf = (u: number, psi: number) => (base ? u + ug0 * Math.sin(psi) : u)
      const d = det.current
      if (L.running) {
        let rem = dtReal * L.speed
        while (rem > 1e-12) {
          const h = Math.min(H, rem)
          const n = step(fdl, s, h)
          const y = yOf(n.u, n.psi)
          const dy = y - d.prevY
          if (d.prevDy > 0 && dy <= 0 && d.prevY > 1e-6) {
            // puncak besaran y pada keadaan sebelumnya (s)
            peaks.current.push({ t: s.t, u: d.prevY })
            d.amps.push(d.prevY)
            d.phis.push(wrap2pi(s.psi - Math.PI / 2))
            d.times.push(s.t)
            if (d.amps.length > 8) {
              d.amps.shift()
              d.phis.shift()
              d.times.shift()
            }
          }
          d.prevDy = dy
          d.prevY = y
          s.u = n.u
          s.v = n.v
          s.psi = n.psi
          s.t += h
          rem -= h
        }
        if (s.t - lastSample >= SAMPLE_DT || lastSample < 0 || s.t < lastSample) {
          hist.current.push({ t: s.t, u: yOf(s.u, s.psi) })
          histE.current.push({ t: s.t, u: (base ? ug0 : fdl.p0 / fdl.k) * Math.sin(s.psi) })
          lastSample = s.t
          const cut = s.t - WINDOW - 1
          if (hist.current[0] && hist.current[0].t < cut) {
            hist.current = hist.current.filter((x) => x.t >= cut)
            histE.current = histE.current.filter((x) => x.t >= cut)
            peaks.current = peaks.current.filter((x) => x.t >= cut)
          }
        }
      }

      // status tunak + catat titik terukur
      const a = d.amps
      const k = a.length
      const steady =
        k >= 4 && [a[k - 2], a[k - 3], a[k - 4]].every((b) => Math.abs(a[k - 1] - b) <= STEADY_TOL * Math.abs(a[k - 1]))
      if (steady) {
        const key = `${L.th.beta.toFixed(4)}|${L.p.z}|${L.setup}`
        if (d.recorded !== key) {
          d.recorded = key
          let ph = d.phis[k - 1]
          if (ph > 1.5 * Math.PI) ph -= 2 * Math.PI
          const pt: Point = { beta: L.th.beta, ratio: a[k - 1] / L.th.ref, phase: ph, zeta: L.p.z }
          if (L.th.beta <= 3) setPoints((old) => mergePoints(old, [pt]))
        }
      }

      // panggung
      const sc = stageRef.current
      if (sc) {
        const { w, h, ctx } = fitCanvas(sc)
        const y = yOf(s.u, s.psi)
        // ζ = 0: tidak pernah tunak, amplitudo tunak teori tidak dipakai untuk skala
        const amp = Math.max(L.p.z > 0 && Number.isFinite(L.th.amp) ? L.th.amp : 0, Math.abs(y), Math.abs(s.u), L.th.ref, base ? ug0 : 0)
        const target = targetScale(w, amp, ug0)
        view.current = view.current === 0 ? target : target < view.current ? target : view.current + (target - view.current) * 0.03
        drawStage(ctx, w, h, {
          setup: L.setup,
          u: s.u,
          ug: ug0 * Math.sin(s.psi),
          psi: s.psi,
          phi: L.th.phi,
          ratio: L.th.ratio,
          scale: view.current,
          showPhasor: L.show.phasor,
        })
      }
      // grafik waktu
      const pc = plotRef.current
      if (pc) {
        const { w, h, ctx } = fitCanvas(pc)
        drawPlot(
          ctx,
          w,
          h,
          hist.current,
          {
            window: WINDOW,
            tNow: s.t,
            factor: 100,
            unit: 'cm',
            name: base ? 'x' : 'u',
            mainLabel: base ? 'x total massa' : 'u massa',
            peaks: L.show.amp ? peaks.current : [],
            showAmplitude: L.show.amp,
            showPeriod: L.show.amp,
            envelope: null,
            extra: L.show.exc ? [{ samples: histE.current, color: C.orange, dash: [6, 4], label: base ? 'ug tanah' : 'p(t)/k' }] : [],
            hlines: L.show.theo && L.p.z > 0 && Number.isFinite(L.th.amp) ? [{ v: L.th.amp, color: C.steel, label: `±${base ? 'x₀' : 'u₀'} teori tunak` }] : [],
          },
          plotScale.current,
        )
      }
      // grafik respons frekuensi
      const fc = freqRef.current
      if (fc) {
        const { w, h, ctx } = fitCanvas(fc)
        freqLayout.current = drawFreq(ctx, w, h, {
          excite: excite(L.setup),
          zeta: L.p.z,
          beta: L.th.beta,
          points: L.points,
          showRef: L.show.ref,
        })
      }

      if (now - lastRead > 120) {
        lastRead = now
        setRead({
          t: s.t,
          y: yOf(s.u, s.psi),
          A: k ? a[k - 1] : null,
          phi: k ? (d.phis[k - 1] > 1.5 * Math.PI ? d.phis[k - 1] - 2 * Math.PI : d.phis[k - 1]) : null,
          T: k >= 2 ? d.times[k - 1] - d.times[k - 2] : null,
          steady,
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

  // ---- pointer di grafik respons frekuensi: geser untuk memilih ω ----
  const freqDrag = useRef(false)
  const setBetaFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = freqLayout.current
    if (!l) return
    const r = e.currentTarget.getBoundingClientRect()
    const b = betaAt(l, e.clientX - r.left)
    const fHz = Math.min(RANGES.f.max, Math.max(RANGES.f.min, Math.round(b * th.fn * 100) / 100))
    setP((old) => (old.f === fHz ? old : { ...old, f: fHz }))
  }

  const set = (key: keyof Params) => (v: number) => setP((old) => ({ ...old, [key]: v }))
  const base = setup === 'dasar'
  const sym = base ? 'TR' : 'Rd'
  const pk = rdPeak(p.z)
  const fPeak = pk.beta * th.fn
  const fmtCm = (v: number) => `${(v * 100).toFixed(2)} cm`
  const rMeas = read.A !== null ? read.A / th.ref : null
  const setF = (fHz: number) => setP({ ...p, f: Math.min(RANGES.f.max, Math.max(RANGES.f.min, Math.round(fHz * 100) / 100)) })

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Getaran &amp; Dinamika › <b>Room Resonance</b>
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
            <canvas ref={stageRef} className="stage" style={{ height: 330 }} />
            <div className="stage-tip">Geser titik oranye di grafik respons frekuensi untuk mengubah ω.</div>
            <div className="stage-live">
              <span>t = {read.t.toFixed(2)} s</span>
              <span>
                {base ? 'x' : 'u'} = {fmtCm(read.y)}
              </span>
              <span style={{ color: read.steady ? 'var(--green)' : 'var(--orange)' }}>{read.steady ? 'tunak ✓' : 'transien…'}</span>
            </div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Respons terhadap waktu</b>
              <div className="plot-opts">
                <Check label={base ? 'Gerak tanah' : 'Gaya p/k'} checked={show.exc} onChange={(v) => setShow({ ...show, exc: v })} />
                <Check label="Amplitudo tunak teori" checked={show.theo} onChange={(v) => setShow({ ...show, theo: v })} />
                <Check label="Puncak & periode" checked={show.amp} onChange={(v) => setShow({ ...show, amp: v })} />
              </div>
            </div>
            <canvas ref={plotRef} className="plot" />
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Respons frekuensi — {base ? 'transmisibilitas TR dan fase x terhadap ug' : 'faktor amplifikasi dinamis Rd dan sudut fase φ'}</b>
              <div className="plot-opts">
                <Check label="Kurva ζ lain" checked={show.ref} onChange={(v) => setShow({ ...show, ref: v })} />
              </div>
            </div>
            <canvas
              ref={freqRef}
              className="plot"
              style={{ height: 320, cursor: 'ew-resize', touchAction: 'none' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                freqDrag.current = true
                setBetaFromPointer(e)
              }}
              onPointerMove={(e) => freqDrag.current && setBetaFromPointer(e)}
              onPointerUp={() => (freqDrag.current = false)}
              onPointerCancel={() => (freqDrag.current = false)}
            />
          </div>
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Struktur</h3>
            <Slider label="Massa" symbol="m" unit="kg" value={p.m} {...RANGES.m} onChange={set('m')} />
            <Slider label="Kekakuan" symbol="k" unit="N/m" value={p.k} {...RANGES.k} onChange={set('k')} hint={`fn = ${th.fn.toFixed(3)} Hz`} />
            <Slider label="Rasio redaman" symbol="ζ" unit="" value={p.z} {...RANGES.z} onChange={set('z')} hint={`c = ${th.c.toFixed(2)} N·s/m`} />
            <div className="btn-row">
              <button className="btn ghost sm" onClick={() => setP({ ...p, z: 0.02 })} title="Tipikal gedung baja">
                ζ = 2%
              </button>
              <button className="btn ghost sm" onClick={() => setP({ ...p, z: 0.05 })} title="Tipikal gedung beton">
                ζ = 5%
              </button>
              <button className="btn ghost sm" onClick={() => setP({ ...p, z: 0 })}>
                ζ = 0
              </button>
              <button className="btn ghost sm" onClick={() => setP(defaults())}>
                Bawaan
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Eksitasi</h3>
            <Slider label="Frekuensi" symbol="f" unit="Hz" value={p.f} {...RANGES.f} onChange={set('f')} hint={`β = ω/ωn = ${th.beta.toFixed(3)}`} />
            {base ? (
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
            ) : (
              <Slider label="Amplitudo gaya" symbol="p₀" unit="N" value={p.p0} {...RANGES.p0} onChange={set('p0')} hint={`ust = p₀/k = ${fmtCm(th.ref)}`} />
            )}
            <div className="btn-row">
              <button className="btn ghost sm" onClick={() => setF(th.fn)} title="ω = ωn (β = 1)">
                f = fn
              </button>
              {!base && pk.beta > 0 && (
                <button className="btn ghost sm" onClick={() => setF(fPeak)} title="Frekuensi puncak Rd: β = √(1 − 2ζ²)">
                  f = puncak
                </button>
              )}
              {base && (
                <button className="btn ghost sm" onClick={() => setF(Math.SQRT2 * th.fn)} title="Batas isolasi: TR = 1">
                  β = √2
                </button>
              )}
              <button className="btn ghost sm" onClick={() => setF(0.5 * th.fn)}>
                β = 0,5
              </button>
              <button className="btn ghost sm" onClick={() => setF(2 * th.fn)}>
                β = 2
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Kontrol</h3>
            <div className="btn-row">
              <button className="btn primary sm" onClick={() => setRunning(!running)}>
                {running ? '❚❚ Jeda' : '▶ Jalan'}
              </button>
              <button className="btn ghost sm" onClick={() => restart(false)} title="Massa diam saat eksitasi mulai: terlihat transien">
                ⟲ Dari diam
              </button>
              <button className="btn ghost sm" onClick={() => restart(true)} title="Mulai langsung pada keadaan tunak (tanpa transien)">
                Mulai tunak
              </button>
              <select className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Kecepatan">
                <option value={1}>1×</option>
                <option value={0.5}>0,5×</option>
                <option value={0.25}>0,25×</option>
                <option value={0.1}>0,1×</option>
              </select>
            </div>
            <div className="btn-row">
              <button
                className="btn ghost sm"
                disabled={sweeping || p.z === 0}
                onClick={sweep}
                title={p.z === 0 ? 'Tanpa redaman respons tidak pernah tunak' : 'Simulasikan banyak β sampai tunak dan plot hasilnya'}
              >
                {sweeping ? 'Menyapu…' : 'Sapu frekuensi'}
              </button>
              <button className="btn ghost sm" onClick={() => setPoints([])} disabled={!points.length}>
                Hapus titik ({points.length})
              </button>
              <Check label="Fasor" checked={show.phasor} onChange={(v) => setShow({ ...show, phasor: v })} />
            </div>
          </div>

          <div className="card">
            <h3>Teori vs terukur</h3>
            <table className="readout">
              <tbody>
                <tr>
                  <th>fn = ωn/2π</th>
                  <td>{f3(th.fn)} Hz</td>
                  <th>Status</th>
                  <td>{read.steady ? 'tunak' : 'transien'}</td>
                </tr>
                <tr>
                  <th>β = ω/ωn</th>
                  <td>{f3(th.beta)}</td>
                  <th>T respons</th>
                  <td>{read.T ? `${f3(read.T)} s` : '—'}</td>
                </tr>
                <tr>
                  <th>{base ? 'ug₀' : 'ust = p₀/k'}</th>
                  <td>{fmtCm(th.ref)}</td>
                  <th>T eksitasi</th>
                  <td>{f3(1 / p.f)} s</td>
                </tr>
                <tr>
                  <th>{sym} teori</th>
                  <td>{f3(th.ratio)}</td>
                  <th>{sym} terukur</th>
                  <td>{rMeas !== null ? f3(rMeas) : '—'}</td>
                </tr>
                <tr>
                  <th>{base ? 'x₀' : 'u₀'} = {base ? 'ug₀·TR' : 'ust·Rd'}</th>
                  <td>{Number.isFinite(th.amp) ? fmtCm(th.amp) : '∞'}</td>
                  <th>A terukur</th>
                  <td>{read.A !== null ? fmtCm(read.A) : '—'}</td>
                </tr>
                <tr>
                  <th>φ teori</th>
                  <td>{deg(th.phi).toFixed(1)}°</td>
                  <th>φ terukur</th>
                  <td>{read.phi !== null ? `${deg(read.phi).toFixed(1)}°` : '—'}</td>
                </tr>
                <tr>
                  <th>{base ? 'u₀ relatif (pegas)' : 'Gaya ke tumpuan'}</th>
                  <td>{base ? fmtCm(th.uRel) : `${f3(p.p0 * TR(th.beta, p.z), 2)} N`}</td>
                  <th>{base ? 'f puncak' : 'Rd maks'}</th>
                  <td>{base ? `≈ ${f3(th.fn)} Hz` : pk.beta > 0 ? `${f3(pk.value, 2)} @ ${f3(fPeak)} Hz` : '1 (β = 0)'}</td>
                </tr>
              </tbody>
            </table>
            <p className="slider-hint" style={{ marginTop: 6 }}>
              Nilai terukur dibaca dari puncak grafik. Titik hijau di grafik respons frekuensi tercatat otomatis setiap kali respons sudah tunak.
            </p>
          </div>
        </aside>
      </div>

      <Notes setup={setup} p={p} th={th} />
    </div>
  )
}

function mergePoints(old: Point[], add: Point[]) {
  const out = old.filter((o) => !add.some((a) => Math.abs(a.beta - o.beta) < 0.004 && a.zeta === o.zeta))
  return [...out, ...add].slice(-400)
}

function Notes({ setup, p, th }: { setup: Setup; p: Params; th: ReturnType<typeof theory> }) {
  const base = setup === 'dasar'
  const pk = rdPeak(p.z)
  return (
    <div className="notes">
      <div className="card">
        <h3>Catatan konsep</h3>
        {base ? (
          <ul>
            <li>
              Tanah bergerak <code>ug = ug₀·sin ωt</code>. Dalam simpangan relatif u, persamaannya <code>m·ü + c·u̇ + k·u = −m·üg</code>{' '}
              — gempa “terasa” sebagai gaya inersia m·ω²·ug₀ = {(p.m * th.w * th.w * p.ug).toFixed(2)} N.
            </li>
            <li>
              <b>Transmisibilitas</b> TR = x₀/ug₀ = √(1 + (2ζβ)²) / √((1 − β²)² + (2ζβ)²) = <b>{th.ratio.toFixed(3)}</b>. Angka yang sama
              menyatakan rasio gaya yang diteruskan ke tumpuan pada setup Gaya Harmonik.
            </li>
            <li>
              <b>Isolasi getaran:</b> semua kurva TR melewati 1 di β = √2. Di atas √2 massa bergerak lebih kecil daripada tanah — prinsip
              isolasi dasar (base isolation): buat struktur “lunak” (fn kecil) agar β gempa besar.
            </li>
            <li>
              Di daerah isolasi, redaman yang lebih besar justru <b>menaikkan</b> TR. Redaman hanya menolong di sekitar resonansi.
            </li>
          </ul>
        ) : (
          <ul>
            <li>
              Persamaan gerak: <code>m·ü + c·u̇ + k·u = p₀·sin ωt</code>. Respons = <b>transien</b> (getaran bebas pada ωd, meluruh e^(−ζωn t))
              + <b>tunak</b> u₀·sin(ωt − φ) pada frekuensi gaya.
            </li>
            <li>
              <b>Faktor amplifikasi dinamis</b> Rd = u₀/ust = 1 / √((1 − β²)² + (2ζβ)²) = <b>{th.ratio.toFixed(3)}</b>, dengan ust = p₀/k =
              lendutan bila gaya diberikan perlahan (statis).
            </li>
            <li>
              <b>Tiga daerah:</b> β ≪ 1 dikendalikan kekakuan (Rd ≈ 1, φ ≈ 0°); β ≈ 1 dikendalikan redaman (Rd ≈ 1/(2ζ), φ = 90°); β ≫ 1
              dikendalikan massa (Rd ≈ 1/β², φ → 180°, massa bergerak berlawanan dengan gaya).
            </li>
            <li>
              Puncak Rd terjadi di β = √(1 − 2ζ²) {pk.beta > 0 ? `= ${pk.beta.toFixed(3)}` : '(tidak ada untuk ζ ≥ 0,707)'}, sedikit di bawah ωn,
              dengan Rd maks = 1/(2ζ√(1 − ζ²)) {Number.isFinite(pk.value) ? `= ${pk.value.toFixed(2)}` : '= ∞'}.
            </li>
            <li>
              Tanpa redaman (ζ = 0) di β = 1 amplitudo tumbuh linear tanpa batas: u = (ust/2)·(sin ωn t − ωn t·cos ωn t).
            </li>
          </ul>
        )}
      </div>
      <div className="card">
        <h3>Coba ini</h3>
        <ol>
          <li>Klik “⟲ Dari diam” pada β = 0,8: perhatikan pukulan (beat) di awal — campuran getaran bebas dan paksa — yang pelan-pelan hilang.</li>
          <li>Klik “f = fn”. Pada fasor, simpangan tertinggal tepat 90° dari {base ? 'tanah' : 'gaya'}.</li>
          <li>Atur ζ = 0 lalu “f = fn”, “⟲ Dari diam”: amplitudo terus membesar. Inilah alasan struktur butuh redaman.</li>
          <li>Klik “Sapu frekuensi”, lalu ubah ζ dan sapu lagi. Titik hijau (simulasi) jatuh tepat di kurva rumus.</li>
          <li>Ubah m atau k: fn bergeser, tetapi titik-titik terukur tetap di kurva yang sama — respons hanya bergantung pada β dan ζ.</li>
          {!base && <li>Dengan ζ = 0,02, cari dua β tempat Rd = Rd maks/√2. Selisihnya ≈ 2ζ (metode setengah daya untuk mengukur redaman).</li>}
          {base && <li>Geser β ke 2 atau 3: massa hampir diam sementara meja bergoyang — inilah isolasi dasar.</li>}
        </ol>
      </div>
    </div>
  )
}
