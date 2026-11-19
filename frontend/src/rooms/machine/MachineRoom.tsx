import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { drawPlot, PlotScale, type Sample } from '../../lab/plot'
import { C } from '../../lab/theme'
import { Segmented, Slider } from '../../ui/controls'
import { defaults, FNDS, foundationOf, machineOf, parseQuery, RANGES, RPM_MAX, SETUPS, severity, toQuery, type FndKind, type Params, type Setup } from './model'
import { forceHarmonics, machineForce, phase, rpmToW, steadyAmp, stepM, wnOf, wToRpm, zetaOf, type MState } from './physics'
import { drawResponse, rpmAt, type RespLayout } from './response'
import { drawStage, targetScale } from './stage'

const H = 1 / 4000
const V_LIM = 6.3e-3 // m/s, batas indikatif "dapat diterima"

interface Readout {
  rpm: number
  t: number
  amp: number | null
  u: number
}

export default function MachineRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [motorOn, setMotorOn] = useState(false)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(0.1)
  const [read, setRead] = useState<Readout>({ rpm: 0, t: 0, amp: null, u: 0 })

  const mach = useMemo(() => machineOf(setup, p), [setup, p])
  const fnd = useMemo(() => foundationOf(p), [p])
  const wn = wnOf(fnd)
  const z = zetaOf(fnd)
  const rpmN = wToRpm(wn)
  const rpmMax = RPM_MAX[setup]
  const target = motorOn ? p.rpm : 0

  const live = useRef({ setup, p, mach, fnd, target, running, speed, rpmMax, rpmN })
  live.current = { setup, p, mach, fnd, target, running, speed, rpmMax, rpmN }

  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const respRef = useRef<HTMLCanvasElement>(null)
  const sim = useRef<MState & { t: number }>({ u: 0, v: 0, th: 0, w: 0, t: 0 })
  const hist = useRef<Sample[]>([])
  const histF = useRef<Sample[]>([])
  const trace = useRef<{ rpm: number; amp: number }[]>([])
  const rev = useRef({ n: 0, max: 0, last: 0 })
  const view = useRef(0)
  const plotScale = useRef(new PlotScale())
  const respLayout = useRef<RespLayout | null>(null)

  useEffect(() => onQuery(toQuery(setup, p)), [setup, p]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeSetup = (s: Setup) => {
    setSetup(s)
    setP({ ...defaults(s), fd: p.fd })
    setMotorOn(false)
    sim.current = { u: 0, v: 0, th: 0, w: 0, t: 0 }
    trace.current = []
    hist.current = []
    histF.current = []
    view.current = 0
  }

  const start = () => {
    trace.current = []
    setMotorOn(true)
    setRunning(true)
  }
  const stop = () => {
    trace.current = []
    setMotorOn(false)
    setRunning(true)
  }
  /** Langsung pada putaran kerja dalam keadaan tunak (superposisi harmonik 1 dan 2). */
  const jump = () => {
    const w = rpmToW(p.rpm)
    const th = sim.current.th
    const [F1, F2] = forceHarmonics(mach, w)
    const st = (F: number, n: number) => {
      const b = (n * w) / wn
      const X = (F / fnd.k) / Math.hypot(1 - b * b, 2 * z * b)
      const ph = phase(b, z)
      return { u: X * Math.cos(n * th - ph), v: -X * n * w * Math.sin(n * th - ph) }
    }
    const a = st(F1, 1)
    const b = setup === 'torak' ? st(F2, 2) : { u: 0, v: 0 }
    sim.current = { ...sim.current, u: a.u + b.u, v: a.v + b.v, w }
    trace.current = []
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
          let a = 0
          if (Math.abs(dw) > rateW * h) a = Math.sign(dw) * rateW
          const n = stepM(L.mach, L.fnd, s, a, h)
          if (a === 0) n.w = wT
          s.u = n.u
          s.v = n.v
          s.w = Math.max(0, n.w)
          // hitung putaran untuk jejak amplitudo
          const thPrev = s.th
          s.th = n.th
          s.t += h
          rem -= h
          if (s.t - lastSample >= winSim / 400 || lastSample < 0) {
            hist.current.push({ t: s.t, u: s.u })
            histF.current.push({ t: s.t, u: machineForce(L.mach, s.th, s.w, 0) / L.fnd.k })
            lastSample = s.t
            if (hist.current.length > 4000) {
              const cut = s.t - winSim * 1.3
              hist.current = hist.current.filter((x) => x.t >= cut)
              histF.current = histF.current.filter((x) => x.t >= cut)
            }
          }
          const r = rev.current
          r.max = Math.max(r.max, Math.abs(s.u))
          if (Math.floor(s.th / (2 * Math.PI)) !== Math.floor(thPrev / (2 * Math.PI)) || s.t - r.last > 0.5) {
            const rpm = wToRpm(s.w)
            const tr = trace.current
            const prev = tr[tr.length - 1]
            if (!prev || Math.abs(prev.rpm - rpm) > L.rpmMax / 600 || s.w === wT) {
              if (prev && Math.abs(prev.rpm - rpm) <= L.rpmMax / 600) tr[tr.length - 1] = { rpm, amp: r.max }
              else tr.push({ rpm, amp: r.max })
              if (tr.length > 3000) tr.shift()
            }
            r.max = 0
            r.last = s.t
          }
        }
      }

      const rpmNow = wToRpm(s.w)
      const ampNow = steadyAmp(L.mach, L.fnd, s.w)
      const ampTgt = steadyAmp(L.mach, L.fnd, rpmToW(Math.max(L.p.rpm, 1)))
      const [F1t, F2t] = forceHarmonics(L.mach, Math.max(s.w, rpmToW(L.p.rpm)))
      // panggung
      const sc = stageRef.current
      if (sc) {
        const { w: cw, h: ch, ctx } = fitCanvas(sc)
        const amp = Math.max(ampNow.amp, ampTgt.amp, Math.abs(s.u), 1e-7)
        const tg = targetScale(amp)
        view.current = view.current === 0 || tg < view.current ? tg : view.current + (tg - view.current) * 0.02
        const F = machineForce(L.mach, s.th, s.w, 0)
        drawStage(ctx, cw, ch, {
          setup: L.setup,
          fd: L.p.fd,
          u: s.u,
          th: s.th,
          rpm: rpmNow,
          rpmTarget: L.p.rpm,
          rpmMax: L.rpmMax,
          rpmN: L.rpmN,
          fRel: F1t + F2t > 0 ? F / (F1t + F2t) : 0,
          r: L.mach.r,
          l: L.mach.l,
          scale: view.current,
          level: Math.min(1, (ampNow.amp * s.w) / 0.01),
        })
      }
      // grafik waktu
      const pc = plotRef.current
      if (pc) {
        const { w: cw, h: ch, ctx } = fitCanvas(pc)
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
            mainLabel: 'simpangan pondasi',
            peaks: [],
            showAmplitude: false,
            showPeriod: false,
            envelope: null,
            extra: [{ samples: histF.current, color: C.red, dash: [5, 4], label: 'F(t)/k' }],
            hlines: s.w > 0 ? [{ v: ampNow.amp, color: C.steel, label: '±amplitudo tunak teori' }] : [],
          },
          plotScale.current,
        )
      }
      // respons vs rpm
      const rc = respRef.current
      if (rc) {
        const { w: cw, h: ch, ctx } = fitCanvas(rc)
        respLayout.current = drawResponse(ctx, cw, ch, {
          curve: (rpm) => steadyAmp(L.mach, L.fnd, rpmToW(rpm)).amp,
          rpmMax: L.rpmMax,
          rpmN: L.rpmN,
          torak: L.setup === 'torak',
          rpm: rpmNow,
          target: L.p.rpm,
          trace: trace.current,
          vLim: V_LIM,
        })
      }

      if (now - lastRead > 120) {
        lastRead = now
        const tr = trace.current
        setRead({ rpm: rpmNow, t: s.t, amp: tr.length ? tr[tr.length - 1].amp : null, u: s.u })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // pilih putaran kerja dengan menggeser di grafik respons
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
  const op = steadyAmp(mach, fnd, wOp)
  const [F1, F2] = forceHarmonics(mach, wOp)
  const vPeak = wOp * op.X1 + 2 * wOp * op.X2
  const sev = severity(vPeak * 1000)
  const beta = wOp / wn
  const inBand = (b: number) => b >= 0.8 && b <= 1.25
  const warn = inBand(beta) ? 'Putaran kerja di zona resonansi (±20% fn)!' : setup === 'torak' && inBand(2 * beta) ? 'Harmonik kedua (2ω) di zona resonansi!' : null
  const um = (v: number) => `${(v * 1e6).toFixed(v * 1e6 < 10 ? 2 : 1)} µm`
  const kN = (v: number) => `${(v / 1000).toFixed(v < 1e4 ? 2 : 1)} kN`
  const tanah = p.fd === 'tanah'

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
            <canvas ref={stageRef} className="stage" style={{ height: 380 }} />
            <div className="stage-tip wide-only">Gerak lambat {speed}× — putaran & getaran digambar pada waktu simulasi.</div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Simpangan vertikal pondasi terhadap waktu</b>
              <small style={{ color: 'var(--mute)' }}>t = {read.t.toFixed(3)} s (waktu simulasi)</small>
            </div>
            <canvas ref={plotRef} className="plot" />
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Amplitudo terhadap putaran — klik Start untuk merekam jejak run-up</b>
              <small style={{ color: 'var(--mute)' }}>geser untuk memilih putaran kerja</small>
            </div>
            <canvas
              ref={respRef}
              className="plot"
              style={{ height: 300, cursor: 'ew-resize', touchAction: 'none' }}
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
            <Slider label="Putaran kerja" symbol="n" unit="rpm" value={p.rpm} {...RANGES.rpm} max={rpmMax} onChange={set('rpm')} hint={`f = ${(p.rpm / 60).toFixed(2)} Hz · β = ω/ωn = ${beta.toFixed(2)}`} />
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
                <Slider label="Massa berputar" symbol="m_rot" unit="kg" value={p.mRot} {...RANGES.mRot} onChange={set('mRot')} hint="engkol tak seimbang + ⅔ batang" />
                <Slider label="Jari-jari engkol" symbol="r" unit="cm" value={p.r} {...RANGES.r} onChange={set('r')} />
                <Slider label="Rasio batang" symbol="l/r" unit="" value={p.lr} {...RANGES.lr} onChange={set('lr')} />
              </>
            )}
          </div>

          <div className="card">
            <h3>Pondasi</h3>
            <div style={{ marginBottom: 8 }}>
              <Segmented value={p.fd} options={FNDS.map((f) => ({ id: f.id, label: f.label, title: f.hint }))} onChange={(v: FndKind) => setP({ ...p, fd: v })} />
            </div>
            <Slider label={tanah ? 'Massa blok' : 'Massa pelat meja'} symbol="m_p" unit="ton" value={p.Mb} {...RANGES.Mb} onChange={set('Mb')} />
            {tanah ? (
              <>
                <Slider label="Luas dasar blok" symbol="A" unit="m²" value={p.A} {...RANGES.A} onChange={set('A')} hint={`r₀ = √(A/π) = ${fnd.r0.toFixed(2)} m`} />
                <Slider label="Modulus geser tanah" symbol="G" unit="MPa" value={p.G} {...RANGES.G} onChange={set('G')} hint="lempung lunak ≈ 10–20 · pasir padat ≈ 50–100" />
                <Slider label="Rasio Poisson" symbol="ν" unit="" value={p.nu} {...RANGES.nu} onChange={set('nu')} />
              </>
            ) : (
              <>
                <Slider label="Kekakuan vertikal" symbol="k" unit="MN/m" value={p.k} {...RANGES.k} onChange={set('k')} />
                <Slider label="Rasio redaman" symbol="ζ" unit="" value={p.z} {...RANGES.z} onChange={set('z')} />
              </>
            )}
          </div>

          <div className="card">
            <h3>Hasil pada putaran kerja</h3>
            {warn && (
              <p style={{ color: '#b5452f', fontWeight: 600, margin: '0 0 8px', fontSize: 13 }}>
                ⚠ {warn}
              </p>
            )}
            <table className="readout">
              <tbody>
                <tr>
                  <th>fn pondasi</th>
                  <td>
                    {(wn / (2 * Math.PI)).toFixed(2)} Hz <small>({Math.round(rpmN)} rpm)</small>
                  </td>
                  <th>ζ</th>
                  <td>
                    {z.toFixed(3)} {tanah && <small>(Bz {fnd.Bz?.toFixed(2)})</small>}
                  </td>
                </tr>
                <tr>
                  <th>k / M</th>
                  <td colSpan={3}>
                    {(fnd.k / 1e6).toFixed(0)} MN/m · {(fnd.M / 1000).toFixed(1)} ton
                  </td>
                </tr>
                <tr>
                  <th>Gaya F₁ (ω)</th>
                  <td>{kN(F1)}</td>
                  <th>F₂ (2ω)</th>
                  <td>{setup === 'torak' ? kN(F2) : '—'}</td>
                </tr>
                <tr>
                  <th>Amplitudo teori</th>
                  <td>{um(op.amp)}</td>
                  <th>Terukur (1 putaran)</th>
                  <td>{read.amp !== null && Math.abs(read.rpm - p.rpm) < 5 ? um(read.amp) : '—'}</td>
                </tr>
                <tr>
                  <th>Kecepatan puncak</th>
                  <td>
                    {(vPeak * 1000).toFixed(2)} mm/s
                  </td>
                  <th>Kategori</th>
                  <td style={{ color: sev.color }}>{sev.label}</td>
                </tr>
                <tr>
                  <th>Gaya ke {tanah ? 'tanah' : 'kolom'}</th>
                  <td>{kN(op.FT)}</td>
                  <th>TR = F_T/F</th>
                  <td>{(op.FT / (F1 + F2)).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            <p className="slider-hint" style={{ marginTop: 6 }}>
              Hanya mode vertikal (SDOF). Kategori dari kecepatan puncak bersifat indikatif — desain nyata memakai kriteria pabrikan / ISO 10816 / ACI 351.3R.
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
              <b>Mesin rotasi:</b> massa tak seimbang m·e berputar → gaya F = m·e·ω²·cos ωt. Gaya naik dengan kuadrat putaran, sehingga
              di atas resonansi amplitudo tidak turun ke nol melainkan menuju m·e/M (massa pondasi “melawan” rotor).
            </li>
          ) : (
            <li>
              <b>Mesin torak:</b> torak bergerak x = r·cos θ + √(l² − r²sin²θ). Gayanya ≈ (m_rec + m_rot)·r·ω²·cos ωt (primer) + m_rec·r·ω²·(r/l)·cos 2ωt
              (sekunder). Ada dua resonansi berbahaya: ω = ωn dan 2ω = ωn.
            </li>
          )}
          <li>
            <b>Start & stop:</b> mesin yang bekerja di atas resonansi pasti <b>melewati</b> resonansi saat run-up dan coast-down. Laju start yang cepat
            membuat puncak lewat lebih kecil daripada amplitudo tunak resonansi.
          </li>
          {tanah ? (
            <li>
              <b>Pondasi blok di atas tanah:</b> tanah berperilaku seperti pegas kz = 4Gr₀/(1−ν) dan peredam cz = 3,4r₀²√(ρG)/(1−ν). Redaman ini
              adalah <b>redaman radiasi</b> — energi dibawa gelombang yang menjalar menjauh di tanah — dan untuk arah vertikal nilainya besar.
            </li>
          ) : (
            <li>
              <b>Pondasi meja (table-top):</b> redaman struktur beton hanya ≈ 2%, sehingga resonansi sangat tajam. Aturan praktis: fn jauh dari
              putaran kerja (kurang dari 0,8× atau lebih dari 1,25×).
            </li>
          )}
          <li>
            Kriteria desain umum: amplitudo/kecepatan getaran dalam batas pabrikan dan rasio frekuensi di luar ±20% resonansi (ACI 351.3R).
          </li>
        </ul>
      </div>
      <div className="card">
        <h3>Coba ini</h3>
        <ol>
          <li>Klik Start dan ikuti jejak hijau di grafik amplitudo: puncak saat melewati resonansi, lalu turun ke amplitudo kerja.</li>
          <li>Ubah laju start/stop menjadi 50 rpm/s lalu 2000 rpm/s: makin cepat, makin kecil puncak lewat resonansi.</li>
          <li>Pindah ke “Meja / struktur” dan ulangi: resonansi jauh lebih tajam karena tidak ada redaman radiasi.</li>
          <li>Geser putaran kerja ke pita merah: muncul peringatan. Atasi dengan mengubah massa blok atau kekakuan (tuning) — bukan memperbesar mesin.</li>
          {setup === 'torak' && <li>Cari putaran saat 2ω = ωn (pita oranye): pondasi bergetar dua kali per putaran engkol.</li>}
          {setup === 'rotasi' && <li>Gandakan massa blok: fn turun dan amplitudo di atas resonansi mengecil (m·e/M).</li>}
        </ol>
      </div>
    </div>
  )
}
