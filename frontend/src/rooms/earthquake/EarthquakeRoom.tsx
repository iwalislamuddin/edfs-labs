import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { agAt, duration, G, groundMotion, MOTIONS, sdofResponse, sniSa, spectrum, synth, type MotionKind } from '../../lab/ground'
import { C } from '../../lab/theme'
import { Check, Segmented, Slider } from '../../ui/controls'
import { drawSpectrum, drawTraces, tAt, type Row, type SpecLayout } from './charts'
import { isoModes, isoRoofAcc, isoStep, isoSystem } from './isolation'
import { defaults, MASS_T, parseQuery, RANGES, SETUPS, STORY_H, TAIL, toQuery, type Params, type Setup } from './model'
import { drawStage, targetScale } from './stage'

const H = 1 / 1000 // langkah integrasi (s)
const TR_DT = 0.02 // langkah sampel riwayat (s)

interface Run {
  t: number
  u: number
  v: number
  y: number[]
  maxU: number
  maxAF: number
  maxUs: number
  maxUb: number
  maxAI: number
  done: boolean
  tr: { u: number[]; aF: number[]; us: number[]; ub: number[]; aI: number[] }
}

const freshRun = (): Run => ({
  t: 0,
  u: 0,
  v: 0,
  y: [0, 0, 0, 0],
  maxU: 0,
  maxAF: 0,
  maxUs: 0,
  maxUb: 0,
  maxAI: 0,
  done: false,
  tr: { u: [0], aF: [0], us: [0], ub: [0], aI: [0] },
})

interface Readout {
  t: number
  maxU: number
  maxAF: number
  maxUs: number
  maxUb: number
  maxAI: number
  done: boolean
}

