import { useEffect, useMemo, useRef, useState } from 'react'
import { chart, fmt } from '../../lab/chart'
import { fitCanvas } from '../../lab/draw'
import { C } from '../../lab/theme'
import { Check, Segmented, Slider } from '../../ui/controls'
import {
  clampParams,
  defaultResp,
  defaults,
  KEYS,
  matrixEffect,
  parseQuery,
  ranges,
  respLabel,
  responses,
  SETUPS,
  supportsX,
  toQuery,
  trackLength,
  truckAxles,
  truckLoads,
  truckRange,
  trussGeom,
  trussType,
  VEHICLES,
  type Load,
  type Params,
  type Setup,
  type Vehicle,
} from './model'
import { drawStage, hitLoad, hitMember, hitSection, xFromScreen, type Layout } from './stage'
import { findRitter, ilAt, ilCurve, ilEffect, ilStats, truckExtremes } from './theory'

const GRID = 60 // titik terukur per panjang jalur
const fmtN = (v: number | null, d = 2) => (v === null ? 'labil' : fmt(v, d))

export default function InfluenceRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [resp, setResp] = useState(init.resp)
  const [veh, setVeh] = useState<Vehicle>(init.veh)
  const [dir, setDir] = useState<1 | -1>(init.dir)
  const [pos, setPos] = useState(() => trackLength(init.setup, init.params) * 0.3)
  const [playing, setPlaying] = useState(init.veh !== 'lajur')
  const [slow, setSlow] = useState(false)
  const [mb, setMb] = useState(false)
  const [lajurSign, setLajurSign] = useState<1 | -1>(1)
  const [hoverMember, setHoverMember] = useState<number | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  const [traceN, setTraceN] = useState(0)

  useEffect(() => onQuery(toQuery({ setup, params: p, resp, veh, dir })), [setup, p, resp, veh, dir]) // eslint-disable-line react-hooks/exhaustive-deps

  const Lt = trackLength(setup, p)
  const rg = ranges(setup, p)
  const curve = useMemo(() => ilCurve(setup, p, resp), [setup, p, resp])
  const stats = useMemo(() => ilStats(curve), [curve])
  const ritter = useMemo(() => (setup === 'truss' && resp === 'N' ? findRitter(p, p.mem) : null), [setup, p, resp])
  const axles = useMemo(() => truckAxles(p.g, dir), [p.g, dir])
  const eta = (x: number) => ilAt(setup, p, resp, x)

  // jejak titik terukur — dikosongkan bila garis pengaruh berubah
  const ilKey = `${setup}|${resp}|${KEYS[setup].filter((k) => k !== 'g' && k !== 'q' && k !== 'pk').map((k) => p[k]).join(',')}`
  const trace = useRef(new Map<number, number>())
  const traceKey = useRef(ilKey)
  if (traceKey.current !== ilKey) {
    traceKey.current = ilKey
    trace.current = new Map()
  }
  const record = (x: number) => {
    const L = live.current
    const step = trackLength(L.setup, L.p) / GRID
    const i = Math.round(x / step)
    if (Math.abs(x - i * step) > step * 0.5 || trace.current.has(i)) return
    const xi = i * step
    const v = matrixEffect(L.setup, L.p, L.resp, [{ x: xi, P: 1 }])
    if (v === null) return
    trace.current.set(i, v)
    setTraceN(trace.current.size)
  }
  const sweepAll = () => {
    const step = Lt / GRID
    for (let i = 0; i <= GRID; i++) {
      const v = matrixEffect(setup, p, resp, [{ x: i * step, P: 1 }])
      if (v !== null) trace.current.set(i, v)
    }
    setTraceN(trace.current.size)
  }
  const tracePts = (): [number, number][] => {
    const step = trackLength(live.current.setup, live.current.p) / GRID
    return [...trace.current].sort((a, b) => a[0] - b[0]).map(([i, v]) => [i * step, v])
  }

  const live = useRef({ setup, p, resp, veh, dir, pos, playing, slow, mb, lajurSign, hoverMember, curve, stats, ritter, axles })
  live.current = { setup, p, resp, veh, dir, pos, playing, slow, mb, lajurSign, hoverMember, curve, stats, ritter, axles }
  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const layout = useRef<Layout | null>(null)
  const drag = useRef<null | { kind: 'load' | 'sec'; off: number }>(null)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const L = live.current
      const lt = trackLength(L.setup, L.p)
      let x = L.pos
      if (L.playing && !drag.current && L.veh !== 'lajur') {
        const r = L.veh === 'truk' ? truckRange(lt, L.axles) : { min: 0, max: lt }
        const v = ((r.max - r.min) / 8) * (L.slow ? 0.35 : 1)
        const d = L.veh === 'truk' ? L.dir : 1
        x += d * v * dt
        if (x > r.max) x = r.min
        if (x < r.min) x = r.max
        if (L.veh === 'satuan') record(x)
        live.current.pos = x
        setPos(x)
      }
      const c = stageRef.current
      if (c) {
        const { w, h, ctx } = fitCanvas(c)
        layout.current = drawStage(ctx, w, h, {
          setup: L.setup,
          p: L.p,
          resp: L.resp,
          curve: L.curve,
          stats: L.stats,
          trace: tracePts(),
          veh: L.veh,
          pos: x,
          axles: L.axles,
          lajurSign: L.lajurSign,
          mb: L.mb,
          ritter: L.ritter,
          hoverMember: L.hoverMember,
          eta: (xx) => ilAt(L.setup, L.p, L.resp, xx),
        })
      }
      const pc = plotRef.current
      if (pc && L.veh === 'truk') drawTruckPlot(pc, L.setup, L.p, L.resp, L.axles, x)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const changeSetup = (s: Setup) => {
    const np = defaults(s)
    setSetup(s)
    setP(np)
    setResp(defaultResp(s))
    setMb(false)
    setPos(trackLength(s, np) * 0.3)
  }
  const set = (key: keyof Params) => (val: number) => setP((old) => clampParams(setup, { ...old, [key]: val }))
  const changeVeh = (v: Vehicle) => {
    setVeh(v)
    if (v === 'truk') setPos(truckRange(Lt, axles).min + 0.35 * (truckRange(Lt, axles).max - truckRange(Lt, axles).min))
    else if (v === 'satuan') setPos(Lt * 0.3)
    setPlaying(v !== 'lajur')
  }

  // ---- pointer ----
  const local = (e: React.PointerEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }
  const clampPos = (x: number) => {
    const L = live.current
    const lt = trackLength(L.setup, L.p)
    const r = L.veh === 'truk' ? truckRange(lt, L.axles) : { min: 0, max: lt }
    return Math.min(r.max, Math.max(r.min, x))
  }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    const L = live.current
    const xm = xFromScreen(l, x)
    let kind: 'load' | 'sec' | null = null
    let off = 0
    if (hitSection(l, x, y)) kind = 'sec'
    else if (hitLoad(l, x, y)) {
      kind = 'load'
      off = xm - L.pos
    } else if (L.setup === 'truss') {
      const m = hitMember(l, x, y)
      if (m !== null) {
        setResp('N')
        setP((old) => ({ ...old, mem: m }))
        return
      }
    }
    if (!kind && L.veh !== 'lajur' && Math.abs(y - l.view.yS) < 70 && xm >= 0 && xm <= trackLength(L.setup, L.p)) {
      kind = 'load'
      off = L.veh === 'truk' ? xm - L.pos : 0
      const nx = clampPos(xm - off)
      live.current.pos = nx
      setPos(nx)
      if (L.veh === 'satuan') record(nx)
    }
    if (!kind) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { kind, off }
    setGrabbing(true)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    const xm = xFromScreen(l, x)
    const d = drag.current
    if (d?.kind === 'sec') {
      setP((old) => {
        const n = clampParams(live.current.setup, { ...old, xs: Math.round(xm * 20) / 20 })
        return n.xs === old.xs ? old : n
      })
      return
    }
    if (d?.kind === 'load') {
      const nx = clampPos(xm - d.off)
      live.current.pos = nx
      setPos(nx)
      if (live.current.veh === 'satuan') record(nx)
      return
    }
    const L = live.current
    const onH = hitSection(l, x, y) || hitLoad(l, x, y)
    const m = !onH && L.setup === 'truss' ? hitMember(l, x, y) : null
    e.currentTarget.style.cursor = onH ? 'grab' : m !== null ? 'pointer' : 'default'
    if (m !== L.hoverMember) setHoverMember(m)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setGrabbing(false)
  }

  // ---- angka ----
  const g = setup === 'truss' ? trussGeom(p) : null
  const resps = responses(setup, p)
  const rl = respLabel(setup, p, resp)
  const unitM = resp === 'M' ? 'kN·m' : 'kN'
  const etaT = eta(pos)
  const etaM = veh === 'satuan' ? matrixEffect(setup, p, resp, [{ x: pos, P: 1 }]) : null
  const tLoads = truckLoads(pos, axles)
  const truckT = ilEffect(setup, p, resp, tLoads)
  const truckM = veh === 'truk' ? matrixEffect(setup, p, resp, tLoads) : null
  const ext = useMemo(() => (veh === 'truk' ? truckExtremes(setup, p, resp, (d) => truckAxles(p.g, d)) : null), [veh, setup, p, resp])
  const lajur = useMemo(() => (veh === 'lajur' ? lajurEffect(setup, p, resp, stats) : null), [veh, setup, p, resp, stats])

  const goExtreme = (e: { X: number; dir: 1 | -1 }) => {
    setDir(e.dir)
    setPos(e.X)
    setPlaying(false)
  }

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Statika &amp; Struktur › <b>Room Influence Line</b>
        </span>
        <Segmented value={setup} options={SETUPS.map((s) => ({ id: s.id, label: s.label, title: s.hint }))} onChange={changeSetup} />
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
              style={{ height: setup === 'truss' ? 540 : 500 }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={() => setHoverMember(null)}
            />
            <div className="stage-tip wide-only">
              {veh === 'lajur'
                ? 'Beban lajur diletakkan hanya di bagian garis pengaruh yang bertanda sama — pola paling menentukan.'
                : setup === 'truss'
                  ? 'Geser beban di lantai (batang bawah) · klik batang untuk melihat garis pengaruhnya.'
                  : 'Geser beban (oranye) di sepanjang balok · geser segitiga potongan untuk memindah titik V/M.'}
            </div>
            <div className="stage-live">
              {veh === 'satuan' && (
                <>
                  <span>x = {fmt(pos, 2)} m</span>
                  <span>
                    {rl} = {fmt(etaT, 3)} {unitM}
                  </span>
                </>
              )}
              {veh === 'truk' && (
                <>
                  <span>gandar depan X = {fmt(pos, 2)} m</span>
                  <span>
                    {rl} = Σ P·η = {fmt(truckT, 1)} {unitM}
                  </span>
                </>
              )}
              {veh === 'lajur' && lajur && (
                <span>
                  {rl} = {fmt(lajurSign > 0 ? lajur.maxT : lajur.minT, 1)} {unitM}
                </span>
              )}
              <span>titik terukur: {traceN}</span>
            </div>
          </div>

          <div className="card">
            <div className="plot-head">
              <b>Kontrol</b>
              <div className="plot-opts">
                {setup !== 'truss' && <Check label="Müller–Breslau" checked={mb} onChange={setMb} />}
                <Check label="Gerak lambat" checked={slow} onChange={setSlow} />
              </div>
            </div>
            <div className="btn-row" style={{ marginTop: 4 }}>
              {veh !== 'lajur' && (
                <button className="btn sm" onClick={() => setPlaying(!playing)}>
                  {playing ? '⏸ Jeda' : '▶ Jalankan'}
                </button>
              )}
              <button className="btn ghost sm" onClick={sweepAll} title="Hitung beban satuan di semua titik jalur dengan solver kekakuan">
                Sapu semua titik
              </button>
              <button
                className="btn ghost sm"
                onClick={() => {
                  trace.current = new Map()
                  setTraceN(0)
                }}
              >
                Hapus titik terukur
              </button>
              <span style={{ fontSize: 12, color: 'var(--mute)' }}>
                <span style={{ color: C.green, fontWeight: 700 }}>━</span> teori &nbsp; <span style={{ color: C.navy, fontWeight: 700 }}>●</span> terukur (matriks kekakuan, beban 1 kN)
              </span>
            </div>
          </div>

          {veh === 'truk' && (
            <div className="card plot-card">
              <div className="plot-head">
                <b>
                  Efek truk {rl} vs posisi gandar depan X ({dir > 0 ? 'bergerak →' : 'bergerak ←'})
                </b>
              </div>
              <canvas ref={plotRef} className="plot" />
            </div>
          )}
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Struktur</h3>
            {setup === 'sederhana' && (
              <>
                <Slider label="Bentang A–B" symbol="L" unit="m" value={p.L} {...rg.L} onChange={set('L')} />
                <Slider label="Kantilever kiri" symbol="c₁" unit="m" value={p.c1} {...rg.c1} onChange={set('c1')} />
                <Slider label="Kantilever kanan" symbol="c₂" unit="m" value={p.c2} {...rg.c2} onChange={set('c2')} />
              </>
            )}
            {setup === 'menerus' && (
              <>
                <div className="btn-row" style={{ marginTop: 0, marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>Jumlah bentang</span>
                  <Segmented
                    value={String(p.nb)}
                    options={[
                      { id: '2', label: '2' },
                      { id: '3', label: '3' },
                    ]}
                    onChange={(v) => {
                      set('nb')(Number(v))
                      if (resp === 'R3' && v === '2') setResp('R2')
                    }}
                  />
                </div>
                <Slider label="Bentang 1" symbol="L₁" unit="m" value={p.L} {...rg.L} onChange={set('L')} />
                <Slider label="Bentang 2" symbol="L₂" unit="m" value={p.L2} {...rg.L2} onChange={set('L2')} />
                {p.nb >= 3 && <Slider label="Bentang 3" symbol="L₃" unit="m" value={p.L3} {...rg.L3} onChange={set('L3')} />}
              </>
            )}
            {setup === 'truss' && g && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Segmented
                    value={String(Math.round(p.tp))}
                    options={['Pratt', 'Howe', 'Warren'].map((t, i) => ({ id: String(i), label: t }))}
                    onChange={(v) => setP((old) => clampParams(setup, { ...old, tp: Number(v), mem: 0 }))}
                  />
                </div>
                <Slider label="Panjang rangka" symbol="L" unit="m" value={p.L} {...rg.L} onChange={set('L')} />
                <Slider label="Tinggi rangka" symbol="h" unit="m" value={p.h} {...rg.h} onChange={(v) => set('h')(v)} />
                <Slider label="Jumlah panel" symbol="n" unit="panel" value={p.n} {...rg.n} onChange={(v) => setP((old) => clampParams(setup, { ...old, n: v, mem: 0 }))} />
              </>
            )}
          </div>

          <div className="card">
            <h3>Fungsi respons</h3>
            <div style={{ marginBottom: 10 }}>
              <Segmented value={resp} options={resps.map((r) => ({ id: r.id, label: r.label }))} onChange={setResp} />
            </div>
            {(resp === 'V' || resp === 'M') && (
              <Slider label="Posisi potongan dari ujung kiri" symbol="xₛ" unit="m" value={p.xs} {...rg.xs} onChange={set('xs')} />
            )}
            {setup === 'truss' && g && resp === 'N' && (
              <label className="slider" style={{ marginBottom: 6 }}>
                <span className="slider-head">
                  <span>Batang yang diamati</span>
                  <select className="speed" value={p.mem} onChange={(e) => set('mem')(Number(e.target.value))}>
                    {g.names.map((n, i) => (
                      <option key={i} value={i}>
                        {n}
                      </option>
                    ))}
                  </select>
                </span>
                <small className="slider-hint">
                  {trussType(p)}: A = batang atas, B = bawah, V = tegak, D = diagonal. Klik batang di panggung untuk memilih.
                </small>
              </label>
            )}
          </div>

          <div className="card">
            <h3>Teori vs matriks kekakuan</h3>
            <table className="readout">
              <thead>
                <tr>
                  <th />
                  <th>Teori</th>
                  <th>Matriks</th>
                </tr>
              </thead>
              <tbody>
                {veh === 'satuan' && (
                  <tr>
                    <th>η({fmt(pos, 2)} m)</th>
                    <td>{fmt(etaT, 4)}</td>
                    <td>{etaM === null ? 'labil' : fmt(etaM, 4)}</td>
                  </tr>
                )}
                {veh === 'truk' && (
                  <tr>
                    <th>{rl} akibat truk di X</th>
                    <td>
                      {fmt(truckT, 2)} <small>Σ P·η</small>
                    </td>
                    <td>
                      {truckM === null ? 'labil' : fmt(truckM, 2)} <small>{unitM}</small>
                    </td>
                  </tr>
                )}
                {veh === 'lajur' && lajur && (
                  <tr>
                    <th>{rl} pola {lajurSign > 0 ? 'maks +' : 'min −'}</th>
                    <td>
                      {fmt(lajurSign > 0 ? lajur.maxT : lajur.minT, 2)} <small>q·A + p·η</small>
                    </td>
                    <td>
                      ≈ {fmtN(lajurSign > 0 ? lajur.checkMax : lajur.checkMin)} <small>{unitM}</small>
                    </td>
                  </tr>
                )}
                <tr>
                  <th>η maks (x = {fmt(stats.xMax, 2)} m)</th>
                  <td>{fmt(stats.max, 4)}</td>
                  <td>—</td>
                </tr>
                <tr>
                  <th>η min (x = {fmt(stats.xMin, 2)} m)</th>
                  <td>{fmt(stats.min, 4)}</td>
                  <td>—</td>
                </tr>
                <tr>
                  <th>Luas positif A⁺</th>
                  <td>
                    {fmt(stats.pos, 3)} <small>{resp === 'M' ? 'm²' : 'm'}</small>
                  </td>
                  <td>—</td>
                </tr>
                <tr>
                  <th>Luas negatif A⁻</th>
                  <td>
                    {fmt(stats.neg, 3)} <small>{resp === 'M' ? 'm²' : 'm'}</small>
                  </td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
            <small className="slider-hint" style={{ marginTop: 6 }}>
              {theoryNote(setup, resp, ritter, g?.names ?? [])}
            </small>
          </div>

          <div className="card">
            <h3>Beban berjalan</h3>
            <div style={{ marginBottom: 10 }}>
              <Segmented value={veh} options={VEHICLES} onChange={changeVeh} />
            </div>
            {veh === 'satuan' && (
              <p style={{ fontSize: 13.5, color: 'var(--mute)', margin: 0 }}>
                Satu beban 1 kN berjalan dari kiri ke kanan. Nilai respons di setiap posisi = ordinat garis pengaruh. Titik biru dihitung
                ulang oleh solver kekakuan setiap kali beban melewati titik jalur.
              </p>
            )}
            {veh === 'truk' && ext && (
              <>
                <div className="btn-row" style={{ marginTop: 0, marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>Arah</span>
                  <Segmented
                    value={String(dir)}
                    options={[
                      { id: '1', label: '→ ke kanan' },
                      { id: '-1', label: '← ke kiri' },
                    ]}
                    onChange={(v) => {
                      const d = (Number(v) as 1 | -1) || 1
                      setDir(d)
                      const r = truckRange(Lt, truckAxles(p.g, d))
                      setPos(Math.min(r.max, Math.max(r.min, pos)))
                    }}
                  />
                </div>
                <Slider label="Jarak gandar belakang" symbol="g" unit="m" value={p.g} {...rg.g} onChange={set('g')} hint="Truk T: 50 kN – 5 m – 225 kN – (4…9 m) – 225 kN" />
                <table className="readout">
                  <tbody>
                    <tr>
                      <th>Maks + ({ext.max.dir > 0 ? '→' : '←'}, X = {fmt(ext.max.X, 2)} m)</th>
                      <td>
                        {fmt(ext.max.val, 1)} <small>{unitM}</small>
                      </td>
                    </tr>
                    <tr>
                      <th>Min − ({ext.min.dir > 0 ? '→' : '←'}, X = {fmt(ext.min.X, 2)} m)</th>
                      <td>
                        {fmt(ext.min.val, 1)} <small>{unitM}</small>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="btn-row">
                  <button className="btn ghost sm" onClick={() => goExtreme(ext.max)} disabled={ext.max.val <= 0}>
                    Ke posisi maks
                  </button>
                  <button className="btn ghost sm" onClick={() => goExtreme(ext.min)} disabled={ext.min.val >= 0}>
                    Ke posisi min
                  </button>
                </div>
              </>
            )}
            {veh === 'lajur' && lajur && (
              <>
                <Slider label="Beban merata" symbol="q" unit="kN/m" value={p.q} {...rg.q} onChange={set('q')} />
                <Slider label="Beban garis (terpusat)" symbol="p" unit="kN" value={p.pk} {...rg.pk} onChange={set('pk')} hint="per 1 m lebar lajur — SNI 1725: BTR 9 kPa (L ≤ 30 m), BGT 49 kN/m" />
                <div className="btn-row" style={{ marginTop: 0, marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>Pola</span>
                  <Segmented
                    value={String(lajurSign)}
                    options={[
                      { id: '1', label: 'Maks +' },
                      { id: '-1', label: 'Min −' },
                    ]}
                    onChange={(v) => setLajurSign(v === '-1' ? -1 : 1)}
                  />
                </div>
                <table className="readout">
                  <tbody>
                    <tr>
                      <th>Maks + = q·A⁺ + p·η maks</th>
                      <td>
                        {fmt(lajur.maxT, 1)} <small>{unitM}</small>
                      </td>
                    </tr>
                    <tr>
                      <th>Min − = q·A⁻ + p·η min</th>
                      <td>
                        {fmt(lajur.minT, 1)} <small>{unitM}</small>
                      </td>
                    </tr>
                    <tr>
                      <th>Seluruh jalur dibebani q (+p maks)</th>
                      <td>
                        {fmt(lajur.full, 1)} <small>{unitM}</small>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        </aside>
      </div>

      <Notes setup={setup} p={p} />
    </div>
  )
}

// ---------- beban lajur ----------

function lajurEffect(setup: Setup, p: Params, resp: string, st: ReturnType<typeof ilStats>) {
  const maxT = p.q * st.pos + (st.max > 0 ? p.pk * st.max : 0)
  const minT = p.q * st.neg + (st.min < 0 ? p.pk * st.min : 0)
  const full = p.q * (st.pos + st.neg) + (st.max > 0 ? p.pk * st.max : 0)
  // cek matriks: q di bagian bertanda sama dipecah menjadi beban titik (aturan titik tengah) + p di ordinat ekstrem,
  // lalu semua beban dianalisis sekaligus oleh solver kekakuan
  const Lt = trackLength(setup, p)
  const n = 80
  const check = (sign: 1 | -1) => {
    const loads: Load[] = []
    for (let k = 0; k < n; k++) {
      const x = ((k + 0.5) * Lt) / n
      if (ilAt(setup, p, resp, x) * sign > 0) loads.push({ x, P: (p.q * Lt) / n })
    }
    const e = sign > 0 ? st.max : st.min
    if (e * sign > 0 && p.pk) loads.push({ x: sign > 0 ? st.xMax : st.xMin, P: p.pk })
    return loads.length ? matrixEffect(setup, p, resp, loads) : 0
  }
  return { maxT, minT, full, checkMax: check(1), checkMin: check(-1) }
}

// ---------- grafik efek truk ----------

function drawTruckPlot(c: HTMLCanvasElement, setup: Setup, p: Params, resp: string, axles: ReturnType<typeof truckAxles>, X: number) {
  const { w, h, ctx } = fitCanvas(c)
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, w, h)
  const Lt = trackLength(setup, p)
  const r = truckRange(Lt, axles)
  const pts: [number, number][] = []
  for (let k = 0; k <= 300; k++) {
    const x = r.min + ((r.max - r.min) * k) / 300
    pts.push([x, ilEffect(setup, p, resp, truckLoads(x, axles))])
  }
  let lo = Math.min(0, ...pts.map((q) => q[1]))
  let hi = Math.max(0, ...pts.map((q) => q[1]))
  const pad = (hi - lo) * 0.1 || 1
  lo -= lo < 0 ? pad : 0
  hi += pad
  const cur = ilEffect(setup, p, resp, truckLoads(X, axles))
  chart(ctx, 0, 0, w, h, {
    x: [r.min, r.max],
    y: [lo, hi],
    xlabel: 'X gandar depan (m)',
    ylabel: `${respLabel(setup, p, resp)} (${resp === 'M' ? 'kN·m' : 'kN'})`,
    series: [{ pts, color: C.green, label: 'Σ Pᵢ·η(xᵢ)' }],
    vmarks: [{ v: X, color: C.orange }, ...supportsX(setup, p).map((s) => ({ v: s, color: '#c9c6ba' }))],
    hmarks: [{ v: 0, color: C.mute }],
    dots: [{ x: X, y: cur, color: C.orange, label: fmt(cur, 1) }],
  })
}

// ---------- catatan teori di tabel ----------

function theoryNote(setup: Setup, resp: string, rt: ReturnType<typeof findRitter>, names: string[]) {
  if (setup === 'sederhana') return 'Teori: statika (Müller–Breslau) — garis pengaruh balok statis tertentu selalu terdiri dari garis lurus.'
  if (setup === 'menerus')
    return `Teori: persamaan tiga momen untuk beban 1 kN di tiap posisi → momen tumpuan → reaksi → ${resp[0] === 'R' ? 'reaksi' : resp}. Kurva = kubik per bentang.`
  if (resp[0] === 'R') return 'Reaksi rangka sama dengan balok sederhana bentang L.'
  if (!rt) return 'Tidak ditemukan potongan Ritter untuk batang ini.'
  const cut = rt.cut.map((m) => names[m]).join(', ')
  return rt.kind === 'vertikal'
    ? `Teori: potongan melalui ${cut} — batang lain horizontal, jadi ΣFy = 0 memberi N = −V/sin θ. Lantai diteruskan gelagar memanjang ke simpul: garis lurus antar simpul.`
    : `Teori: potongan Ritter melalui ${cut}, ΣM terhadap O (${fmt(rt.O!.x, 2)}; ${fmt(rt.O!.y, 2)}) m: N = M_O / lengan. Garis lurus antar simpul panel.`
}

// ---------- catatan ----------

function Notes({ setup, p }: { setup: Setup; p: Params }) {
  const concept: React.ReactNode[] = [
    <>
      <b>Garis pengaruh</b> (influence line) menunjukkan nilai <i>satu</i> respons di <i>satu</i> titik tetap (reaksi, V atau M di potongan,
      gaya satu batang) ketika beban satuan 1 kN berpindah sepanjang struktur. Berbeda dengan diagram M, yang menunjukkan momen di
      <i> semua</i> titik untuk beban yang diam.
    </>,
    <>
      <b>Superposisi:</b> efek beban apa pun = <code>Σ Pᵢ·η(xᵢ)</code> untuk beban terpusat dan <code>q·∫η dx</code> untuk beban merata.
      Karena itu cukup satu garis pengaruh untuk mencari posisi kendaraan paling menentukan.
    </>,
    <>
      <b>Prinsip Müller–Breslau:</b> garis pengaruh sebuah gaya = bentuk lendutan struktur bila gaya itu dilepas (sendi untuk M, geseran
      untuk V, tumpuan dilepas untuk R) dan diberi perpindahan satuan. Struktur statis tertentu → mekanisme kaku → garis lurus; statis tak
      tentu → lendutan elastis → garis lengkung.
    </>,
  ]
  const tryThis: React.ReactNode[] = []
  if (setup === 'sederhana') {
    tryThis.push(`Pilih M dan geser potongan: ordinat maksimum selalu di bawah potongan = a·b/L. Di tengah bentang: L/4 = ${fmt(p.L / 4, 2)} m.`)
    tryThis.push('Pilih V: ada loncatan sebesar 1 tepat di potongan — sisi kiri −a/L, sisi kanan +b/L. Mengapa tingginya selalu 1?')
    tryThis.push('Beri kantilever c₂: garis pengaruh R_B memanjang melewati 1, R_A menjadi negatif — beban di ujung kantilever mengangkat tumpuan A.')
    tryThis.push('Aktifkan Müller–Breslau: balok berputar kaku sebagai mekanisme, bentuknya persis garis pengaruh.')
  } else if (setup === 'menerus') {
    tryThis.push('Pilih R_B (tumpuan tengah): kurva melengkung dan beban di tengah bentang 1 memberi 11/16 bila bentang sama — bukan 1/2.')
    tryThis.push('Pindahkan potongan M ke tumpuan B: seluruh garis pengaruh negatif. Momen tumpuan selalu hogging untuk beban di mana saja.')
    tryThis.push('Potongan M di tengah bentang 1: bentang 2 memberi ordinat negatif — beban lajur maksimum hanya membebani bentang berselang (pola papan catur).')
    tryThis.push('Bandingkan Truk T dengan beban lajur pada L besar: untuk bentang panjang beban merata lebih menentukan.')
  } else {
    concept.push(
      <>
        <b>Lantai di batang bawah:</b> kendaraan bertumpu pada gelagar memanjang yang meneruskan beban ke simpul panel. Karena itu garis
        pengaruh gaya batang lurus di antara dua simpul berurutan, dan patah hanya di simpul.
      </>,
    )
    tryThis.push('Batang bawah (B) selalu tarik, batang atas (A) selalu tekan: bentuknya = garis pengaruh M di titik O dibagi h.')
    tryThis.push('Diagonal di dekat tengah bentang punya bagian positif dan negatif — bisa bergantian tarik dan tekan saat kendaraan lewat.')
    tryThis.push('Pratt: pilih batang tegak di samping tumpuan (V1). Garis pengaruhnya hanya sebuah segitiga di dua panel: batang penggantung.')
    tryThis.push('Gandakan h: semua ordinat batang tepi menjadi setengahnya; diagonal juga turun karena sin θ membesar.')
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
