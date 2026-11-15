import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { drawPlot, PlotScale, type Sample } from '../../lab/plot'
import { dampingKind, energy, modal, rk4, type Sdof } from '../../lab/sdof'
import { Check, Segmented, Slider } from '../../ui/controls'
import {
  defaults,
  display,
  dragLimits,
  inertia,
  isVertical,
  parseQuery,
  ranges,
  SETUPS,
  toQuery,
  toSdof,
  units,
  type Params,
  type Setup,
} from './model'
import { drawStage, edgeOf, hitTest, pointerCoord, qFromEdge, targetScale, type Layout } from './stage'

const WINDOW = 10 // detik pada grafik
const H = 1 / 2000 // langkah integrasi (s)
const SAMPLE_DT = 1 / 120

interface Readout {
  T: number | null
  A: number | null
  cycles: number
  ek: number
  ep: number
  ed: number
  e0: number
  u: number
  v: number
  t: number
}

const EMPTY: Readout = { T: null, A: null, cycles: 0, ek: 0, ep: 0, ed: 0, e0: 0, u: 0, v: 0, t: 0 }

const f = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '∞')

/** Amplitudo sesaat dari (u, v) untuk sistem kurang redam — dipakai sebagai A₀ selubung. */
function amplitudeOf(sd: Sdof, u: number, v: number) {
  const m = modal(sd)
  if (m.zeta >= 1) return 0
  return Math.hypot(u, (v + m.zeta * m.wn * u) / m.wd)
}