export default function EarthquakeRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [kind, setKind] = useState<'Sa' | 'Sd'>('Sa')
  const [show, setShow] = useState({ curve: true, sni: true })
  const [points, setPoints] = useState<{ T: number; Sd: number; key: string }[]>([])
  const [read, setRead] = useState<Readout>({ t: 0, maxU: 0, maxAF: 0, maxUs: 0, maxUb: 0, maxAI: 0, done: false })

  const rec = useMemo(() => synth(p.rec, p.pga, p.seed), [p.rec, p.pga, p.seed])
  const gm = useMemo(() => groundMotion(rec), [rec])
  const dur = duration(rec)
  const sp = useMemo(() => spectrum(rec, p.z), [rec, p.z])
  const SdT = useMemo(() => sdofResponse(rec, p.T, p.z).Sd, [rec, p.T, p.z])
  const iso = useMemo(() => isoSystem({ T: p.T, zeta: p.z, Tiso: p.Tiso, zetaIso: p.zi, mbRatio: 0.5 }), [p.T, p.z, p.Tiso, p.zi])
  const recKey = `${p.rec}|${p.pga}|${p.seed}|${p.z}`
  const design = { SDS: p.SDS, SD1: p.SD1, TL: 6 }

  const live = useRef({ setup, p, rec, gm, dur, iso, running, speed, SdT, recKey })
  live.current = { setup, p, rec, gm, dur, iso, running, speed, SdT, recKey }

  const stageRef = useRef<HTMLCanvasElement>(null)
  const traceRef = useRef<HTMLCanvasElement>(null)
  const specRef = useRef<HTMLCanvasElement>(null)
  const run = useRef<Run>(freshRun())
  const view = useRef(0)
  const specLayout = useRef<SpecLayout | null>(null)
  const pointsRef = useRef(points)
  pointsRef.current = points
  const kindRef = useRef(kind)
  kindRef.current = kind
  const showRef = useRef(show)
  showRef.current = show

  const restart = () => {
    run.current = freshRun()
    setRunning(true)
  }

  // parameter yang mengubah eksperimen → mulai ulang dari t = 0
  const first = useRef(true)
  useEffect(() => {
    onQuery(toQuery(setup, p))
    if (first.current) {
      first.current = false
      return
    }
    restart()
  }, [setup, p.rec, p.pga, p.seed, p.T, p.z, p.Tiso, p.zi]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onQuery(toQuery(setup, p)), [p.SDS, p.SD1]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- loop animasi ----
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastRead = 0
    const frame = (now: number) => {
      const L = live.current
      const dtReal = Math.min((now - last) / 1000, 0.05)
      last = now
      const r = run.current
      const tEnd = L.dur + TAIL
      const w = (2 * Math.PI) / L.p.T
      const k = w * w
      const c = 2 * L.p.z * w
      if (L.running && r.t < tEnd) {
        let rem = dtReal * L.speed
        while (rem > 1e-12 && r.t < tEnd) {
          const h = Math.min(H, rem, tEnd - r.t)
          const a0 = agAt(L.rec, r.t)
          const a1 = agAt(L.rec, r.t + h)
          const am = agAt(L.rec, r.t + h / 2)
          // SDOF terjepit (RK4)
          const f = (uu: number, vv: number, ag: number) => -ag - c * vv - k * uu
          const k1v = f(r.u, r.v, a0)
          const k2v = f(r.u + 0.5 * h * r.v, r.v + 0.5 * h * k1v, am)
          const k3v = f(r.u + 0.5 * h * (r.v + 0.5 * h * k1v), r.v + 0.5 * h * k2v, am)
          const k4v = f(r.u + h * (r.v + 0.5 * h * k2v), r.v + h * k3v, a1)
          const un = r.u + (h / 6) * (r.v + 2 * (r.v + 0.5 * h * k1v) + 2 * (r.v + 0.5 * h * k2v) + (r.v + h * k3v))
          r.v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
          r.u = un
          if (L.setup === 'isolasi') r.y = isoStep(L.iso, r.y, a0, a1, h)
          r.t += h
          rem -= h
          const aF = -(c * r.v + k * r.u)
          if (r.t <= L.dur + 1e-9) r.maxU = Math.max(r.maxU, Math.abs(r.u))
          r.maxAF = Math.max(r.maxAF, Math.abs(aF))
          if (L.setup === 'isolasi') {
            r.maxUs = Math.max(r.maxUs, Math.abs(r.y[1]))
            r.maxUb = Math.max(r.maxUb, Math.abs(r.y[0]))
            r.maxAI = Math.max(r.maxAI, Math.abs(isoRoofAcc(L.iso, r.y)))
          }
          const idx = Math.floor(r.t / TR_DT + 1e-9)
          while (r.tr.u.length <= idx) {
            r.tr.u.push(r.u)
            r.tr.aF.push(aF)
            r.tr.us.push(r.y[1])
            r.tr.ub.push(r.y[0])
            r.tr.aI.push(isoRoofAcc(L.iso, r.y))
          }
        }
        if (!r.done && r.t >= L.dur) {
          r.done = true
          const T = L.p.T
          const key = L.recKey
          setPoints((old) => [...old.filter((q) => !(Math.abs(q.T - T) < 0.005 && q.key === key)), { T, Sd: r.maxU, key }].slice(-200))
        }
        if (r.t >= tEnd) setRunning(false)
      }

      const iD = Math.min(L.gm.d.length - 1, Math.round(r.t / L.rec.dt))
      const dg = r.t <= L.dur ? L.gm.d[iD] : L.gm.d[L.gm.d.length - 1]
      // panggung
      const sc = stageRef.current
      if (sc) {
        const { w: cw, h: ch, ctx } = fitCanvas(sc)
        const amp = Math.max(L.gm.pgd, L.SdT, r.maxUb, r.maxUs)
        const target = targetScale(cw, amp, L.setup === 'isolasi' ? 0.08 : 0.12)
        view.current = view.current === 0 || target < view.current ? target : view.current + (target - view.current) * 0.02
        const aFg = -(2 * L.p.z * w * r.v + k * r.u) / G
        drawStage(ctx, cw, ch, {
          setup: L.setup,
          dg,
          u: r.u,
          ub: r.y[0],
          us: r.y[1],
          scale: view.current,
          acc: [aFg, isoRoofAcc(L.iso, r.y) / G],
          done: r.done,
        })
      }
      // riwayat waktu
      const tc = traceRef.current
      if (tc) {
        const { w: cw, h: ch, ctx } = fitCanvas(tc)
        const ghost = L.rec.a
        const step = Math.round(TR_DT / L.rec.dt)
        const agS = ghost.filter((_, i) => i % step === 0)
        const rows: Row[] =
          L.setup === 'spektrum'
            ? [
                { title: 'ag', unit: 'g', factor: 1 / G, series: [{ data: agS, color: C.orange, label: 'percepatan tanah', width: 1 }] },
                { title: 'u', unit: 'cm', factor: 100, series: [{ data: r.tr.u, color: C.navy, label: 'simpangan relatif gedung', width: 1.6 }] },
              ]
            : [
                { title: 'ag', unit: 'g', factor: 1 / G, series: [{ data: agS, color: C.orange, label: 'percepatan tanah', width: 1 }] },
                {
                  title: 'ä atap',
                  unit: 'g',
                  factor: 1 / G,
                  series: [
                    { data: r.tr.aF, color: C.steel, label: 'terjepit', width: 1.2 },
                    { data: r.tr.aI, color: C.navy, label: 'terisolasi', width: 1.8 },
                  ],
                },
                {
                  title: 'simpangan',
                  unit: 'cm',
                  factor: 100,
                  series: [
                    { data: r.tr.u, color: C.steel, label: 'drift terjepit', width: 1.2 },
                    { data: r.tr.us, color: C.navy, label: 'drift terisolasi', width: 1.8 },
                    { data: r.tr.ub, color: C.green, label: 'isolator', dash: [5, 3], width: 1.4 },
                  ],
                },
              ]
        drawTraces(ctx, cw, ch, rows, TR_DT, L.dur + TAIL, r.t, L.dur)
      }
      // spektrum
      const spc = specRef.current
      if (spc) {
        const { w: cw, h: ch, ctx } = fitCanvas(spc)
        const marks: [number, string, string][] = [[L.p.T, L.setup === 'isolasi' ? 'T terjepit' : 'T', C.orange]]
        if (L.setup === 'isolasi') marks.push([L.p.Tiso, 'T iso', C.green])
        specLayout.current = drawSpectrum(ctx, cw, ch, {
          sp: showRef.current.curve ? spRef.current : [],
          kind: kindRef.current,
          design: showRef.current.sni ? designRef.current : null,
          points: pointsRef.current.filter((q) => q.key === L.recKey),
          marks,
          tMax: 4,
        })
      }

      if (now - lastRead > 120) {
        lastRead = now
        setRead({ t: r.t, maxU: r.maxU, maxAF: r.maxAF, maxUs: r.maxUs, maxUb: r.maxUb, maxAI: r.maxAI, done: r.done })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const spRef = useRef(sp)
  spRef.current = sp
  const designRef = useRef(design)
  designRef.current = design

  // ---- pointer di spektrum: pilih T ----
  const specDrag = useRef(false)
  const setTFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = specLayout.current
    if (!l) return
    const rc = e.currentTarget.getBoundingClientRect()
    const T = Math.round(tAt(l, e.clientX - rc.left) * 100) / 100
    setP((old) => (old.T === T ? old : { ...old, T }))
  }

  const set = (key: keyof Params) => (v: number) => setP((old) => ({ ...old, [key]: v }))
  const w = (2 * Math.PI) / p.T
  const Sd = read.done ? read.maxU : SdT
  const PSa = (w * w * Sd) / G
  const mKg = MASS_T * 1000
  const isoW = isoModes(iso)
  const cm = (v: number) => `${(v * 100).toFixed(2)} cm`
  const gg = (v: number) => `${(v / G).toFixed(3)} g`
  const sniT = sniSa(design, p.T)

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Getaran &amp; Dinamika › <b>Room Earthquake</b>
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
            <canvas ref={stageRef} className="stage" style={{ height: 340 }} />
            <div className="stage-live">
              <span>t = {read.t.toFixed(2)} s</span>
              <span>{read.t <= dur ? `rekaman ${((read.t / dur) * 100).toFixed(0)}%` : 'getaran bebas'}</span>
            </div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Riwayat waktu</b>
              <small style={{ color: 'var(--mute)' }}>rekaman sintetis — bukan data gempa nyata</small>
            </div>
            <canvas ref={traceRef} className="plot" style={{ height: setup === 'isolasi' ? 330 : 240 }} />
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>Spektrum respons (ζ = {p.z})</b>
              <div className="plot-opts">
                <Segmented
                  value={kind}
                  options={[
                    { id: 'Sa', label: 'PSa' },
                    { id: 'Sd', label: 'Sd' },
                  ]}
                  onChange={setKind}
                />
                <Check label="Kurva lengkap" checked={show.curve} onChange={(v) => setShow({ ...show, curve: v })} />
                <Check label="Desain SNI" checked={show.sni} onChange={(v) => setShow({ ...show, sni: v })} />
              </div>
            </div>
            <canvas
              ref={specRef}
              className="plot"
              style={{ height: 300, cursor: 'ew-resize', touchAction: 'none' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                specDrag.current = true
                setTFromPointer(e)
              }}
              onPointerMove={(e) => specDrag.current && setTFromPointer(e)}
              onPointerUp={() => (specDrag.current = false)}
              onPointerCancel={() => (specDrag.current = false)}
            />
          </div>
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Gempa</h3>
            <div className="seg-wrap" style={{ marginBottom: 8 }}>
              <Segmented
                value={p.rec}
                options={MOTIONS.map((m) => ({ id: m.id, label: m.label, title: m.hint }))}
                onChange={(v: MotionKind) => setP({ ...p, rec: v })}
              />
            </div>
            <p className="slider-hint" style={{ margin: '0 0 8px' }}>
              {MOTIONS.find((m) => m.id === p.rec)?.hint}
            </p>
            <Slider label="Percepatan puncak" symbol="PGA" unit="g" value={p.pga} {...RANGES.pga} onChange={set('pga')} />
            {(p.rec === 'keras' || p.rec === 'lunak' || p.rec === 'pulsa') && (
              <div className="btn-row">
                <button className="btn ghost sm" onClick={() => setP({ ...p, seed: (p.seed % 999) + 1 })} title="Rekaman acak lain dengan karakter sama">
                  Acak rekaman (#{p.seed})
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Struktur</h3>
            <Slider
              label={setup === 'isolasi' ? 'Periode gedung terjepit' : 'Periode alami'}
              symbol="T"
              unit="s"
              value={p.T}
              {...RANGES.T}
              onChange={set('T')}
              hint="geser juga di grafik spektrum"
            />
            <Slider label="Rasio redaman" symbol="ζ" unit="" value={p.z} {...RANGES.z} onChange={set('z')} />
            {setup === 'isolasi' && (
              <>
                <Slider label="Periode isolasi" symbol="T_iso" unit="s" value={p.Tiso} {...RANGES.Tiso} onChange={set('Tiso')} />
                <Slider label="Redaman isolator" symbol="ζ_iso" unit="" value={p.zi} {...RANGES.zi} onChange={set('zi')} />
              </>
            )}
            <div className="btn-row">
              <button className="btn ghost sm" onClick={() => setP({ ...defaults(), rec: p.rec, seed: p.seed })}>
                Bawaan
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Kontrol</h3>
            <div className="btn-row">
              <button className="btn primary sm" onClick={() => (read.t >= dur + TAIL - 1e-6 ? restart() : setRunning(!running))}>
                {running ? '❚❚ Jeda' : read.t >= dur + TAIL - 1e-6 ? '⟲ Jalankan lagi' : '▶ Jalan'}
              </button>
              <button className="btn ghost sm" onClick={restart}>
                ⟲ Ulangi
              </button>
              <select className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Kecepatan">
                <option value={4}>4×</option>
                <option value={2}>2×</option>
                <option value={1}>1×</option>
                <option value={0.5}>0,5×</option>
                <option value={0.25}>0,25×</option>
              </select>
            </div>
            <div className="btn-row">
              <button className="btn ghost sm" onClick={() => setPoints([])} disabled={!points.length}>
                Hapus titik ({points.filter((q) => q.key === recKey).length})
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Desain SNI 1726</h3>
            <Slider label="Percepatan desain periode pendek" symbol="SDS" unit="g" value={p.SDS} {...RANGES.SDS} onChange={set('SDS')} />
            <Slider label="Percepatan desain periode 1 s" symbol="SD1" unit="g" value={p.SD1} {...RANGES.SD1} onChange={set('SD1')} />
          </div>

          <div className="card">
            <h3>{setup === 'isolasi' ? 'Terjepit vs terisolasi' : 'Hasil'}</h3>
            {setup === 'spektrum' ? (
              <table className="readout">
                <tbody>
                  <tr>
                    <th>PGA / PGV / PGD</th>
                    <td colSpan={3}>
                      {p.pga.toFixed(2)} g · {(gm.pgv * 100).toFixed(1)} cm/s · {(gm.pgd * 100).toFixed(1)} cm
                    </td>
                  </tr>
                  <tr>
                    <th>Sd {read.done ? 'terukur' : 'teori'}</th>
                    <td>{cm(Sd)}</td>
                    <th>u maks sejauh ini</th>
                    <td>{cm(read.maxU)}</td>
                  </tr>
                  <tr>
                    <th>PSa = ω²·Sd</th>
                    <td>{PSa.toFixed(3)} g</td>
                    <th>Sa desain SNI</th>
                    <td>{sniT.toFixed(3)} g</td>
                  </tr>
                  <tr>
                    <th>Geser dasar V = m·PSa</th>
                    <td>{((mKg * PSa * G) / 1000).toFixed(0)} kN</td>
                    <th>Drift Sd/h</th>
                    <td>{((Sd / STORY_H) * 100).toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <th>ä mutlak maks</th>
                    <td>{gg(read.maxAF)}</td>
                    <th>Rasio gempa/desain</th>
                    <td>{(PSa / sniT).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <table className="readout">
                <tbody>
                  <tr>
                    <th></th>
                    <th>Terjepit</th>
                    <th>Terisolasi</th>
                  </tr>
                  <tr>
                    <th>Periode mode 1</th>
                    <td>{p.T.toFixed(2)} s</td>
                    <td>{((2 * Math.PI) / isoW[0]).toFixed(2)} s</td>
                  </tr>
                  <tr>
                    <th>ä atap maks</th>
                    <td>{gg(read.maxAF)}</td>
                    <td>{gg(read.maxAI)}</td>
                  </tr>
                  <tr>
                    <th>Drift struktur maks</th>
                    <td>{cm(read.maxU)}</td>
                    <td>{cm(read.maxUs)}</td>
                  </tr>
                  <tr>
                    <th>Geser struktur ≈ m·ä</th>
                    <td>{((mKg * read.maxAF) / 1000).toFixed(0)} kN</td>
                    <td>{((mKg * read.maxAI) / 1000).toFixed(0)} kN</td>
                  </tr>
                  <tr>
                    <th>Simpangan isolator</th>
                    <td>—</td>
                    <td>{cm(read.maxUb)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className="slider-hint" style={{ marginTop: 6 }}>
              Massa gedung {MASS_T} ton, tinggi tingkat {STORY_H} m{setup === 'isolasi' ? ', massa lantai dasar 0,5·m' : ''}. Titik hijau spektrum tercatat saat rekaman
              selesai.
            </p>
          </div>
        </aside>
      </div>

      <Notes setup={setup} />
    </div>
  )
}

function Notes({ setup }: { setup: Setup }) {
  return (
    <div className="notes">
      <div className="card">
        <h3>Catatan konsep</h3>
        <ul>
          <li>
            Gedung satu tingkat = SDOF di atas tanah bergerak: <code>ü + 2ζω·u̇ + ω²·u = −üg(t)</code>. Respons hanya bergantung pada T dan ζ,
            bukan pada massa.
          </li>
          <li>
            <b>Spektrum respons</b> = simpangan maksimum Sd dari banyak SDOF (berbagai T) terhadap satu rekaman. PSa = ω²·Sd adalah percepatan
            yang dipakai menghitung gaya geser dasar V = m·PSa.
          </li>
          <li>
            T sangat pendek → gedung kaku ikut tanah, PSa → PGA. T sangat panjang → massa diam, Sd → perpindahan tanah maksimum.
          </li>
          <li>
            <b>Spektrum desain SNI 1726</b> adalah selubung halus dari banyak spektrum gempa (rekaman sintetis di sini tidak diskalakan terhadapnya).
          </li>
          {setup === 'isolasi' && (
            <li>
              <b>Isolasi dasar</b> menggeser periode gedung ke daerah spektrum yang rendah (T iso ≫ T), sehingga percepatan dan drift struktur turun
              drastis. Harganya: simpangan besar terkonsentrasi di isolator — perlu celah (seismic gap) dan sambungan utilitas yang fleksibel.
            </li>
          )}
        </ul>
      </div>
      <div className="card">
        <h3>Coba ini</h3>
        <ol>
          <li>Biarkan rekaman selesai: satu titik hijau muncul di spektrum. Ubah T (geser di grafik), ulangi — bangun spektrum titik demi titik.</li>
          <li>Pilih “Sinus 1 Hz”: spektrum memuncak tajam di T = 1 s (resonansi). Kecilkan ζ, puncaknya makin tinggi.</li>
          <li>Pilih “Tanah lunak” dan T = 1,7 s: gedung tinggi menderita, gedung pendek (T = 0,3 s) hampir tidak terganggu.</li>
          <li>Klik “Acak rekaman”: bentuk spektrum bergerigi berubah, tetapi tren umumnya tetap — itulah sebabnya desain memakai selubung.</li>
          {setup === 'isolasi' ? (
            <li>Naikkan T iso dari 1 ke 3 s: ä atap turun, simpangan isolator naik. Tambah ζ iso untuk menekan simpangan isolator.</li>
          ) : (
            <li>Pindah ke tab Isolasi Dasar dengan rekaman yang sama dan bandingkan kedua gedung.</li>
          )}
        </ol>
      </div>
    </div>
  )
}
