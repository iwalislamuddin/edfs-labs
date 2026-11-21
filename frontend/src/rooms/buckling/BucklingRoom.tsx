import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { Check, Segmented, Slider } from '../../ui/controls'
import { RANGES as SEC_RANGES } from '../section/model'
import {
  buildFE,
  elastica,
  elasticaRatio,
  elasticaTheory,
  feBuckling,
  firstYield,
  imperfect,
  imperfectTheory,
  kEff,
  kFromRatio,
  pcr,
  perry,
  sniFcr,
  sniLimit,
  southwell,
  support,
  theoryAvailable,
  type Support,
} from './buckling'
import { drawChart, type ChartState } from './charts'
import {
  AXES,
  clampParams,
  clampSec,
  column,
  DIM_LABEL,
  fixSupport,
  MATERIALS,
  parseQuery,
  RANGES,
  secDefault,
  SETUPS,
  SHAPE_DIMS,
  SHAPES,
  supportsFor,
  toQuery,
  type Axis,
  type Column,
  type Params,
  type SecParams,
  type Setup,
  type Shape,
} from './model'
import { drawStage, fmt, type StageState } from './stage'

type Pt = { P: number; d: number }

export default function BucklingRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [sup, setSup] = useState<Support>(init.sup)
  const [shape, setShape] = useState<Shape>(init.shape)
  const [ax, setAx] = useState<Axis>(init.ax)
  const [sec, setSec] = useState<SecParams>(init.sec)
  const [p, setP] = useState<Params>(init.p)
  const [pts, setPts] = useState<Pt[]>([])
  const [testing, setTesting] = useState(false)
  const [grabbing, setGrabbing] = useState(false)

  useEffect(() => onQuery(toQuery({ setup, sup, shape, ax, sec, p })), [setup, sup, shape, ax, sec, p]) // eslint-disable-line react-hooks/exhaustive-deps

  const secKey = SHAPE_DIMS[shape].map((k) => sec[k]).join(',')
  const col = useMemo(() => column(shape, sec, setup === 'elastica' ? 'min' : ax), [shape, secKey, ax, setup]) // eslint-disable-line react-hooks/exhaustive-deps
  const Lmm = p.L * 1000
  const Emp = p.E * 1000
  const EI = Emp * col.I
  const P = p.P * 1000
  const Pcr = pcr(sup, EI, Lmm)
  const fe = useMemo(() => buildFE(sup, EI, Lmm, 24), [sup, EI, Lmm])
  const feB = useMemo(() => feBuckling(fe, 3), [fe])

  // Imperfeksi
  const Pimp = Math.min(P, 0.995 * Pcr)
  const imp = useMemo(() => (setup === 'imperfeksi' ? imperfect(fe, sup, Pimp, p.e0, p.e) : null), [setup, fe, sup, Pimp, p.e0, p.e])
  const avail = theoryAvailable(sup, p.e)
  const PyTh = useMemo(
    () => (avail ? firstYield((q) => imperfectTheory(sup, EI, Lmm, q, p.e0, p.e).M, col.A, col.S, p.fy, Pcr) : null),
    [avail, sup, EI, Lmm, p.e0, p.e, col.A, col.S, p.fy, Pcr],
  )
  const PyFE = useMemo(
    () => (setup === 'imperfeksi' ? firstYield((q) => imperfect(fe, sup, q, p.e0, p.e).Mmax, col.A, col.S, p.fy, Pcr) : 0),
    [setup, fe, sup, p.e0, p.e, col.A, col.S, p.fy, Pcr],
  )

  // Elastica
  const kEl = kFromRatio(p.r)
  const ela = useMemo(() => (setup === 'elastica' && p.r > 1 ? elastica(sup, kEl) : null), [setup, sup, kEl, p.r])

  // reset data uji bila eksperimen berubah
  useEffect(() => {
    setPts([])
    setTesting(false)
  }, [sup, shape, secKey, ax, p.L, p.E, p.e0, p.e, setup]) // eslint-disable-line react-hooks/exhaustive-deps

  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const amp = useRef(0)
  const live = useRef<{ st: Omit<StageState, 'amp'>; ch: ChartState; targetAmp: number; test: boolean; Pcr: number; PyFE: number; P: number }>(null!)
  const ptsRef = useRef<Pt[]>(pts)
  ptsRef.current = pts

  // amplitude tekuk nyata (Euler, P ≥ Pcr) dari elastica (sendi/jepit eksak, jepit–bebas eksak, jepit–sendi pendekatan)
  const ratio = P / Pcr
  let targetAmp = 0
  if (setup === 'euler' && ratio >= 1) {
    const k = kFromRatio(ratio)
    const th = elasticaTheory(sup === 'jepit-sendi' ? 'sendi' : sup, k)
    targetAmp = th.d * Lmm * (sup === 'jepit-sendi' ? support(sup).K : 1)
  }

  const Kuse = p.kr ? support(sup).Krec : support(sup).K
  live.current = {
    st: {
      setup,
      sup,
      n: setup === 'euler' ? p.n : 1,
      L: Lmm,
      col,
      P: setup === 'kurva' ? sniFcr((Kuse * Lmm) / col.r, Emp, p.fy).Fcr * col.A : setup === 'elastica' ? p.r * Pcr : setup === 'imperfeksi' ? Pimp : P,
      Pcr,
      feMode: setup === 'euler' ? feB.w[p.n - 1] : null,
      imp,
      e0: p.e0,
      e: p.e,
      fy: p.fy,
      ela: ela ? { pts: ela.pts, d: ela.d, short: ela.short } : null,
      label:
        setup === 'kurva'
          ? `Pn = ${fmt((sniFcr((Kuse * Lmm) / col.r, Emp, p.fy).Fcr * col.A) / 1e3, 1)} kN`
          : setup === 'elastica'
            ? `P = ${fmt(p.r, 3)}·Pcr`
            : `P = ${fmt((setup === 'imperfeksi' ? Pimp : P) / 1e3, 1)} kN`,
    },
    ch: {
      setup,
      sup,
      EI,
      L: Lmm,
      A: col.A,
      S: col.S,
      r: col.r,
      c: col.c,
      E: Emp,
      fy: p.fy,
      P: setup === 'imperfeksi' ? Pimp : P,
      Pcr,
      K: Kuse,
      e0: p.e0,
      e: p.e,
      pts,
      Py: PyTh,
      ratio: p.r,
      ela: ela ? { d: ela.d, short: ela.short } : null,
    },
    targetAmp,
    test: testing,
    Pcr,
    PyFE,
    P: Pimp,
  }

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastRec = -1
    const frame = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
      last = now
      const Lv = live.current
      amp.current += (Lv.targetAmp - amp.current) * Math.min(1, dt * 5)
      if (Lv.targetAmp === 0 && amp.current < 0.01) amp.current = 0
      // uji tekan: P naik perlahan, titik dicatat tiap 4% Pcr
      if (Lv.test) {
        const stop = Math.min(0.97 * Lv.Pcr, Lv.PyFE)
        const next = Math.min(stop, Lv.P + (Lv.Pcr / 9) * dt)
        const step = 0.04 * Lv.Pcr
        if (Math.floor(next / step) !== lastRec || next >= stop) {
          lastRec = Math.floor(next / step)
          const fe = buildFE(Lv.st.sup, Lv.ch.EI, Lv.ch.L, 24)
          const d = imperfect(fe, Lv.st.sup, next, Lv.ch.e0, Lv.ch.e).dMax
          setPts((old) => [...old.filter((q) => Math.abs(q.P - next) > step * 0.3), { P: next, d }].sort((a, b) => a.P - b.P))
        }
        setP((old) => ({ ...old, P: Math.round(next / 10) / 100 }))
        if (next >= stop) setTesting(false)
      } else lastRec = -1
      const c = stageRef.current
      if (c) {
        const { w, h, ctx } = fitCanvas(c)
        drawStage(ctx, w, h, { ...Lv.st, amp: amp.current })
      }
      const pc = plotRef.current
      if (pc) {
        const { w, h, ctx } = fitCanvas(pc)
        drawChart(ctx, w, h, Lv.ch)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- aksi ----
  const set = (key: keyof Params) => (v: number) => setP((o) => clampParams({ ...o, [key]: v }))
  const setDim = (key: keyof SecParams) => (v: number) => setSec((o) => clampSec(shape, { ...o, [key]: v }))
  const changeSetup = (s: Setup) => {
    setSetup(s)
    setSup((old) => fixSupport(s, old))
    if (s === 'imperfeksi') setP((o) => ({ ...o, P: 0 }))
  }
  const changeShape = (s: Shape) => {
    setShape(s)
    setSec(secDefault(s))
  }
  const Pmax = Math.max(1, Math.ceil((setup === 'imperfeksi' ? 0.99 : 1.6) * (Pcr / 1e3)))
  const startTest = () => {
    setPts([])
    setP((o) => ({ ...o, P: 0 }))
    setTesting(true)
  }
  const record = () => {
    if (!imp || Pimp <= 0) return
    setPts((old) => [...old.filter((q) => Math.abs(q.P - Pimp) > 1), { P: Pimp, d: imp.dMax }].sort((a, b) => a.P - b.P))
  }

  // drag vertikal di panggung = menekan / melepas beban
  const drag = useRef<{ y: number; v: number } | null>(null)
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (setup === 'kurva') return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, v: setup === 'elastica' ? p.r : p.P }
    setTesting(false)
    setGrabbing(true)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) {
      e.currentTarget.style.cursor = setup === 'kurva' ? 'default' : 'ns-resize'
      return
    }
    const h = e.currentTarget.clientHeight
    const dy = (e.clientY - drag.current.y) / (h * 0.7)
    if (setup === 'elastica') set('r')(Math.round(Math.min(3.5, Math.max(0, drag.current.v + dy * 3)) * 200) / 200)
    else set('P')(Math.round(Math.min(Pmax, Math.max(0, drag.current.v + dy * Pmax)) * 10) / 10)
  }
  const onUp = () => {
    drag.current = null
    setGrabbing(false)
  }

  const sp = support(sup)
  const tip =
    setup === 'kurva'
      ? 'Panah = kuat tekan nominal Pn menurut SNI 1729. Ubah L, K, atau mutu baja untuk berpindah sepanjang kurva.'
      : setup === 'elastica'
        ? 'Tarik ke bawah/atas untuk menambah/mengurangi beban P/Pcr. Bentuk digambar dengan skala nyata.'
        : setup === 'imperfeksi'
          ? 'Tarik ke bawah untuk menekan kolom, atau jalankan "Uji tekan". Lendutan lateral diperbesar.'
          : 'Tarik ke bawah/atas untuk mengubah P. Putus-putus oranye = mode tekuk, titik biru = vektor eigen matriks.'

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Material &amp; Elemen › <b>Room Buckling</b>
        </span>
        <Segmented value={setup} options={SETUPS.map((x) => ({ id: x.id, label: x.label, title: x.hint }))} onChange={changeSetup} />
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
              style={{ height: 520 }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            <div className="stage-tip wide-only" style={setup === 'imperfeksi' ? { bottom: 44 } : undefined}>
              {tip}
            </div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>
                {setup === 'euler'
                  ? 'Beban kritis terhadap panjang kolom (hiperbola Euler) untuk 4 tumpuan'
                  : setup === 'imperfeksi'
                    ? 'Uji tekan: kurva beban–lendutan dan plot Southwell'
                    : setup === 'kurva'
                      ? 'Kurva kolom: tegangan kritis terhadap kelangsingan'
                      : 'Kurva pasca-tekuk: beban naik sangat sedikit walau lendutan besar'}
              </b>
              <span style={{ color: 'var(--mute)', fontSize: 13 }}>
                {setup === 'euler'
                  ? 'Pcr = π²EI/(KL)²'
                  : setup === 'imperfeksi'
                    ? 'δ = e0·α/(1−α) · δ = Pcr·(δ/P) − e0'
                    : setup === 'kurva'
                      ? 'λc ≤ 1,5: Fcr = 0,658^(fy/Fe)·fy · lainnya 0,877·Fe'
                      : 'P/Pcr = (2K(k)/π)², k = sin(α/2)'}
              </span>
            </div>
            <canvas ref={plotRef} className="plot" style={setup === 'imperfeksi' ? { height: 300 } : undefined} />
          </div>
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Kolom &amp; tumpuan</h3>
            <div style={{ marginBottom: 12 }}>
              <Segmented value={sup} options={supportsFor(setup).map((x) => ({ id: x.id, label: x.label, title: `K teori ${fmt(x.K, 3)} · rekomendasi ${x.Krec}` }))} onChange={setSup} />
            </div>
            <Slider label="Panjang kolom" symbol="L" unit="m" value={p.L} {...RANGES.L} onChange={set('L')} />
            <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
              {MATERIALS.map((m) => (
                <button key={m.label} className="btn ghost sm" onClick={() => setP((o) => clampParams({ ...o, E: m.E, fy: m.fy }))}>
                  {m.label}
                </button>
              ))}
            </div>
            <Slider label="Modulus elastisitas" symbol="E" unit="GPa" value={p.E} {...RANGES.E} onChange={set('E')} />
            {setup !== 'elastica' && (
              <Slider label="Tegangan leleh" symbol="fy" unit="MPa" value={p.fy} {...RANGES.fy} onChange={set('fy')} hint="BJ 37: 240 · BJ 41: 250 · BJ 50: 290 · BJ 55: 410" />
            )}
          </div>

          <div className="card">
            <h3>Penampang</h3>
            <div style={{ marginBottom: 12 }}>
              <Segmented value={shape} options={SHAPES.map((x) => ({ id: x.id, label: x.label }))} onChange={changeShape} />
            </div>
            {SHAPE_DIMS[shape].map((k) => {
              const [lab, sym] = DIM_LABEL[k]!
              return <Slider key={k} label={lab} symbol={sym} unit="mm" value={sec[k]} {...SEC_RANGES[k]} onChange={setDim(k)} />
            })}
            {setup !== 'elastica' && (
              <>
                <div style={{ fontSize: 13, color: 'var(--mute)', margin: '4px 0 6px' }}>Sumbu tekuk (lentur terhadap)</div>
                <Segmented value={ax} options={AXES.map((x) => ({ id: x.id, label: x.label, title: x.title }))} onChange={setAx} />
              </>
            )}
          </div>

          {setup === 'euler' && (
            <div className="card">
              <h3>Beban &amp; mode</h3>
              <Slider label="Beban tekan" symbol="P" unit="kN" value={Math.min(p.P, Pmax)} min={0} max={Pmax} step={Pmax > 200 ? 1 : 0.1} onChange={set('P')} />
              <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
                <button className="btn ghost sm" onClick={() => set('P')(Math.round(Pcr / 100) / 10)}>
                  P = Pcr
                </button>
                <button className="btn ghost sm" onClick={() => set('P')(Math.round((0.5 * Pcr) / 100) / 10)}>
                  P = ½Pcr
                </button>
                <button className="btn ghost sm" onClick={() => set('P')(Math.round((1.1 * Pcr) / 100) / 10)}>
                  P = 1,1·Pcr
                </button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--mute)', marginBottom: 6 }}>Mode tekuk yang digambar</div>
              <Segmented
                value={String(p.n) as '1' | '2' | '3'}
                options={[1, 2, 3].map((n) => ({ id: String(n) as '1' | '2' | '3', label: `Mode ${n}` }))}
                onChange={(v) => set('n')(Number(v))}
              />
            </div>
          )}

          {setup === 'imperfeksi' && (
            <div className="card">
              <h3>Imperfeksi &amp; uji tekan</h3>
              <Slider label="Lengkung awal (di titik maks)" symbol="e0" unit="mm" value={p.e0} {...RANGES.e0} onChange={set('e0')} />
              <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
                <button className="btn ghost sm" onClick={() => set('e0')(Math.round(Lmm / 100) / 10)} title="toleransi kelurusan fabrikasi">
                  e0 = L/1000
                </button>
                <button className="btn ghost sm" onClick={() => set('e0')(0)}>
                  e0 = 0
                </button>
              </div>
              <Slider
                label="Eksentrisitas beban"
                symbol="e"
                unit="mm"
                value={p.e}
                {...RANGES.e}
                onChange={set('e')}
                hint={sup === 'jepit' ? 'Jepit–jepit: momen eksentris dipikul tumpuan.' : sup === 'jepit-sendi' ? 'Hanya di ujung sendi (atas); rumus tertutup tidak tersedia.' : undefined}
              />
              <Slider label="Beban tekan" symbol="P" unit="kN" value={Math.min(p.P, Pmax)} min={0} max={Pmax} step={Pmax > 200 ? 1 : 0.1} onChange={set('P')} />
              <div className="btn-row" style={{ marginTop: 0 }}>
                {testing ? (
                  <button className="btn primary sm" onClick={() => setTesting(false)}>
                    Hentikan
                  </button>
                ) : (
                  <button className="btn primary sm" onClick={startTest} title="P naik perlahan sampai leleh pertama atau 0,97·Pcr; titik dicatat otomatis">
                    Uji tekan
                  </button>
                )}
                <button className="btn ghost sm" onClick={record} disabled={Pimp <= 0}>
                  Catat titik
                </button>
                <button className="btn ghost sm" onClick={() => setPts([])} disabled={!pts.length}>
                  Hapus titik
                </button>
              </div>
            </div>
          )}

          {setup === 'kurva' && (
            <div className="card">
              <h3>Panjang efektif</h3>
              <Check label={`Pakai K rekomendasi desain (${sp.Krec}) bukan teori (${fmt(sp.K, 3)})`} checked={!!p.kr} onChange={(v) => set('kr')(v ? 1 : 0)} />
              <small className="slider-hint" style={{ marginTop: 6 }}>
                Tumpuan nyata tidak pernah jepit sempurna — nilai rekomendasi (Tabel C-A-7.1 penjelasan SNI 1729 / AISC) lebih besar untuk ujung jepit.
              </small>
            </div>
          )}

          {setup === 'elastica' && (
            <div className="card">
              <h3>Beban pasca-tekuk</h3>
              <Slider label="Beban relatif" symbol="P/Pcr" unit="" value={p.r} {...RANGES.r} onChange={set('r')} />
              <div className="btn-row" style={{ marginTop: 0 }}>
                {[
                  ['α = 30°', 30],
                  ['α = 90°', 90],
                  ['α = 130,7°', 130.7],
                  ['α = 160°', 160],
                ].map(([lab, a]) => (
                  <button
                    key={lab}
                    className="btn ghost sm"
                    title={a === 130.7 ? 'sendi–sendi: kedua ujung bertemu' : undefined}
                    onClick={() => set('r')(Math.round(elasticaRatio(Math.sin(((a as number) * Math.PI) / 360)) * 1e4) / 1e4)}
                  >
                    {lab}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h3>{setup === 'euler' ? 'Teori vs matriks kekakuan' : setup === 'imperfeksi' ? 'Teori vs elemen hingga & uji' : setup === 'kurva' ? 'Kuat tekan (SNI 1729 E3)' : 'Integral eliptik vs RK4'}</h3>
            {setup === 'euler' && <EulerTable sup={sup} EI={EI} L={Lmm} P={P} n={p.n} fe={feB} col={col} E={Emp} fy={p.fy} shape={shape} sec={sec} />}
            {setup === 'imperfeksi' && imp && (
              <ImperfTable sup={sup} EI={EI} L={Lmm} P={Pimp} Pcr={Pcr} e0={p.e0} e={p.e} imp={imp} col={col} fy={p.fy} PyTh={PyTh} PyFE={PyFE} pts={pts} />
            )}
            {setup === 'kurva' && <CurveTable K={Kuse} L={Lmm} col={col} E={Emp} fy={p.fy} />}
            {setup === 'elastica' && <ElasticaTable sup={sup} r={p.r} k={kEl} ela={ela} Pcr={Pcr} L={Lmm} />}
          </div>
        </aside>
      </div>

      <Notes setup={setup} sup={sup} />
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

function EulerTable(o: {
  sup: Support
  EI: number
  L: number
  P: number
  n: number
  fe: { P: number[] }
  col: Column
  E: number
  fy: number
  shape: Shape
  sec: SecParams
}) {
  const P1 = pcr(o.sup, o.EI, o.L)
  const Pn = pcr(o.sup, o.EI, o.L, o.n)
  const Kfe = (Math.PI * Math.sqrt(o.EI / o.fe.P[0])) / o.L
  const K = kEff(o.sup)
  const axes = (['x', 'y', 'min'] as Axis[]).map((a) => {
    return { a, P: pcr(o.sup, o.E * column(o.shape, o.sec, a).I, o.L) }
  })
  const gov = axes.reduce((m, x) => (x.P < m.P ? x : m))
  const lam = (K * o.L) / o.col.r
  const lamLim = Math.PI * Math.sqrt(o.E / o.fy)
  const rows: Row[] = [
    ['Pcr mode 1', P1 / 1e3, o.fe.P[0] / 1e3, 'kN'],
    ...(o.n > 1 ? ([[`Pcr mode ${o.n}`, Pn / 1e3, o.fe.P[o.n - 1] / 1e3, 'kN']] as Row[]) : []),
    ['Pcr2/Pcr1', pcr(o.sup, o.EI, o.L, 2) / P1, o.fe.P[1] / o.fe.P[0], '', 3],
    ['K = Le/L', K, Kfe, '', 4],
    ['σcr = Pcr/A', P1 / o.col.A, null, 'MPa'],
    ['KL/r', lam, null, '', 1],
    ['batas Euler π√(E/fy)', lamLim, null, '', 1],
    ['A·fy (leleh penampang)', (o.col.A * o.fy) / 1e3, null, 'kN'],
    ['P/Pcr', o.P / P1, null, '', 3],
  ]
  const name = { x: 'sumbu x', y: 'sumbu y', min: 'sumbu terlemah' }
  return (
    <>
      <Readout rows={rows} first="Rumus" second="Matriks 24 el." />
      <p style={{ fontSize: 13, margin: '8px 0 0' }}>
        {o.P >= P1 ? <b style={{ color: 'var(--red, #b5452f)' }}>P ≥ Pcr: kolom tertekuk. </b> : <b>P &lt; Pcr: kolom lurus stabil. </b>}
        {P1 / o.col.A > o.fy && 'σcr > fy — kolom pendek: leleh/tekuk inelastis lebih dulu (lihat tab Kurva Kolom).'}
      </p>
      <table className="readout" style={{ marginTop: 8 }}>
        <tbody>
          {axes.map((x) => (
            <tr key={x.a}>
              <th>Pcr terhadap {name[x.a]}</th>
              <td>
                {fmt(x.P / 1e3, 1)} <small>kN</small> {x === gov && <small>← menentukan</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Kolom kanan: kolom dibagi 24 elemen balok (kekakuan lentur K dan kekakuan geometrik G), lalu diselesaikan eigen K·φ = P·G·φ.
      </small>
    </>
  )
}

function ImperfTable(o: {
  sup: Support
  EI: number
  L: number
  P: number
  Pcr: number
  e0: number
  e: number
  imp: { dMax: number; Mmax: number }
  col: Column
  fy: number
  PyTh: number | null
  PyFE: number
  pts: Pt[]
}) {
  const av = theoryAvailable(o.sup, o.e)
  const t = imperfectTheory(o.sup, o.EI, o.L, o.P, o.e0, o.e)
  const sw = southwell(o.pts)
  const sTh = o.P / o.col.A + t.M / o.col.S
  const sFE = o.P / o.col.A + o.imp.Mmax / o.col.S
  const rows: Row[] = [
    ['α = P/Pcr', t.a, null, '', 3],
    ['amplifikasi 1/(1−α)', t.amp, null, '', 3],
    ['δ tambahan', av ? t.d : null, o.imp.dMax, 'mm', 2],
    ['M maks', av ? t.M / 1e6 : null, o.imp.Mmax / 1e6, 'kN·m', 3],
    ['σ maks = P/A + M/S', av ? sTh : null, sFE, 'MPa'],
    ['P leleh pertama', o.PyTh !== null ? o.PyTh / 1e3 : null, o.PyFE / 1e3, 'kN'],
  ]
  const rows2: Row[] = [
    ['Pcr', o.Pcr / 1e3, sw ? sw.Pcr / 1e3 : null, 'kN'],
    ['e0', o.e0, sw ? sw.e0 : null, 'mm', 2],
  ]
  return (
    <>
      <Readout rows={rows} first="Rumus" second="Elemen hingga" />
      <div style={{ height: 10 }} />
      <Readout rows={rows2} first="Masukan" second={`Southwell (${o.pts.length} titik)`} />
      <small className="slider-hint" style={{ marginTop: 6 }}>
        {o.sup === 'jepit-sendi' && o.e > 0
          ? 'Jepit–sendi dengan eksentrisitas: tidak ada rumus tertutup sederhana, hanya elemen hingga. '
          : 'Rumus: δ = e0·α/(1−α) + e·(sec(kLe/2) − 1), k = √(P/EI). '}
        Southwell memperkirakan Pcr dari kemiringan garis δ terhadap δ/P — dipakai di laboratorium tanpa perlu membebani sampai runtuh.
        {o.e > 0 && ' Dengan eksentrisitas, titik awal melengkung; gunakan titik di atas ±0,5Pcr.'}
      </small>
    </>
  )
}

function CurveTable(o: { K: number; L: number; col: Column; E: number; fy: number }) {
  const lam = (o.K * o.L) / o.col.r
  const s = sniFcr(lam, o.E, o.fy)
  const lc = (lam / Math.PI) * Math.sqrt(o.fy / o.E)
  const eta = (lam * o.col.c) / (1000 * o.col.r)
  const rows: Row[] = [
    ['K dipakai', o.K, null, '', 3],
    ['KL/r', lam, null, '', 1],
    ['λc = (KL/r)/π·√(fy/E)', lc, null, '', 3],
    ['Fe = π²E/(KL/r)²', s.Fe, null, 'MPa'],
    ['Fcr', s.Fcr, null, 'MPa'],
    ['Fcr/fy', s.Fcr / o.fy, null, '', 3],
    ['Pn = Fcr·A', (s.Fcr * o.col.A) / 1e3, null, 'kN'],
    ['φc·Pn (φc = 0,9)', (0.9 * s.Fcr * o.col.A) / 1e3, null, 'kN'],
    ['Pcr Euler = Fe·A', (s.Fe * o.col.A) / 1e3, null, 'kN'],
    ['Perry–Robertson (e0 = Le/1000)', (perry(lam, o.E, o.fy, eta) * o.col.A) / 1e3, null, 'kN'],
  ]
  return (
    <>
      <Readout rows={rows} first="Nilai" second="" />
      <p style={{ fontSize: 13, margin: '8px 0 0' }}>
        {s.inelastic ? (
          <>
            KL/r ≤ 4,71√(E/fy) = {fmt(sniLimit(o.E, o.fy), 1)}: <b>tekuk inelastis</b> — sebagian penampang sudah leleh (tegangan sisa), Euler terlalu optimis.
          </>
        ) : (
          <>
            KL/r &gt; {fmt(sniLimit(o.E, o.fy), 1)}: <b>tekuk elastis</b>, Fcr = 0,877·Fe (reduksi untuk lengkung awal ≈ L/1500).
          </>
        )}{' '}
        {lam > 200 && <b style={{ color: '#b5452f' }}>KL/r &gt; 200: melebihi batas kelangsingan yang disarankan.</b>}
      </p>
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Tanpa tekuk lokal (penampang dianggap tidak langsing) dan tanpa tekuk torsi/lentur-torsi — untuk siku dan kanal nilai sebenarnya bisa lebih kecil.
      </small>
    </>
  )
}

function ElasticaTable(o: { sup: Support; r: number; k: number; ela: { d: number; short: number; tipX: number; ratio: number } | null; Pcr: number; L: number }) {
  if (o.r <= 1)
    return (
      <p style={{ fontSize: 13, margin: 0 }}>
        P/Pcr = {fmt(o.r, 3)} ≤ 1: kolom lurus adalah satu-satunya keseimbangan. Naikkan beban di atas Pcr untuk melihat cabang pasca-tekuk.
      </p>
    )
  const t = elasticaTheory(o.sup, o.k)
  const rows: Row[] = [
    ['P/Pcr', o.r, o.ela?.ratio ?? null, '', 4],
    ['P', (o.r * o.Pcr) / 1e3, null, 'kN'],
    ['k = sin(α/2)', o.k, null, '', 4],
    ['α kemiringan maks', (t.alpha * 180) / Math.PI, null, '°'],
    ['δ / L', t.d, o.ela?.d ?? null, '', 4],
    ['δ', t.d * o.L, o.ela ? o.ela.d * o.L : null, 'mm', 0],
    ['Δ / L (perpendekan)', t.short, o.ela?.short ?? null, '', 4],
  ]
  if (o.sup !== 'jepit-bebas') rows.push(['ujung atas lateral', 0, o.ela ? o.ela.tipX * o.L : null, 'mm', 2])
  return (
    <>
      <Readout rows={rows} first="Eliptik" second="RK4 600 langkah" />
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Kolom kanan: persamaan EI·θ″ + P·sin θ = 0 diintegrasikan sepanjang busur dari dasar. Teori linear (Euler) hanya tahu P = Pcr dengan lendutan sembarang;
        elastica menunjukkan beban naik sangat sedikit: δ = 0,1L hanya butuh ≈ 1,03·Pcr.
      </small>
    </>
  )
}

// ---------- catatan ----------

function Notes({ setup, sup }: { setup: Setup; sup: Support }) {
  const concept: React.ReactNode[] = []
  const tryThis: React.ReactNode[] = []
  if (setup === 'euler') {
    concept.push(
      <>
        <b>Beban kritis Euler</b> Pcr = π²EI/(KL)²: beban terkecil di mana kolom lurus sempurna punya keseimbangan lain (melengkung). Bergantung pada
        kekakuan lentur EI dan panjang, <i>tidak</i> pada kekuatan bahan.
      </>,
      <>
        <b>Panjang efektif</b> Le = K·L adalah jarak antara dua titik momen nol (titik belok) pada bentuk tekuk — setengah gelombang sinus yang setara
        kolom sendi–sendi. Jepit–bebas: K = 2 (bayangan cermin), jepit–jepit: K = 0,5.
      </>,
      <>
        <b>Mode tinggi</b> Pcr,n = (βnL)²EI/L²: mode 2 sendi–sendi butuh 4× beban. Mode tinggi hanya muncul bila mode rendah dicegah, mis. pengaku lateral di
        tengah bentang.
      </>,
      <>
        <b>Sumbu terlemah:</b> kolom menekuk terhadap sumbu dengan I terkecil (r terkecil). WF menekuk ke arah sayap (sumbu y); siku menekuk terhadap
        sumbu utama miring v.
      </>,
    )
    tryThis.push('Tekan "P = 1,1·Pcr": kolom tiba-tiba melengkung (merah). Turunkan sedikit di bawah Pcr: lurus lagi.')
    tryThis.push('Gandakan L: Pcr turun menjadi ¼. Lihat titik pada grafik bergeser sepanjang hiperbola.')
    tryThis.push('Bandingkan 4 tumpuan pada L sama: jepit–jepit 16× lebih kuat dari jepit–bebas.')
    tryThis.push('Pilih Mode 2 pada sendi–sendi: titik belok di tengah — itulah yang terjadi bila tengah kolom ditahan lateral.')
    tryThis.push('Pilih Siku L: sumbu tekuk miring 45°, Pcr terlemah jauh di bawah Pcr terhadap sumbu x atau y.')
  } else if (setup === 'imperfeksi') {
    concept.push(
      <>
        <b>Kolom nyata tidak lurus.</b> Lengkung awal e0 diperbesar dengan faktor 1/(1 − P/Pcr): lendutan tumbuh sejak beban kecil dan tak terhingga di Pcr.
        Tidak ada "titik tekuk" yang tajam.
      </>,
      <>
        <b>Momen orde kedua</b> M = P·(e + δ) (efek P-δ) menambah tegangan lentur. Kolom gagal ketika serat terluar leleh — di bawah Pcr. Inilah dasar
        rumus Perry–Robertson dan faktor pembesaran momen (B1) di SNI 1729.
      </>,
      <>
        <b>Plot Southwell:</b> δ = Pcr·(δ/P) − e0 adalah garis lurus. Dari beberapa titik uji di bawah Pcr, kemiringan memberi Pcr dan titik potong memberi
        e0 — metode klasik laboratorium.
      </>,
      <>
        <b>Eksentrisitas beban</b> e menghasilkan rumus secant: δ = e(sec(kLe/2) − 1). Pada jepit–jepit momen eksentris dipikul tumpuan sehingga kolom tetap
        lurus.
      </>,
    )
    tryThis.push('Tekan "Uji tekan" dengan e0 = L/1000: titik hijau di Southwell membentuk garis, kemiringannya ≈ Pcr.')
    tryThis.push('Perbesar e0 sepuluh kali: Pcr Southwell tetap sama, tetapi beban leleh pertama turun banyak.')
    tryThis.push('Set e0 = 0 dan e = 0: tidak ada lendutan sama sekali sampai Pcr (kolom sempurna).')
    tryThis.push('Pilih jepit–jepit, beri e besar: lendutan tetap nol — tumpuan jepit menahan momen eksentris.')
  } else if (setup === 'kurva') {
    concept.push(
      <>
        <b>Kurva kolom</b> menggabungkan dua batas: leleh penampang (kolom pendek, σ = fy) dan tekuk Euler (kolom langsing, σ = π²E/(KL/r)²). Di antaranya
        terjadi tekuk inelastis.
      </>,
      <>
        <b>SNI 1729:2020 (AISC 360) E3:</b> Fcr = 0,658^(fy/Fe)·fy untuk KL/r ≤ 4,71√(E/fy); Fcr = 0,877·Fe untuk kolom langsing. Faktor 0,877 menampung
        lengkung awal L/1500; bagian inelastis menampung tegangan sisa pengelasan/pencanaian.
      </>,
      <>
        <b>Perry–Robertson:</b> kolom sendi dengan lengkung awal e0 dianggap gagal saat serat terluar leleh: (fy − σ)(σe − σ) = η·σ·σe. Dasar kurva kolom
        Eropa.
      </>,
    )
    tryThis.push('Perpendek L sampai KL/r < 20: Fcr hampir = fy, Euler tidak lagi berlaku (garis putus-putus di atas fy).')
    tryThis.push('Naikkan fy dari 250 ke 410 MPa: kolom pendek makin kuat, kolom langsing tidak berubah (E sama).')
    tryThis.push('Pilih jepit–jepit lalu centang "K rekomendasi": K naik 0,5 → 0,65, kuat tekan turun.')
  } else {
    concept.push(
      <>
        <b>Elastica</b> adalah bentuk lendutan besar batang elastis: EI·θ″ + P·sin θ = 0. Teori linear (sin θ ≈ θ) hanya menghasilkan nilai eigen Pcr;
        elastica memberi hubungan beban–lendutan setelah tekuk.
      </>,
      <>
        <b>Kekakuan pasca-tekuk kecil:</b> P/Pcr = (2K(k)/π)² dengan K integral eliptik lengkap. Lendutan 10% panjang kolom hanya butuh +3% beban — kolom
        sudah praktis runtuh walau secara elastis masih stabil.
      </>,
      <>
        <b>Analogi panjang efektif eksak:</b> jepit–bebas = separuh kolom sendi–sendi 2L, jepit–jepit = empat seperempat gelombang. Jepit–sendi tidak
        tersusun dari seperempat gelombang, sehingga tidak ditampilkan.
      </>,
    )
    tryThis.push('Tekan "α = 130,7°" pada sendi–sendi: kedua ujung kolom bertemu (perpendekan = L).')
    tryThis.push('Naikkan P/Pcr ke 2,5: kolom sendi–sendi membentuk simpul (ujung saling bersilangan).')
    tryThis.push('Pilih jepit–bebas: lendutan ujung 2× kolom sendi–sendi pada P/Pcr yang sama.')
  }
  if (sup === 'jepit-sendi' && setup === 'euler') tryThis.push('Jepit–sendi: K = 0,699 dari akar tan(βL) = βL = 4,4934 — bukan 0,7 bulat.')
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