export default function SpringRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [show, setShow] = useState({ amp: true, period: true, env: true, forces: true })
  const [read, setRead] = useState<Readout>(EMPTY)
  const [grabbing, setGrabbing] = useState(false)

  const sd = useMemo(() => toSdof(setup, p), [setup, p])
  const md = useMemo(() => modal(sd), [sd])
  const disp = display(setup)
  const u8 = units(setup)
  const rg = ranges(setup)

  const live = useRef({ setup, p, sd, running, speed, show })
  live.current = { setup, p, sd, running, speed, show }

  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const sim = useRef({ q: md.qeq, v: 0, t: 0 })
  const hist = useRef<Sample[]>([])
  const peaks = useRef<Sample[]>([])
  const env = useRef({ t0: 0, a0: 0, e0: 0 })
  const drag = useRef<{ off: number; last: number } | null>(null)
  const layout = useRef<Layout | null>(null)
  const view = useRef(0)
  const plotScale = useRef(new PlotScale())

  // ---- aksi ----
  const markRelease = () => {
    const s = sim.current
    const sdl = live.current.sd
    const u = s.q - sdl.F / sdl.K
    const e = energy(sdl, s)
    env.current = { t0: s.t, a0: amplitudeOf(sdl, u, s.v), e0: e.ek + e.ep }
    peaks.current = []
  }

  const setState = (q: number, v: number) => {
    sim.current.q = q
    sim.current.v = v
    markRelease()
    setRunning(true)
  }

  const reset = (sdl: Sdof = live.current.sd) => {
    sim.current = { q: sdl.F / sdl.K, v: 0, t: 0 }
    hist.current = []
    peaks.current = []
    env.current = { t0: 0, a0: 0, e0: 0 }
    plotScale.current = new PlotScale()
  }

  const changeSetup = (s: Setup) => {
    const np = defaults(s)
    setSetup(s)
    setP(np)
    view.current = 0
    reset(toSdof(s, np))
    setRunning(true)
  }

  // parameter berubah saat berjalan: posisi mutlak tetap, kesetimbangan bergeser (fisis)
  const first = useRef(true)
  useEffect(() => {
    onQuery(toQuery(setup, p))
    if (first.current) {
      first.current = false
      return
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
      const sdl = L.sd
      const qeq = sdl.F / sdl.K
      if (L.running || drag.current) {
        let rem = dtReal * L.speed
        if (drag.current) {
          s.t += rem
          s.v = 0
        } else {
          while (rem > 1e-12) {
            const h = Math.min(H, rem)
            const prevV = s.v
            const n = rk4(sdl, s, h)
            s.q = n.q
            s.v = n.v
            s.t += h
            rem -= h
            if (prevV > 0 && s.v <= 0) {
              const u = s.q - qeq
              if (u > 1e-4) peaks.current.push({ t: s.t, u })
            }
          }
        }
        if (s.t - lastSample >= SAMPLE_DT || lastSample < 0 || s.t < lastSample) {
          hist.current.push({ t: s.t, u: s.q - qeq })
          lastSample = s.t
          const cut = s.t - WINDOW - 1
          if (hist.current.length > 3000 || (hist.current[0] && hist.current[0].t < cut)) {
            hist.current = hist.current.filter((x) => x.t >= cut)
            peaks.current = peaks.current.filter((x) => x.t >= cut - WINDOW)
          }
        }
      }

      // stage
      const sc = stageRef.current
      if (sc) {
        const { w, h, ctx } = fitCanvas(sc)
        const target = targetScale(L.setup, w, h, L.p, qeq, s.q)
        view.current = view.current === 0 ? target : view.current + (target - view.current) * 0.12
        layout.current = drawStage(ctx, w, h, L.setup, L.p, s.q, view.current, { forces: L.show.forces, qeq })
      }
      // grafik
      const pc = plotRef.current
      if (pc) {
        const { w, h, ctx } = fitCanvas(pc)
        const d = display(L.setup)
        const m = modal(sdl)
        drawPlot(
          ctx,
          w,
          h,
          hist.current,
          {
            window: WINDOW,
            tNow: s.t,
            factor: d.factor,
            unit: d.unit,
            name: d.name,
            peaks: peaks.current,
            showAmplitude: L.show.amp,
            showPeriod: L.show.period,
            envelope: L.show.env && m.zeta > 0 && m.zeta < 1 ? { t0: env.current.t0, a0: env.current.a0, decay: m.zeta * m.wn } : null,
          },
          plotScale.current,
        )
      }

      if (now - lastRead > 100) {
        lastRead = now
        const pk = peaks.current
        const e = energy(sdl, s)
        const e0 = Math.max(env.current.e0, e.ek + e.ep)
        setRead({
          T: pk.length >= 2 ? pk[pk.length - 1].t - pk[pk.length - 2].t : null,
          A: pk.length ? pk[pk.length - 1].u : null,
          cycles: Math.max(0, pk.length - 1),
          ek: e.ek,
          ep: e.ep,
          ed: Math.max(0, env.current.e0 - e.ek - e.ep),
          e0,
          u: s.q - qeq,
          v: s.v,
          t: s.t,
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
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    if (!hitTest(l, x, y)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const c = pointerCoord(l, x, y)
    drag.current = l.setup === 'rotasi' ? { off: 0, last: c } : { off: c - edgeOf(l, sim.current.q), last: c }
    sim.current.v = 0
    setGrabbing(true)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    const d = drag.current
    if (!d) {
      e.currentTarget.style.cursor = hitTest(l, x, y) ? 'grab' : 'default'
      return
    }
    const c = pointerCoord(l, x, y)
    let q: number
    if (l.setup === 'rotasi') {
      let da = c - d.last
      if (da > Math.PI) da -= 2 * Math.PI
      if (da < -Math.PI) da += 2 * Math.PI
      d.last = c
      q = sim.current.q + da
    } else {
      q = qFromEdge(l, c - d.off)
    }
    const sdl = live.current.sd
    const [lo, hi] = dragLimits(live.current.setup, sdl.F / sdl.K)
    sim.current.q = Math.min(hi, Math.max(lo, q))
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setGrabbing(false)
    sim.current.v = 0
    markRelease()
    setRunning(true)
  }

  const set = (key: keyof Params) => (v: number) => setP((old) => ({ ...old, [key]: v }))
  const nudge = setup === 'rotasi' ? Math.PI / 6 : 0.05
  const kick = setup === 'rotasi' ? 3 : 0.5
  const kind = dampingKind(md.zeta)
  const kindLabel = { none: 'tanpa redaman', under: 'kurang redam', critical: 'redaman kritis', over: 'lewat redam' }[kind]
  const eMax = Math.max(read.e0, read.ek + read.ep + read.ed, 1e-12)
  const vert = isVertical(setup)
  const fmtU = (v: number) => `${(v * disp.factor).toFixed(disp.unit === '°' ? 1 : 2)} ${disp.unit}`

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Getaran &amp; Dinamika › <b>Room Spring</b>
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
              {setup === 'rotasi' ? 'Putar piringan dengan mouse/jari, lalu lepaskan.' : 'Tarik atau tekan massa dengan mouse/jari, lalu lepaskan.'}
            </div>
            <div className="stage-live">
              <span>t = {read.t.toFixed(2)} s</span>
              <span>
                {disp.name} = {fmtU(read.u)}
              </span>
              <span>
                v = {read.v.toFixed(3)} {setup === 'rotasi' ? 'rad/s' : 'm/s'}
              </span>
            </div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Grafik simpangan terhadap waktu</b>
              <div className="plot-opts">
                <Check label="Amplitudo" checked={show.amp} onChange={(v) => setShow({ ...show, amp: v })} />
                <Check label="Periode" checked={show.period} onChange={(v) => setShow({ ...show, period: v })} />
                <Check label="Selubung redaman" checked={show.env} onChange={(v) => setShow({ ...show, env: v })} />
              </div>
            </div>
            <canvas ref={plotRef} className="plot" />
          </div>
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Parameter</h3>
            <Slider label={setup === 'rotasi' ? 'Massa piringan' : 'Massa'} symbol="m" unit={u8.m} value={p.m} {...rg.m} onChange={set('m')} />
            <Slider
              label={setup === 'rotasi' ? 'Kekakuan rotasi' : 'Kekakuan pegas'}
              symbol={setup === 'rotasi' ? 'kθ' : 'k'}
              unit={u8.k}
              value={p.k}
              {...rg.k}
              onChange={set('k')}
            />
            <Slider
              label="Redaman"
              symbol={setup === 'rotasi' ? 'cθ' : 'c'}
              unit={u8.c}
              value={p.c}
              {...rg.c}
              onChange={set('c')}
              hint={`c kritis = ${md.cCrit.toFixed(2)} ${u8.c}`}
            />
            {vert && <Slider label="Gravitasi" symbol="g" unit="m/s²" value={p.g} {...rg.g} onChange={set('g')} hint="Bumi 9,81 · Bulan 1,62 · Mars 3,71" />}
            <div className="btn-row">
              <button className="btn ghost sm" onClick={() => setP({ ...p, c: Number(md.cCrit.toFixed(3)) })}>
                c = kritis
              </button>
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
              <button className="btn ghost sm" onClick={() => reset()}>
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
              {vert && p.g > 0 && (
                <button className="btn ghost sm" onClick={() => setState(0, 0)} title="Massa dilepas saat pegas belum berubah panjang">
                  Lepas dari panjang bebas
                </button>
              )}
              <button className="btn ghost sm" onClick={() => setState(md.qeq + nudge, 0)}>
                Simpangkan {setup === 'rotasi' ? '30°' : '5 cm'}
              </button>
              <button
                className="btn ghost sm"
                onClick={() => {
                  sim.current.v += kick
                  markRelease()
                  setRunning(true)
                }}
                title="Beri kecepatan awal (impuls)"
              >
                Ketuk
              </button>
              {setup !== 'rotasi' && <Check label="Panah gaya" checked={show.forces} onChange={(v) => setShow({ ...show, forces: v })} />}
            </div>
          </div>

          <div className="card">
            <h3>Teori vs terukur</h3>
            <table className="readout">
              <tbody>
                <tr>
                  <th>Periode alami Tn</th>
                  <td>{f(md.Tn)} s</td>
                  <th>T terukur</th>
                  <td>{read.T ? `${f(read.T)} s` : '—'}</td>
                </tr>
                <tr>
                  <th>Frekuensi fn</th>
                  <td>{f(md.fn)} Hz</td>
                  <th>f terukur</th>
                  <td>{read.T ? `${f(1 / read.T)} Hz` : '—'}</td>
                </tr>
                <tr>
                  <th>ωn</th>
                  <td>{f(md.wn, 2)} rad/s</td>
                  <th>Amplitudo A</th>
                  <td>{read.A ? fmtU(read.A) : '—'}</td>
                </tr>
                <tr>
                  <th>Rasio redaman ζ</th>
                  <td>
                    {f(md.zeta, 3)} <small>({kindLabel})</small>
                  </td>
                  <th>Td teredam</th>
                  <td>{md.zeta < 1 ? `${f(md.Td)} s` : '—'}</td>
                </tr>
                <tr>
                  <th>{vert ? 'Lendutan statis δst' : setup === 'rotasi' ? 'Inersia J' : 'Gaya pegas di u'}</th>
                  <td>
                    {vert
                      ? `${(md.qeq * 100).toFixed(2)} cm`
                      : setup === 'rotasi'
                        ? `${inertia(p.m).toFixed(3)} kg·m²`
                        : `${(p.k * Math.abs(read.u)).toFixed(1)} N`}
                  </td>
                  <th>Siklus terhitung</th>
                  <td>{read.cycles}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Energi</h3>
            <Bar label={setup === 'rotasi' ? 'Kinetik ½Jω²' : 'Kinetik ½mv²'} value={read.ek} max={eMax} color="var(--navy)" />
            <Bar label={vert ? 'Potensial ½k·u² (pegas + gravitasi)' : setup === 'rotasi' ? 'Potensial pegas ½kθ·θ²' : 'Potensial pegas ½k·u²'} value={read.ep} max={eMax} color="var(--green)" />
            <Bar label="Diserap peredam" value={read.ed} max={eMax} color="var(--orange)" />
          </div>
        </aside>
      </div>

      <Notes setup={setup} p={p} md={md} />
    </div>
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

function Notes({ setup, p, md }: { setup: Setup; p: Params; md: ReturnType<typeof modal> }) {
  const rot = setup === 'rotasi'
  const vert = isVertical(setup)
  return (
    <div className="notes">
      <div className="card">
        <h3>Catatan konsep</h3>
        {rot ? (
          <ul>
            <li>
              <b>Hukum Hooke versi rotasi:</b> momen pegas M = kθ·θ. Inersia piringan J = ½·m·r² = {inertia(p.m).toFixed(3)} kg·m².
            </li>
            <li>
              <b>Periode alami:</b> Tn = 2π·√(J/kθ) = 2π·√({inertia(p.m).toFixed(3)} / {p.k}) = <b>{md.Tn.toFixed(3)} s</b>. Persis bentuk
              pegas linear: massa diganti inersia, k diganti kθ.
            </li>
            <li>
              <b>Redaman:</b> ζ = cθ / (2·√(kθ·J)) = {md.zeta.toFixed(3)}.
            </li>
          </ul>
        ) : (
          <ul>
            <li>
              <b>Hukum Hooke:</b> gaya pegas F = k·x, sebanding dengan perubahan panjang x.
              {vert && p.g > 0 && (
                <>
                  {' '}
                  Di kesetimbangan gaya pegas = berat: k·δst = m·g → δst = {p.m}·{p.g} / {p.k} = <b>{(md.qeq * 100).toFixed(2)} cm</b>.
                </>
              )}
            </li>
            <li>
              <b>Periode alami:</b> Tn = 2π·√(m/k) = 2π·√({p.m} / {p.k}) = <b>{md.Tn.toFixed(3)} s</b>. Tidak bergantung pada amplitudo
              {vert ? ' maupun gravitasi g — gravitasi hanya menggeser titik kesetimbangan.' : '.'}
            </li>
            <li>
              <b>Amplitudo</b> A = simpangan maksimum dari kesetimbangan. Tanpa redaman (c = 0) amplitudo tetap selamanya karena energi
              hanya berpindah antara kinetik dan potensial.
            </li>
            <li>
              <b>Redaman:</b> ζ = c / (2·√(k·m)) = {md.zeta.toFixed(3)}. Puncak berikutnya mengecil dengan faktor e^(−2πζ/√(1−ζ²)). Struktur
              gedung umumnya ζ ≈ 0,02–0,05.
            </li>
            <li>
              Persamaan gerak: <code>m·ü + c·u̇ + k·u = 0</code> — persamaan dasar dinamika struktur (SDOF).
            </li>
          </ul>
        )}
      </div>
      <div className="card">
        <h3>Coba ini</h3>
        <ol>
          <li>Gandakan massa. Periode naik √2 ≈ 1,41 kali, bukan 2 kali.</li>
          <li>Gandakan kekakuan. Periode turun menjadi 1/√2 ≈ 0,71 kali. Struktur kaku = bergetar cepat.</li>
          {vert && <li>Bandingkan Pegas Tarik dan Pegas Tekan dengan m dan k yang sama: periodenya identik.</li>}
          {vert && <li>Klik “Lepas dari panjang bebas”: amplitudo yang terukur sama dengan δst. Beban yang dilepas tiba-tiba memberi lendutan maksimum 2·δst!</li>}
          {vert && <li>Pindah ke gravitasi Bulan (1,62): δst mengecil, tetapi periode tetap.</li>}
          <li>Klik “c = kritis”, lalu simpangkan: massa kembali ke kesetimbangan tercepat tanpa bergetar.</li>
          <li>Atur c kecil (≈ 5% c kritis) dan hitung berapa siklus sampai amplitudo tinggal setengahnya.</li>
        </ol>
      </div>
    </div>
  )
}
