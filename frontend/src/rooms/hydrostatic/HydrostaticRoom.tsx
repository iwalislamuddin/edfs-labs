import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt } from '../../lab/chart'
import { fitCanvas } from '../../lab/draw'
import { Segmented, Slider } from '../../ui/controls'
import { drawChart, type CurvedCurves, type GateCurves, type ProbeDot } from './charts'
import {
  arcPoint,
  columnIntegral,
  curvedForce,
  curvedStrips,
  gateCentroid,
  gateSolve,
  openingLevel,
  planeStrips,
  pressure,
  rhoAt,
  surfaceS,
  vesselWeight,
  vesselWidth,
} from './hydro'
import {
  arcOf,
  clampParams,
  CURVES,
  curveDefaults,
  DEFAULTS,
  FLUIDS,
  gammaOf,
  GATE_SHAPES,
  gateOf,
  gateSystem,
  HINGES,
  layers,
  parseQuery,
  RANGES,
  SETUPS,
  toQuery,
  VB,
  VESSELS,
  VH,
  type Curve,
  type Params,
  type Setup,
} from './model'
import { drawStage, toWorld, type Handle, type Layout } from './stage'

const r2 = (v: number, step: number) => Math.round(v / step) * step

export default function HydrostaticRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [dots, setDots] = useState<ProbeDot[]>([])
  const [grabbing, setGrabbing] = useState(false)

  useEffect(() => onQuery(toQuery(setup, p)), [setup, p]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- kurva pintu (terhadap muka air hulu) ----
  const gateKey = [p.gs, p.L, p.b, p.al, p.hd, p.hinge, p.piv, p.W, p.rho, p.g].join(',')
  const gateBase = useMemo(() => {
    if (setup !== 'pintu') return null
    const sys = gateSystem(p)
    const top = p.L * Math.sin((p.al * Math.PI) / 180)
    const hMax = Math.min(15, Math.max(6, 2.4 * top, p.hd + 2))
    const h: number[] = []
    const F: number[] = []
    const P: number[] = []
    const sp: number[] = []
    for (let i = 0; i <= 150; i++) {
      const x = (hMax * i) / 150
      const r = gateSolve({ ...sys, h1: x })
      h.push(x)
      F.push(r.up.F)
      P.push(r.P) // poros: P < 0 berarti pintu membuka (garis memotong nol)
      sp.push(r.up.sp)
    }
    const hOpen = p.hinge === 'poros' ? openingLevel(sys, 1e-3, hMax) : null
    const sc = gateCentroid(gateOf(p)).s
    return { h, F, P, sp, hOpen, sc, L: p.L }
  }, [setup, gateKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const gateCurves: GateCurves | null = useMemo(() => {
    if (!gateBase) return null
    const sys = gateSystem(p)
    const g = gateOf(p)
    const u = planeStrips(g, sys.gamma, surfaceS(g, p.hu))
    const d = planeStrips(g, sys.gamma, surfaceS(g, p.hd))
    const r = gateSolve(sys)
    const M = (u.sp - r.sh) * u.F - (d.sp - r.sh) * d.F + r.Mw
    return { ...gateBase, meas: { F: u.F, P: M / (r.sP - r.sh), sp: u.sp } }
  }, [gateBase, p.hu]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- kurva permukaan lengkung (terhadap muka air) ----
  const curveKey = [p.kind, p.R, p.bw, p.zp, p.hg, p.rho, p.g].join(',')
  const curvedBase = useMemo(() => {
    if (setup !== 'lengkung') return null
    const { arc } = arcOf(p)
    const gamma = gammaOf(p)
    const top = arcPoint(arc, arc.p1)[1]
    const Hmax = p.kind === 'radial' ? top : Math.min(18, Math.max(8, 2.5 * p.R))
    const [ox, oz] = arcPoint(arc, arc.p0)
    const H: number[] = []
    const FH: number[] = []
    const FV: number[] = []
    const R: number[] = []
    const Mc: number[] = []
    const Mo: number[] = []
    for (let i = 0; i <= 80; i++) {
      const x = (Hmax * i) / 80
      const f = curvedForce(arc, gamma, p.bw, x)
      const s = curvedStrips(arc, gamma, p.bw, x, 300, ox, oz)
      H.push(x)
      FH.push(f ? Math.abs(f.Fx) : 0)
      FV.push(f ? Math.abs(f.Fz) : 0)
      R.push(f ? Math.hypot(f.Fx, f.Fz) : 0)
      Mc.push(s.Mc)
      Mo.push(s.Mo)
    }
    return { H, FH, FV, R, Mc, Mo, ox, oz }
  }, [setup, curveKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const curvedCurves: CurvedCurves | null = useMemo(() => {
    if (!curvedBase) return null
    const { arc } = arcOf(p)
    const s = curvedStrips(arc, gammaOf(p), p.bw, p.H, 3000, curvedBase.ox, curvedBase.oz)
    return { ...curvedBase, meas: { FH: Math.abs(s.Fx), FV: Math.abs(s.Fz), Mc: s.Mc, Mo: s.Mo } }
  }, [curvedBase, p.H]) // eslint-disable-line react-hooks/exhaustive-deps

  const live = useRef({ setup, p, dots, gateCurves, curvedCurves })
  live.current = { setup, p, dots, gateCurves, curvedCurves }
  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const layout = useRef<Layout | null>(null)
  const drag = useRef<Handle['id'] | null>(null)

  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const frame = () => {
      const L = live.current
      const c = stageRef.current
      if (c) {
        const { w, h, ctx } = fitCanvas(c)
        layout.current = drawStage(ctx, w, h, { setup: L.setup, p: L.p, t: (performance.now() - t0) / 1e3 })
      }
      const pc = plotRef.current
      if (pc) {
        const { w, h, ctx } = fitCanvas(pc)
        drawChart(ctx, w, h, { setup: L.setup, p: L.p, dots: L.dots, gate: L.gateCurves, curved: L.curvedCurves })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const set = (key: keyof Params) => (val: number) => setP((old) => clampParams({ ...old, [key]: val }))
  const setMany = (o: Partial<Params>) => setP((old) => clampParams({ ...old, ...o }))
  const changeSetup = (s: Setup) => {
    setSetup(s)
    setDots([])
  }

  const record = (q: Params) => {
    const Ls = layers(q)
    const pm = columnIntegral(q.p0 * 1e3, Ls, q.g, q.pd)
    setDots((old) => {
      if (old.some((d) => Math.abs(d.d - q.pd) < (q.h1 + q.h2) / 60)) return old
      return [...old.slice(-39), { d: q.pd, p: pm }]
    })
  }

  // ---- pointer ----
  const local = (e: React.PointerEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }
  const pick = (x: number, y: number): Handle['id'] | null => {
    const l = layout.current
    if (!l) return null
    let best: Handle | null = null
    let bd = 18
    for (const hd of l.handles) {
      const d = Math.hypot(hd.x - x, hd.y - y)
      if (d < bd) {
        bd = d
        best = hd
      }
    }
    if (best) return best.id
    if (live.current.setup === 'tekanan') {
      const [wx, wz] = toWorld(l.view, x, y)
      const q = live.current.p
      if (wz >= 0 && wz <= q.h1 + q.h2 && Math.abs(wx) <= vesselWidth(q.ves, VB, VH, wz) / 2) return 'probe'
    }
    return null
  }
  const apply = (id: Handle['id'], x: number, y: number) => {
    const l = layout.current
    if (!l) return
    const [wx, wz] = toWorld(l.view, x, y)
    const q = live.current.p
    const Ht = q.h1 + q.h2
    switch (id) {
      case 'probe': {
        const z = Math.min(Ht, Math.max(0, wz))
        const hw = (vesselWidth(q.ves, VB, VH, z) / 2) * 0.82
        const next = clampParams({ ...q, pd: r2(Ht - z, 0.01), px: r2(Math.max(-1, Math.min(1, wx / hw)), 0.01) })
        setP(next)
        record(next)
        break
      }
      case 'surf':
        if (q.h1 > 1e-9) setMany({ h1: r2(Math.max(0, wz - q.h2), 0.05) })
        else setMany({ h2: r2(wz, 0.05) })
        break
      case 'iface': {
        const h2 = r2(Math.min(Ht - 0.05, Math.max(0.2, wz)), 0.05)
        setMany({ h2, h1: Ht - h2 })
        break
      }
      case 'hu':
        setMany({ hu: r2(Math.max(0, wz), 0.05) })
        break
      case 'hd':
        setMany({ hd: r2(Math.max(0, wz), 0.05) })
        break
      case 'piv': {
        const a = (q.al * Math.PI) / 180
        const s = q.L - (wx * Math.cos(a) + wz * Math.sin(a))
        setMany({ piv: r2(s / q.L, 0.01) })
        break
      }
      case 'H':
        setMany({ H: r2(Math.max(0.05, wz), 0.05) })
        break
    }
  }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = local(e)
    const id = pick(x, y)
    if (!id) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = id
    setGrabbing(true)
    apply(id, x, y)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = local(e)
    if (!drag.current) {
      const id = pick(x, y)
      e.currentTarget.style.cursor = id ? (id === 'probe' ? 'grab' : 'ns-resize') : 'default'
      return
    }
    apply(drag.current, x, y)
  }
  const onUp = () => {
    drag.current = null
    setGrabbing(false)
  }

  const tip =
    setup === 'tekanan'
      ? 'Tarik titik oranye (probe) di dalam fluida — titik hijau tercatat di grafik. Tarik pegangan biru/kuning untuk mengubah muka & antarmuka.'
      : setup === 'pintu'
        ? `Tarik pegangan untuk mengubah muka air hulu (kiri) dan hilir (kanan)${p.hinge === 'poros' ? ', atau geser poros di pintu' : ''}.`
        : 'Tarik pegangan biru untuk menaikkan/menurunkan muka air. Arsir oranye = badan tekanan (FV).'

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Fluida › <b>Room Hydrostatic</b>
        </span>
        <Segmented value={setup} options={SETUPS.map((x) => ({ id: x.id, label: x.label, title: x.hint }))} onChange={changeSetup} />
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
            <div className="stage-tip wide-only">{tip}</div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>
                {setup === 'tekanan'
                  ? 'Tekanan terhadap ketinggian'
                  : setup === 'pintu'
                    ? 'Gaya pada pintu dan letak pusat tekanan terhadap muka air hulu'
                    : 'Komponen gaya dan momen air terhadap muka air'}
              </b>
              <span style={{ color: 'var(--mute)', fontSize: 13 }}>
                {setup === 'tekanan' ? (
                  <>
                    garis = rumus · hijau = probe (integrasi kolom){' '}
                    {dots.length > 0 && (
                      <button className="btn ghost sm" style={{ padding: '2px 8px', marginLeft: 6 }} onClick={() => setDots([])}>
                        Hapus titik
                      </button>
                    )}
                  </>
                ) : (
                  'garis = rumus · hijau = integrasi pias saat ini'
                )}
              </span>
            </div>
            <canvas ref={plotRef} className="plot" />
          </div>
        </section>

        <aside className="side-col">
          {setup === 'tekanan' && <PressurePanel p={p} set={set} setMany={setMany} onRecord={() => record(p)} />}
          {setup === 'pintu' && <GatePanel p={p} set={set} setMany={setMany} hOpen={gateCurves?.hOpen ?? null} />}
          {setup === 'lengkung' && <CurvedPanel p={p} set={set} setP={setP} />}
          <div className="card">
            <h3>{setup === 'tekanan' ? 'Tekanan & gaya' : setup === 'pintu' ? 'Rumus vs integrasi pias' : 'Rumus vs integrasi p·n·ds'}</h3>
            {setup === 'tekanan' && <PressureTable p={p} />}
            {setup === 'pintu' && <GateTable p={p} meas={gateCurves?.meas ?? null} />}
            {setup === 'lengkung' && <CurvedTable p={p} meas={curvedCurves?.meas ?? null} />}
          </div>
        </aside>
      </div>

      <Notes setup={setup} p={p} />
    </div>
  )
}

// ---------- panel kontrol ----------

type SetFn = (key: keyof Params) => (v: number) => void

function FluidSelect({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const match = FLUIDS.find((f) => f.rho === value)
  return (
    <label className="check" style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
      <span>{label}</span>
      <select className="speed" value={match ? String(match.rho) : ''} onChange={(e) => e.target.value && onChange(Number(e.target.value))}>
        {!match && <option value="">ρ = {fmt(value, 0)}</option>}
        {FLUIDS.map((f) => (
          <option key={f.label} value={f.rho}>
            {f.label} ({f.rho})
          </option>
        ))}
      </select>
    </label>
  )
}

function PressurePanel({ p, set, setMany, onRecord }: { p: Params; set: SetFn; setMany: (o: Partial<Params>) => void; onRecord: () => void }) {
  return (
    <>
      <div className="card">
        <h3>Fluida &amp; bejana</h3>
        <FluidSelect label="Fluida bawah" value={p.rho} onChange={set('rho')} />
        <Slider label="Rapat massa bawah" symbol="ρ₂" unit="kg/m³" value={p.rho} {...RANGES.rho} onChange={set('rho')} />
        <Slider label="Tebal fluida bawah" symbol="h₂" unit="m" value={p.h2} {...RANGES.h2} onChange={set('h2')} />
        <FluidSelect label="Fluida atas" value={p.rho1} onChange={set('rho1')} />
        <Slider label="Rapat massa atas" symbol="ρ₁" unit="kg/m³" value={p.rho1} {...RANGES.rho1} onChange={set('rho1')} />
        <Slider label="Tebal fluida atas (0 = satu fluida)" symbol="h₁" unit="m" value={p.h1} {...RANGES.h1} onChange={set('h1')} />
        <div style={{ marginBottom: 12 }}>
          <Segmented value={p.ves} options={VESSELS} onChange={(v) => setMany({ ves: v })} />
        </div>
        <Slider label="Tekanan di atas muka (relatif)" symbol="p₀" unit="kPa" value={p.p0} {...RANGES.p0} onChange={set('p0')} />
        <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
          <button className="btn ghost sm" onClick={() => setMany({ p0: 0 })}>
            Terbuka
          </button>
          <button className="btn ghost sm" onClick={() => setMany({ p0: 50 })}>
            Tertutup 50 kPa
          </button>
          <button className="btn ghost sm" onClick={() => setMany({ p0: -20 })}>
            Vakum −20 kPa
          </button>
        </div>
        <Slider label="Gravitasi" symbol="g" unit="m/s²" value={p.g} {...RANGES.g} onChange={set('g')} hint="Bumi 9,81 · Bulan 1,62 · Mars 3,71" />
      </div>
      <div className="card">
        <h3>Probe</h3>
        <Slider label="Kedalaman dari muka teratas" symbol="d" unit="m" value={p.pd} min={0} max={Math.round((p.h1 + p.h2) * 100) / 100} step={0.01} onChange={set('pd')} />
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button className="btn ghost sm" onClick={onRecord}>
            Catat titik
          </button>
          <button className="btn ghost sm" onClick={() => setMany({ pd: p.h1 + p.h2 })}>
            Ke dasar
          </button>
          {p.h1 > 0 && (
            <button className="btn ghost sm" onClick={() => setMany({ pd: p.h1 })}>
              Ke antarmuka
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function GatePanel({ p, set, setMany, hOpen }: { p: Params; set: SetFn; setMany: (o: Partial<Params>) => void; hOpen: number | null }) {
  return (
    <>
      <div className="card">
        <h3>Pintu</h3>
        <div style={{ marginBottom: 12 }}>
          <Segmented value={p.gs} options={GATE_SHAPES} onChange={(v) => setMany({ gs: v })} />
        </div>
        <Slider label={p.gs === 'lingkaran' ? 'Diameter' : 'Panjang (sepanjang kemiringan)'} symbol={p.gs === 'lingkaran' ? 'D' : 'L'} unit="m" value={p.L} {...RANGES.L} onChange={set('L')} />
        {p.gs !== 'lingkaran' && (
          <Slider label={p.gs === 'segitiga' ? 'Lebar alas (puncak di atas)' : 'Lebar'} symbol="b" unit="m" value={p.b} {...RANGES.b} onChange={set('b')} />
        )}
        <Slider label="Kemiringan terhadap horizontal" symbol="α" unit="°" value={p.al} {...RANGES.al} onChange={set('al')} />
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button className="btn ghost sm" onClick={() => setMany({ al: 90 })}>
            Tegak
          </button>
          <button className="btn ghost sm" onClick={() => setMany({ gs: DEFAULTS.gs, L: DEFAULTS.L, b: DEFAULTS.b, al: DEFAULTS.al, hu: DEFAULTS.hu, hd: 0, W: 0 })}>
            Bawaan
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Air</h3>
        <Slider label="Muka air hulu di atas ambang" symbol="h₁" unit="m" value={p.hu} {...RANGES.hu} onChange={set('hu')} />
        <Slider label="Muka air hilir di atas ambang" symbol="h₂" unit="m" value={p.hd} {...RANGES.hd} onChange={set('hd')} />
        <FluidSelect label="Fluida" value={p.rho} onChange={set('rho')} />
      </div>
      <div className="card">
        <h3>Tumpuan</h3>
        <div style={{ marginBottom: 12 }}>
          <Segmented value={p.hinge} options={HINGES} onChange={(v) => setMany({ hinge: v })} />
        </div>
        {p.hinge === 'poros' && (
          <>
            <Slider label="Letak poros dari tepi atas (× L)" symbol="sₚ/L" unit="" value={p.piv} {...RANGES.piv} onChange={set('piv')} />
            <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
              <button className="btn ghost sm" disabled={hOpen === null} onClick={() => hOpen !== null && setMany({ hu: Math.round(hOpen * 100) / 100 })}>
                {hOpen === null ? 'Tidak pernah membuka' : `Ke muka air buka (${fmt(hOpen, 2)} m)`}
              </button>
            </div>
          </>
        )}
        <Slider label="Berat sendiri pintu" symbol="W" unit="kN" value={p.W} {...RANGES.W} onChange={set('W')} />
      </div>
    </>
  )
}

function CurvedPanel({ p, set, setP }: { p: Params; set: SetFn; setP: (f: (o: Params) => Params) => void }) {
  return (
    <div className="card">
      <h3>Permukaan lengkung</h3>
      <div style={{ marginBottom: 12 }}>
        <Segmented
          value={p.kind}
          options={CURVES.map((c) => ({ id: c.id, label: c.label, title: c.title }))}
          onChange={(k: Curve) => setP((o) => clampParams(curveDefaults(k, o)))}
        />
      </div>
      <Slider label="Jari-jari busur" symbol="R" unit="m" value={p.R} {...RANGES.R} onChange={set('R')} />
      {p.kind === 'radial' && (
        <>
          <Slider label="Tinggi poros di atas ambang" symbol="zₒ" unit="m" value={p.zp} {...RANGES.zp} onChange={set('zp')} />
          <Slider label="Tinggi pintu" symbol="hg" unit="m" value={p.hg} {...RANGES.hg} onChange={set('hg')} />
        </>
      )}
      <Slider label="Lebar (tegak lurus gambar)" symbol="b" unit="m" value={p.bw} {...RANGES.bw} onChange={set('bw')} />
      <Slider
        label="Muka air di atas lantai"
        symbol="H"
        unit="m"
        value={p.H}
        min={RANGES.H.min}
        max={p.kind === 'radial' ? Math.round(p.hg * 100) / 100 : RANGES.H.max}
        step={RANGES.H.step}
        onChange={set('H')}
      />
      <FluidSelect label="Fluida" value={p.rho} onChange={set('rho')} />
    </div>
  )
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
        {rows.map(([lab, a, b, u, d = 2]) => (
          <tr key={lab}>
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

function PressureTable({ p }: { p: Params }) {
  const Ls = layers(p)
  const Ht = p.h1 + p.h2
  const p0 = p.p0 * 1e3
  const pp = pressure(p0, Ls, p.g, p.pd)
  const pm = columnIntegral(p0, Ls, p.g, p.pd)
  const rho = rhoAt(Ls, p.pd)
  const pb = pressure(p0, Ls, p.g, Ht)
  const W = useMemo(() => vesselWeight(p.ves, VB, VH, Ls, p.g), [p.ves, p.h1, p.h2, p.rho, p.rho1, p.g]) // eslint-disable-line react-hooks/exhaustive-deps
  const Fb = pb * VB
  const z = Ht - p.pd
  const rows: Row[] = [
    ['p di probe', pp / 1e3, pm / 1e3, 'kPa'],
    ['p absolut (+101,3 kPa)', pp / 1e3 + 101.325, null, 'kPa'],
    ['Tinggi tekanan p/(ρg)', pp / (rho * p.g), null, 'm'],
    ['Tinggi piezometrik z + p/(ρg)', z + pp / (rho * p.g), null, 'm'],
    ['Setara kolom air p/γw', pp / (1000 * p.g), null, 'm air'],
  ]
  if (p.h1 > 1e-9) rows.push(['p di antarmuka', pressure(p0, Ls, p.g, p.h1) / 1e3, columnIntegral(p0, Ls, p.g, p.h1) / 1e3, 'kPa'])
  rows.push(['p di dasar', pb / 1e3, columnIntegral(p0, Ls, p.g, Ht) / 1e3, 'kPa'])
  rows.push(['Gaya di dasar F = p·A', Fb / 1e3, null, 'kN/m', 1])
  rows.push(['Berat fluida W (+ p₀ tutup)', null, (W + p0 * vesselWidth(p.ves, VB, VH, Ht)) / 1e3, 'kN/m', 1])
  rows.push(['F / (W + p₀·A muka)', Fb / (W + p0 * vesselWidth(p.ves, VB, VH, Ht)), null, '', 3])
  return (
    <>
      <Readout rows={rows} first="Rumus" second="Integrasi" />
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Kolom kanan: berat kolom fluida di atas titik dijumlahkan per pias tipis (2000 pias) dan berat isi bejana per pias
        horizontal. Lebar dasar bejana {fmt(VB, 1)} m, per 1 m tegak lurus gambar.
      </small>
    </>
  )
}

function GateTable({ p, meas }: { p: Params; meas: { F: number; P: number; sp: number } | null }) {
  const sys = gateSystem(p)
  const g = gateOf(p)
  const r = gateSolve(sys)
  const u = r.up
  const sa = Math.sin((p.al * Math.PI) / 180)
  const ca = Math.cos((p.al * Math.PI) / 180)
  const d2 = planeStrips(g, sys.gamma, surfaceS(g, p.hd))
  const rows: Row[] = [
    ['Luas basah A', u.A, null, 'm²', 3],
    ['Jarak miring muka → G, yc', u.yc, null, 'm', 3],
    ['Kedalaman G, hc = yc·sin α', u.hc, null, 'm', 3],
    ['Ic luas basah', u.Ic, null, 'm⁴', 4],
    ['F = γ·hc·A', u.F / 1e3, meas ? meas.F / 1e3 : null, 'kN'],
    ['yp = yc + Ic/(yc·A)', u.yp, meas && u.F > 0 ? meas.sp - surfaceS(g, p.hu) : null, 'm', 3],
    ['CP di bawah G: Ic/(yc·A)', u.yp - u.yc, null, 'm', 3],
    ['Kedalaman CP hp', u.hp, null, 'm', 3],
    ['FH = F·sin α', (u.F * sa) / 1e3, null, 'kN'],
    ['FV = F·cos α (berat air di atas)', (u.F * ca) / 1e3, null, 'kN'],
  ]
  if (p.hd > 0) rows.push(['F₂ hilir', r.down.F / 1e3, d2.F / 1e3, 'kN'])
  rows.push(['M terhadap engsel/poros', r.M / 1e3, null, 'kN·m'])
  rows.push([r.open ? 'P (pintu membuka)' : 'P penahan', r.P / 1e3, meas ? meas.P / 1e3 : null, 'kN'])
  rows.push(['Reaksi engsel ⊥ pintu', r.Rn / 1e3, null, 'kN'])
  return (
    <>
      <Readout rows={rows} first="Rumus" second="Pias" />
      <p style={{ fontSize: 13, margin: '8px 0 0' }}>
        {p.hinge === 'poros' ? (
          r.open ? (
            <>
              <b style={{ color: 'var(--orange)' }}>Pintu terbuka:</b> pusat tekanan sudah di atas poros, momen air membalik dan stop di
              tepi bawah tidak bisa menarik.
            </>
          ) : (
            <>
              Pintu tertutup: pusat tekanan masih di bawah poros ({fmt(u.sp - p.piv * p.L, 3)} m), stop di tepi bawah menahan P.
            </>
          )
        ) : r.P < 0 ? (
          <>P negatif: air hilir lebih menentukan — tumpuan harus ada di sisi hulu.</>
        ) : (
          <>P = momen terhadap engsel ÷ jarak engsel–tumpuan ({fmt(Math.abs(r.sP - r.sh), 2)} m).</>
        )}
      </p>
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Kolom kanan: pintu dibagi 800 pias sejajar muka air, Σ γ·h·b·Δs dan momennya. Jarak miring diukur sepanjang pintu dari garis
        muka air (diperpanjang).
      </small>
    </>
  )
}

function CurvedTable({ p, meas }: { p: Params; meas: { FH: number; FV: number; Mc: number; Mo: number } | null }) {
  const { arc } = arcOf(p)
  const gamma = gammaOf(p)
  const f = curvedForce(arc, gamma, p.bw, p.H)
  if (!f) return <p style={{ fontSize: 13 }}>Muka air di bawah permukaan lengkung — tidak ada gaya.</p>
  const R = Math.hypot(f.Fx, f.Fz)
  const th = (Math.atan2(Math.abs(f.Fz), Math.abs(f.Fx)) * 180) / Math.PI
  const rows: Row[] = [
    ['Proyeksi tegak Aproj = b·Δz', f.Aproj, null, 'm²', 3],
    ['hc proyeksi', f.hcProj, null, 'm', 3],
    ['FH = γ·hc·Aproj', Math.abs(f.Fx) / 1e3, meas ? meas.FH / 1e3 : null, 'kN'],
    ['Kedalaman garis kerja FH', f.hFH, null, 'm', 3],
    ['Luas badan tekanan', f.Abody, null, 'm²', 3],
    ['Volume V = luas·b', f.Abody * p.bw, null, 'm³', 3],
    [`FV = γ·V ${f.Fz > 0 ? '(↑)' : '(↓)'}`, Math.abs(f.Fz) / 1e3, meas ? meas.FV / 1e3 : null, 'kN'],
    ['x garis kerja FV (dari O)', f.xFV - arc.cx, null, 'm', 3],
    ['R = √(FH² + FV²)', R / 1e3, meas ? Math.hypot(meas.FH, meas.FV) / 1e3 : null, 'kN'],
    ['Sudut R thd horizontal', th, null, '°', 1],
    ['M air thd pusat O', 0, meas ? meas.Mc / 1e3 : null, 'kN·m', 3],
    ['M air thd ambang', null, meas ? meas.Mo / 1e3 : null, 'kN·m', 1],
  ]
  return (
    <>
      <Readout rows={rows} first="Rumus" second="Integrasi" />
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Kolom kanan: busur basah dibagi 3000 segmen, Σ p·n·ds. Setiap gaya tekanan tegak lurus busur lingkaran sehingga melewati pusat O —
        momen terhadap O nol, resultan pun lewat O.
      </small>
    </>
  )
}

// ---------- catatan ----------

function Notes({ setup, p }: { setup: Setup; p: Params }) {
  const concept: React.ReactNode[] = []
  const tryThis: React.ReactNode[] = []
  if (setup === 'tekanan') {
    concept.push(
      <>
        <b>Hukum hidrostatis</b> dp/dz = −ρg: tekanan naik linear terhadap kedalaman, <code>p = p₀ + ρ·g·h</code>, sama ke segala arah dan
        hanya bergantung pada kedalaman — bukan bentuk bejana.
      </>,
      <>
        <b>Fluida berlapis:</b> kemiringan diagram p berubah di antarmuka (ρ berbeda), tetapi p tetap kontinu. p = p₀ + Σρᵢ·g·hᵢ.
      </>,
      <>
        <b>Piezometer</b> naik setinggi p/(ρg) di atas titik sadap. Di fluida yang sama, puncak semua piezometer sejajar (tinggi piezometrik
        z + p/ρg konstan); di lapisan bawah yang lebih berat puncaknya lebih rendah dari muka bebas.
      </>,
      <>
        <b>Paradoks hidrostatis:</b> gaya di dasar F = p·A bisa jauh lebih besar atau lebih kecil dari berat fluida. Selisihnya dipikul
        dinding miring bejana (komponen tegak gaya tekanan di dinding).
      </>,
    )
    tryThis.push('Set h₁ = 0 lalu tarik probe naik-turun: titik hijau membentuk garis lurus dengan kemiringan 1/(ρg).')
    tryThis.push('Pilih Raksa untuk fluida bawah: 1 m raksa ≈ 13,6 m air — garis tekanan menjadi jauh lebih landai.')
    tryThis.push('Ganti bejana Tegak → Melebar → Leher sempit: p dasar dan F dasar tidak berubah, berat W berubah besar.')
    tryThis.push('Tekan "Tertutup 50 kPa": seluruh diagram bergeser 50 kPa dan piezometer naik ≈ 5,1 m lebih tinggi.')
    tryThis.push('Pilih "Vakum −20 kPa": tekanan di dekat muka negatif (piezometer tidak naik), nol di kedalaman ≈ 2 m.')
  } else if (setup === 'pintu') {
    concept.push(
      <>
        <b>Gaya resultan</b> pada bidang terendam <code>F = γ·hc·A</code>: tekanan di titik berat dikali luas, apa pun bentuk dan kemiringannya.
      </>,
      <>
        <b>Pusat tekanan</b> selalu di bawah titik berat: <code>yp = yc + Ic/(yc·A)</code> (jarak miring dari garis muka). Makin dalam pintu,
        Ic/(yc·A) makin kecil dan CP mendekati G.
      </>,
      <>
        <b>Terendam sebagian:</b> hanya luas basah yang dihitung; pintu persegi tegak dengan air sampai ambang memberi F = γ·b·h²/2 di h/3 dari
        bawah (prisma tekanan segitiga).
      </>,
      <>
        <b>Pintu otomatis:</b> bila poros di bawah titik berat pintu, CP yang naik ke arah G suatu saat melewati poros — momen air membalik
        dan pintu membuka sendiri pada muka air tertentu.
      </>,
    )
    tryThis.push('Pintu tegak, engsel atas, naikkan h₁ dari 0: P naik dengan kubik saat terendam sebagian, lalu linear setelah terendam penuh.')
    tryThis.push('Bandingkan Persegi, Lingkaran, Segitiga dengan L sama: Ic/A berbeda → jarak CP–G berbeda (lihat tampak depan).')
    tryThis.push('Kecilkan α ke 30°: komponen FV = berat air di atas pintu membesar, F tetap γ·hc·A.')
    tryThis.push('Beri air hilir h₂ = h₁: kedua prisma sama, gaya bersih nol — P → 0 (selain akibat berat pintu).')
    tryThis.push('Pilih Poros (otomatis), poros 0,6·L, tekan "Ke muka air buka" lalu naikkan h₁ sedikit: pintu terbuka.')
    if (p.hinge === 'poros' && p.piv <= 0.5) tryThis.push('Poros di atas titik berat (sₚ/L ≤ 0,5 untuk persegi): CP tidak pernah melewatinya — pintu tidak pernah membuka.')
  } else {
    concept.push(
      <>
        <b>Komponen horizontal</b> FH = gaya pada proyeksi tegak permukaan: <code>FH = γ·hc·Aproj</code>, garis kerjanya di pusat tekanan
        proyeksi.
      </>,
      <>
        <b>Komponen vertikal</b> FV = berat fluida (nyata atau khayal) di antara permukaan dan muka bebas: <code>FV = γ·V</code>, lewat titik
        berat badan tekanan.
      </>,
      <>
        <b>Badan tekanan khayal:</b> bila air berada di bawah permukaan (permukaan menghadap ke bawah), FV mengarah ke atas dan besarnya sama
        dengan berat air yang <i>seandainya</i> mengisi ruang di atas permukaan sampai muka air.
      </>,
      <>
        <b>Busur lingkaran:</b> setiap gaya tekanan tegak lurus busur → lewat pusat O. Pintu radial memanfaatkannya: momen air terhadap poros
        nol, sehingga pengangkat hanya melawan berat pintu dan gesekan poros.
      </>,
    )
    tryThis.push('Pintu radial: naikkan H — momen thd ambang membesar cepat, momen thd pusat O tetap ≈ 0 (grafik kanan).')
    tryThis.push('Kuadran cekung vs cembung dengan R dan H sama: FH sama persis, FV berbeda sebesar luas (R² − πR²/4 vs πR²/4)·b·γ.')
    tryThis.push('Kuadran menggantung: FV ke atas — badan tekanan khayal di atas permukaan.')
    tryThis.push('Turunkan H di bawah puncak busur: hanya bagian basah yang dihitung, proyeksi tegak memendek.')
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
