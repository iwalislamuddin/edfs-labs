import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { Check, Segmented, Slider } from '../../ui/controls'
import { drawChart } from './charts'
import { buildParts, clampParams, defaults, DIM_LABEL, loadScale, parseQuery, RANGES, SETUPS, SHAPES, toQuery, withLoads, type Params, type Setup, type Shape } from './model'
import {
  extremes,
  gridScan,
  hull,
  inside,
  kern,
  partProps,
  plastic,
  props,
  Q,
  resultantPoint,
  rotated,
  sigma,
  stressPlane,
  tauAt,
  width,
  type Part,
  type Props,
} from './section'
import { drawStage, fmt, toWorld, type Layout } from './stage'

const wrap90 = (d: number) => {
  let x = ((((d + 90) % 180) + 180) % 180) - 90
  if (x <= -90) x += 180
  return x
}

export default function SectionRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [shape, setShape] = useState<Shape>(init.shape)
  const [p, setP] = useState<Params>(init.params)
  const [grabbing, setGrabbing] = useState(false)

  useEffect(() => onQuery(toQuery(setup, shape, p)), [setup, shape, p]) // eslint-disable-line react-hooks/exhaustive-deps

  const dimKey = SHAPES.find((s) => s.id === shape)!.dims.map((k) => p[k]).join(',')
  const parts = useMemo(() => buildParts(shape, p), [shape, dimKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const pr = useMemo(() => props(parts), [parts])
  const pl = useMemo(() => plastic(parts), [parts])

  const live = useRef({ setup, p, parts, pr, yp: pl.yp })
  live.current = { setup, p, parts, pr, yp: pl.yp }
  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const layout = useRef<Layout | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    let raf = 0
    const frame = () => {
      const L = live.current
      const c = stageRef.current
      if (c) {
        const { w, h, ctx } = fitCanvas(c)
        layout.current = drawStage(ctx, w, h, L)
      }
      const pc = plotRef.current
      if (pc) {
        const { w, h, ctx } = fitCanvas(pc)
        drawChart(ctx, w, h, L.setup, L.p, L.parts, L.pr)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const changeSetup = (s: Setup) => {
    setSetup(s)
    setP((old) => {
      const d = defaults(s, shape)
      for (const k of SHAPES.find((x) => x.id === shape)!.dims) d[k] = old[k]
      d.fy = old.fy
      return clampParams(shape, withLoads(s, shape, d))
    })
  }
  const changeShape = (s: Shape) => {
    setShape(s)
    setP((old) => clampParams(s, withLoads(setup, s, { ...defaults(setup, s), th: old.th, fy: old.fy, cut: old.cut, kern: old.kern })))
  }
  const set = (key: keyof Params) => (val: number) => setP((old) => clampParams(shape, { ...old, [key]: val }))
  const setMany = (o: Partial<Params>) => setP((old) => clampParams(shape, { ...old, ...o }))

  // ---- pointer ----
  const local = (e: React.PointerEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }
  const canDrag = () => live.current.setup !== 'lentur' || Math.abs(live.current.p.N) > 1e-9
  const apply = (x: number, y: number) => {
    const l = layout.current
    if (!l) return
    const L = live.current
    if (L.setup === 'properti') {
      const a = Math.atan2(-(y - l.centroid[1]), x - l.centroid[0])
      const th = wrap90(Math.round(((a * 180) / Math.PI) * 2) / 2)
      setP((old) => (old.th === th ? old : { ...old, th }))
    } else if (L.setup === 'lentur') {
      const [wx, wy] = toWorld(l, x, y)
      const N = L.p.N
      // titik tangkap N di (wx, wy): Mx = −N·ey, My = −N·ex (kN·m)
      const r = (v: number) => Math.round(v * 2) / 2
      setMany({ Mx: r((-N * (wy - L.pr.yc)) / 1e3), My: r((-N * (wx - L.pr.xc)) / 1e3) })
    } else {
      const [, wy] = toWorld(l, x, y)
      const c = Math.min(1, Math.max(0, (wy - L.pr.ymin) / (L.pr.ymax - L.pr.ymin)))
      setP((old) => ({ ...old, cut: Math.round(c * 400) / 400 }))
    }
  }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!layout.current || !canDrag()) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    setGrabbing(true)
    const [x, y] = local(e)
    apply(x, y)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = local(e)
    if (!dragging.current) {
      e.currentTarget.style.cursor = canDrag() ? (live.current.setup === 'geser' ? 'ns-resize' : 'grab') : 'default'
      return
    }
    apply(x, y)
  }
  const onUp = () => {
    dragging.current = false
    setGrabbing(false)
  }

  const dims = SHAPES.find((s) => s.id === shape)!.dims
  const ls = loadScale(shape, p)
  const H = pr.ymax - pr.ymin
  const hasFlange = shape === 'wf' || shape === 'tee' || shape === 'kanal' || shape === 'zee'
  const tip =
    setup === 'properti'
      ? 'Tarik di mana saja untuk memutar sumbu u. Oranye = sumbu utama, putus-putus hijau = elips inersia.'
      : setup === 'lentur'
        ? Math.abs(p.N) > 1e-9
          ? 'Tarik titik tangkap N: momen Mx = −N·ey, My = −N·ex. Oranye = inti penampang (kern).'
          : 'N = 0: lentur murni, garis netral melewati titik berat. Beri N untuk menggeser titik tangkap.'
        : 'Tarik naik-turun untuk memindah potongan. Arsir oranye = luas di atas potongan (untuk Q).'

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Material &amp; Elemen › <b>Room Section</b>
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
                {setup === 'properti'
                  ? 'Momen inersia terhadap sumbu yang diputar (lingkaran Mohr inersia)'
                  : setup === 'lentur'
                    ? 'Distribusi tegangan normal tegak lurus garis netral'
                    : 'Lebar b, momen pertama Q, dan tegangan geser τ sepanjang tinggi'}
              </b>
              <span style={{ color: 'var(--mute)', fontSize: 13 }}>
                {setup === 'properti' ? 'Iu + Iv selalu konstan; Iuv = 0 di sumbu utama' : setup === 'lentur' ? 'σ linear: bidang tegangan' : 'τ = V·Q / (I·b)'}
              </span>
            </div>
            <canvas ref={plotRef} className="plot" />
          </div>
          {setup === 'properti' && (
            <div className="card">
              <h3>Tabel Steiner (sumbu sejajar) terhadap sumbu berat</h3>
              <SteinerTable parts={parts} pr={pr} />
            </div>
          )}
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Penampang</h3>
            <div style={{ marginBottom: 12 }}>
              <Segmented value={shape} options={SHAPES.map((x) => ({ id: x.id, label: x.label }))} onChange={changeShape} />
            </div>
            {dims.map((k) => {
              const [lab, sym] = DIM_LABEL[k]!
              return <Slider key={k} label={lab} symbol={sym} unit="mm" value={p[k]} {...RANGES[k]} onChange={set(k)} />
            })}
            <div className="btn-row" style={{ marginTop: 0 }}>
              <button className="btn ghost sm" onClick={() => changeShape(shape)}>
                Ukuran bawaan
              </button>
            </div>
          </div>

          {setup === 'properti' && (
            <div className="card">
              <h3>Sumbu putar &amp; material</h3>
              <Slider label="Sudut sumbu u (berlawanan jarum jam)" symbol="θ" unit="°" value={p.th} {...RANGES.th} onChange={set('th')} />
              <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
                <button className="btn ghost sm" onClick={() => set('th')(Math.round(pr.thP * 2) / 2)}>
                  Ke sumbu utama
                </button>
                <button className="btn ghost sm" onClick={() => set('th')(0)}>
                  θ = 0
                </button>
              </div>
              <Slider label="Tegangan leleh" symbol="fy" unit="MPa" value={p.fy} {...RANGES.fy} onChange={set('fy')} hint="BJ 37: 240 · BJ 41: 250 · BJ 50: 290 · BJ 55: 410" />
            </div>
          )}

          {setup === 'lentur' && (
            <div className="card">
              <h3>Beban pada penampang</h3>
              <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
                <button className="btn ghost sm" onClick={() => setMany({ N: 0, Mx: ls.M, My: 0 })} title="Mx saja">
                  Lentur murni
                </button>
                <button className="btn ghost sm" onClick={() => setMany({ N: -ls.N, Mx: 0, My: 0 })}>
                  Tekan sentris
                </button>
                <button
                  className="btn ghost sm"
                  title="N tekan tepat di sudut atas inti: serat bawah σ = 0"
                  onClick={() => {
                    const k = kern(pr, hull(parts))
                    const top = k.reduce((a, b) => (b[1] > a[1] ? b : a), k[0])
                    const N = -ls.N
                    setMany({ N, Mx: (-N * (top[1] - pr.yc)) / 1e3, My: (-N * (top[0] - pr.xc)) / 1e3 })
                  }}
                >
                  N di tepi inti
                </button>
                <button className="btn ghost sm" onClick={() => setMany({ N: -ls.N / 2, Mx: ls.M / 2, My: Math.round(ls.M * 2) / 10 })}>
                  Dua arah
                </button>
              </div>
              <Slider label="Gaya aksial (tarik +)" symbol="N" unit="kN" value={p.N} {...RANGES.N} onChange={set('N')} />
              <Slider label="Momen terhadap x (atas tertekan +)" symbol="Mx" unit="kN·m" value={p.Mx} {...RANGES.Mx} onChange={set('Mx')} />
              <Slider label="Momen terhadap y (kanan tertekan +)" symbol="My" unit="kN·m" value={p.My} {...RANGES.My} onChange={set('My')} />
              <div style={{ marginBottom: 10 }}>
                <Check label="Tampilkan inti penampang (kern)" checked={!!p.kern} onChange={(v) => set('kern')(v ? 1 : 0)} />
              </div>
              <Slider label="Tegangan leleh (pembanding)" symbol="fy" unit="MPa" value={p.fy} {...RANGES.fy} onChange={set('fy')} />
            </div>
          )}

          {setup === 'geser' && (
            <div className="card">
              <h3>Gaya lintang &amp; potongan</h3>
              <Slider label="Gaya lintang vertikal" symbol="V" unit="kN" value={p.V} {...RANGES.V} onChange={set('V')} />
              <Slider
                label="Posisi potongan dari serat bawah"
                symbol="y"
                unit="mm"
                value={p.cut * H}
                min={0}
                max={Math.round(H * 10) / 10}
                step={Math.max(0.1, Math.round(H / 4) / 100)}
                onChange={(v) => set('cut')(v / H)}
              />
              <div className="btn-row" style={{ marginTop: 0 }}>
                <button className="btn ghost sm" onClick={() => set('cut')((pr.yc - pr.ymin) / H)}>
                  Di garis netral
                </button>
                {hasFlange && (
                  <button className="btn ghost sm" onClick={() => set('cut')((H - p.tf - 1e-3) / H)} title="tepat di bawah sayap atas (di badan)">
                    Badan di bawah sayap
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h3>{setup === 'properti' ? 'Rumus vs grid' : setup === 'lentur' ? 'Tegangan & keseimbangan' : 'Tegangan geser'}</h3>
            {setup === 'properti' && <PropsTable parts={parts} pr={pr} p={p} />}
            {setup === 'lentur' && <NormalTable parts={parts} pr={pr} p={p} />}
            {setup === 'geser' && <ShearTable parts={parts} pr={pr} p={p} shape={shape} />}
          </div>
        </aside>
      </div>

      <Notes setup={setup} shape={shape} pr={pr} parts={parts} />
    </div>
  )
}

// ---------- tabel ----------

const E3 = 1e3
const E6 = 1e6
type Row = [string, number | null, number | null, string, number?]

function Readout({ rows, second, first = 'Rumus' }: { rows: Row[]; second: string; first?: string }) {
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
        {rows.map(([lab, a, b, u, d = 1]) => (
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

function SteinerTable({ parts, pr }: { parts: Part[]; pr: Props }) {
  let sA = 0
  let sAy = 0
  let sI0 = 0
  let sAd = 0
  const rows = parts.map((q, k) => {
    const pp = partProps(q)
    const d = pp.cy - pr.yc
    sA += pp.A
    sAy += pp.A * (pp.cy - pr.ymin)
    sI0 += pp.Ix0
    sAd += pp.A * d * d
    return (
      <tr key={k}>
        <th>
          {k + 1}. {q.name} {q.sign < 0 && <small>(lubang)</small>}
        </th>
        <td>{fmt(pp.A, 0)}</td>
        <td>{fmt(pp.cy - pr.ymin)}</td>
        <td>{fmt((pp.A * (pp.cy - pr.ymin)) / E3, 1)}</td>
        <td>{fmt(pp.Ix0 / E6, 3)}</td>
        <td>{fmt(d)}</td>
        <td>{fmt((pp.A * d * d) / E6, 3)}</td>
      </tr>
    )
  })
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="readout">
        <thead>
          <tr>
            <th>Bagian</th>
            <th>
              Aᵢ <small>mm²</small>
            </th>
            <th>
              yᵢ <small>mm</small>
            </th>
            <th>
              Aᵢyᵢ <small>10³mm³</small>
            </th>
            <th>
              I₀ᵢ <small>10⁶mm⁴</small>
            </th>
            <th>
              dᵢ = yᵢ − ȳ <small>mm</small>
            </th>
            <th>
              Aᵢdᵢ² <small>10⁶mm⁴</small>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows}
          <tr>
            <th>
              <b>Σ</b>
            </th>
            <td>{fmt(sA, 0)}</td>
            <td>—</td>
            <td>{fmt(sAy / E3, 1)}</td>
            <td>{fmt(sI0 / E6, 3)}</td>
            <td>—</td>
            <td>{fmt(sAd / E6, 3)}</td>
          </tr>
        </tbody>
      </table>
      <small className="slider-hint" style={{ marginTop: 6 }}>
        ȳ = ΣAᵢyᵢ / ΣAᵢ = {fmt(sAy / E3, 1)}·10³ / {fmt(sA, 0)} = <b>{fmt(sAy / sA)} mm</b> dari serat bawah · Ix = ΣI₀ᵢ + ΣAᵢdᵢ² ={' '}
        {fmt(sI0 / E6, 3)} + {fmt(sAd / E6, 3)} = <b>{fmt(pr.Ix / E6, 3)}·10⁶ mm⁴</b>
      </small>
    </div>
  )
}

function PropsTable({ parts, pr, p }: { parts: Part[]; pr: Props; p: Params }) {
  const g = useMemo(() => gridScan(parts, 600), [parts])
  const pl = plastic(parts)
  const r = rotated(pr, p.th)
  const gr = { Iu: 0, Iuv: 0 }
  {
    const t = (2 * p.th * Math.PI) / 180
    const avg = (g.Ix + g.Iy) / 2
    const d = (g.Ix - g.Iy) / 2
    gr.Iu = avg + d * Math.cos(t) - g.Ixy * Math.sin(t)
    gr.Iuv = d * Math.sin(t) + g.Ixy * Math.cos(t)
  }
  const Smin = Math.min(pr.Sxt, pr.Sxb)
  const rows: Row[] = [
    ['Luas A', pr.A, g.A, 'mm²', 0],
    ['x̄ dari kiri', pr.xc - pr.xmin, g.xc - pr.xmin, 'mm'],
    ['ȳ dari bawah', pr.yc - pr.ymin, g.yc - pr.ymin, 'mm'],
    ['Ix', pr.Ix / E6, g.Ix / E6, '10⁶mm⁴', 3],
    ['Iy', pr.Iy / E6, g.Iy / E6, '10⁶mm⁴', 3],
    ['Ixy', pr.Ixy / E6, g.Ixy / E6, '10⁶mm⁴', 3],
    [`Iu (θ = ${fmt(p.th)}°)`, r.Iu / E6, gr.Iu / E6, '10⁶mm⁴', 3],
    ['Iuv', r.Iuv / E6, gr.Iuv / E6, '10⁶mm⁴', 3],
    ['I1 (maks)', pr.I1 / E6, null, '10⁶mm⁴', 3],
    ['I2 (min)', pr.I2 / E6, null, '10⁶mm⁴', 3],
    ['θp sumbu 1', pr.thP, null, '°'],
    ['Sx atas = Ix/c atas', pr.Sxt / E3, null, '10³mm³'],
    ['Sx bawah', pr.Sxb / E3, null, '10³mm³'],
    ['Sy (min)', Math.min(pr.Syl, pr.Syr) / E3, null, '10³mm³'],
    ['rx = √(Ix/A)', pr.rx, null, 'mm'],
    ['ry = √(Iy/A)', pr.ry, null, 'mm'],
    ['Zx plastis', pl.Zx / E3, null, '10³mm³'],
    ['Zy plastis', pl.Zy / E3, null, '10³mm³'],
    ['Faktor bentuk Zx/Sx', pl.Zx / Smin, null, '', 3],
    ['Momen leleh fy·Sx', (p.fy * Smin) / E6, null, 'kN·m'],
    ['Momen plastis fy·Zx', (p.fy * pl.Zx) / E6, null, 'kN·m'],
  ]
  return (
    <>
      <Readout rows={rows} second="Grid 600²" />
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Kolom kanan: penampang dipotong menjadi 600 × 600 kotak kecil dan dijumlahkan seperti di kertas milimeter. Selisih kecil muncul
        di pelat tipis yang hanya terisi sebagian kotak. Lentur tak simetris (Ixy ≠ 0) memakai Ix, Iy, Ixy terhadap sumbu berat.
      </small>
    </>
  )
}

function NormalTable({ parts, pr, p }: { parts: Part[]; pr: Props; p: Params }) {
  const pl = stressPlane(pr, p.N, p.Mx, p.My)
  const hl = hull(parts)
  const ex = extremes(pl, pr, hl)
  // resultan ∫σ dA, momennya, dengan grid (pengukuran)
  const res = useMemo(() => {
    const n = 300
    const hx = (pr.xmax - pr.xmin) / n
    const hy = (pr.ymax - pr.ymin) / n
    let N = 0
    let Sy = 0
    let Sx = 0
    let At = 0
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = pr.xmin + (i + 0.5) * hx
        const y = pr.ymin + (j + 0.5) * hy
        if (inside(parts, x, y) <= 0) continue
        const s = sigma(pl, pr, x, y) * hx * hy
        N += s
        Sy += s * (y - pr.yc)
        Sx += s * (x - pr.xc)
        if (s > 0) At += hx * hy
      }
    return { N: N / 1e3, Mx: -Sy / 1e6, My: -Sx / 1e6, At }
  }, [parts, pr, pl.s0, pl.a, pl.b]) // eslint-disable-line react-hooks/exhaustive-deps
  const rp = resultantPoint(pr, p.N, p.Mx, p.My)
  const k = kern(pr, hl)
  let inKern: boolean | null = null
  if (rp && k.length > 2) {
    inKern = true
    for (let i = 0; i < k.length; i++) {
      const [x1, y1] = k[i]
      const [x2, y2] = k[(i + 1) % k.length]
      if ((x2 - x1) * (rp.y - y1) - (y2 - y1) * (rp.x - x1) < -1e-9) inKern = false
    }
  }
  const rows: Row[] = [
    ['N', p.N, res.N, 'kN'],
    ['Mx', p.Mx, res.Mx, 'kN·m', 2],
    ['My', p.My, res.My, 'kN·m', 2],
    ['N/A', pl.s0, null, 'MPa', 2],
    ['Mx/Sx (serat atas)', (-p.Mx * E6) / pr.Sxt, null, 'MPa', 2],
    ['σ maks (tarik +)', ex.max.s, null, 'MPa', 2],
    ['σ min (tekan −)', ex.min.s, null, 'MPa', 2],
    ['|σ| maks / fy', Math.max(Math.abs(ex.max.s), Math.abs(ex.min.s)) / p.fy, null, '', 3],
    ['Luas tertarik', res.At, null, 'mm²', 0],
  ]
  if (rp) {
    rows.push(['ex (titik tangkap N)', rp.x - pr.xc, null, 'mm'])
    rows.push(['ey', rp.y - pr.yc, null, 'mm'])
  }
  return (
    <>
      <Readout rows={rows} first="Beban / rumus" second="∫σ dA" />
      {inKern !== null && (
        <p style={{ fontSize: 13, margin: '8px 0 0' }}>
          Titik tangkap N <b>{inKern ? 'di dalam' : 'di luar'}</b> inti penampang →{' '}
          {inKern ? `seluruh penampang ${p.N < 0 ? 'tertekan' : 'tertarik'}.` : 'sebagian penampang berganti tanda (garis netral memotong penampang).'}
        </p>
      )}
      <small className="slider-hint" style={{ marginTop: 6 }}>
        Kolom kanan: tegangan dijumlahkan di 300 × 300 kotak — resultannya harus kembali ke beban (keseimbangan). Rumus umum:{' '}
        σ = N/A + a·x + b·y dengan [Iy Ixy; Ixy Ix]·[a; b] = −[My; Mx].
      </small>
    </>
  )
}

function ShearTable({ parts, pr, p, shape }: { parts: Part[]; pr: Props; p: Params; shape: Shape }) {
  const V = p.V * 1e3
  const yCut = pr.ymin + p.cut * (pr.ymax - pr.ymin)
  const q = Q(parts, pr, yCut)
  const tNA = tauAt(parts, pr, V, pr.yc)
  const tCut = tauAt(parts, pr, V, yCut)
  const meas = useMemo(() => {
    const n = 3000
    const dy = (pr.ymax - pr.ymin) / n
    let sum = 0
    let tmax = 0
    let web = 0
    const tf = shape === 'wf' || shape === 'kanal' || shape === 'zee' || shape === 'tee' ? p.tf : 0
    const top = pr.ymax - tf
    const bot = shape === 'tee' ? pr.ymin : pr.ymin + tf
    for (let k = 0; k < n; k++) {
      const y = pr.ymin + (k + 0.5) * dy
      const t = tauAt(parts, pr, V, y)
      const f = t * width(parts, y) * dy
      sum += f
      tmax = Math.max(tmax, Math.abs(t))
      if (tf > 0 && y > bot && y < top) web += f
    }
    return { sum, tmax, web: tf > 0 ? web : null }
  }, [parts, pr, V, shape, p.tf])
  const tavg = V / pr.A
  const rows: Row[] = [
    ['τ rata-rata V/A', tavg, null, 'MPa', 3],
    ['τ di garis netral', tNA, null, 'MPa', 3],
    ['τ maks', meas.tmax * Math.sign(V || 1), null, 'MPa', 3],
    ['τ maks / (V/A)', V ? meas.tmax / Math.abs(tavg) : 0, null, '', 3],
    ['Potongan: b', width(parts, yCut), null, 'mm'],
    ['Potongan: luas di atas', q.Aab, null, 'mm²', 0],
    ['Potongan: Q = A′·ȳ′', q.Qx / E3, null, '10³mm³'],
    ['Potongan: τ = VQ/(Ib)', tCut, null, 'MPa', 3],
    ['Aliran geser q = τ·b', tCut * width(parts, yCut), null, 'N/mm'],
    ['∫τ·b dy', V / E3, meas.sum / E3, 'kN', 2],
  ]
  if (meas.web !== null) rows.push(['Bagian V dipikul badan', null, (meas.web / (V || 1)) * 100, '%', 1])
  return (
    <>
      <Readout rows={rows} first="Rumus / beban" second="Integrasi" />
      <small className="slider-hint" style={{ marginTop: 6 }}>
        ∫τ·b dy sepanjang tinggi harus sama dengan V. {Math.abs(pr.Ixy) > 1e-6 * pr.Ix && 'Ixy ≠ 0: dipakai rumus umum τ·b = V(Iy·Qx − Ixy·Qy)/(IxIy − Ixy²).'}
      </small>
    </>
  )
}

// ---------- catatan ----------

function Notes({ setup, shape, pr, parts }: { setup: Setup; shape: Shape; pr: Props; parts: Part[] }) {
  const concept: React.ReactNode[] = []
  const tryThis: React.ReactNode[] = []
  if (setup === 'properti') {
    const pl = plastic(parts)
    concept.push(
      <>
        <b>Titik berat</b> ȳ = ΣAᵢyᵢ/ΣAᵢ: rata-rata letak luas. Lubang dihitung sebagai luas negatif. Semua lentur elastis tanpa gaya
        aksial berputar di sumbu yang melewati titik ini.
      </>,
      <>
        <b>Momen inersia</b> Ix = ∫y² dA mengukur seberapa jauh luas tersebar dari sumbu. Teorema Steiner: <code>Ix = ΣI₀ᵢ + ΣAᵢdᵢ²</code> —
        suku Ad² biasanya mendominasi, itulah mengapa sayap WF yang jauh dari garis netral sangat efektif.
      </>,
      <>
        <b>Sumbu utama:</b> memutar sumbu mengubah Iu dan Iuv seperti tegangan di lingkaran Mohr: <code>tan 2θp = −2Ixy/(Ix − Iy)</code>.
        Penampang simetris punya Ixy = 0, jadi sumbu simetri adalah sumbu utama. Siku dan Z tidak.
      </>,
      <>
        <b>Elastis vs plastis:</b> S = I/c menentukan momen leleh pertama fy·S; Z = ΣA·|y − yp| menentukan momen plastis fy·Z. Faktor bentuk
        saat ini {fmt(pl.Zx / Math.min(pr.Sxt, pr.Sxb), 3)} (persegi 1,5; WF ≈ 1,1–1,15; lingkaran 1,7).
      </>,
    )
    tryThis.push('Pilih I / WF, perbesar tf: Ix naik cepat karena luas sayap dikali d². Perbesar tw: Ix hampir tidak berubah.')
    tryThis.push('Pilih Siku L lalu tekan "Ke sumbu utama": Iu = I1 dan Iuv = 0. Siku sama kaki (b = h) selalu 45°.')
    tryThis.push('Pilih T: garis netral plastis (titik-titik abu) tidak sama dengan garis netral elastis — luas atas = luas bawah, bukan momen.')
    tryThis.push('Bandingkan Pipa dengan bulat pejal (t = D/2) bermassa sama: rongga memindahkan luas ke tepi → I lebih besar per kg baja.')
    if (shape === 'zee') tryThis.push('Penampang Z: titik berat di tengah badan, tetapi Ixy besar — balok gording Z melendut miring bila tidak diikat.')
  } else if (setup === 'lentur') {
    concept.push(
      <>
        <b>Lentur sederhana</b> σ = −M·y/I (Mx positif menekan serat atas). Tegangan linear, nol di garis netral yang melewati titik berat
        bila N = 0.
      </>,
      <>
        <b>Aksial + lentur:</b> N menggeser garis netral sejajar. Gaya N di titik eksentris (ex, ey) setara dengan N sentris + Mx = −N·ey +
        My = −N·ex.
      </>,
      <>
        <b>Lentur dua arah / tak simetris:</b> bila Ixy ≠ 0 (siku, Z) garis netral <i>tidak</i> tegak lurus bidang momen; tegangan dihitung
        dengan Ix, Iy, Ixy atau dengan sumbu utama.
      </>,
      <>
        <b>Inti penampang (kern):</b> bila N tekan berada di dalam daerah oranye, seluruh penampang tertekan — syarat klasik pondasi
        tanpa tarik, kolom pasangan bata, dan beton prategang. Persegi: belah ketupat sepertiga tengah (b/6, h/6).
      </>,
    )
    tryThis.push('Tekan "Tekan sentris" lalu tarik titik N keluar perlahan: garis netral masuk penampang tepat saat titik keluar inti.')
    tryThis.push('Tekan "N di tepi inti": serat bawah σ = 0 persis, σ atas = 2·N/A.')
    tryThis.push('Pilih Siku L, beri Mx saja: garis netral miring dan tegangan maks bukan di serat paling atas.')
    tryThis.push('Beri N tarik: inti tetap sama, tetapi kini seluruh penampang tertarik bila titik di dalam inti.')
  } else {
    concept.push(
      <>
        <b>Geser lentur</b> τ = V·Q/(I·b): Q = A′·ȳ′ adalah momen pertama luas di atas potongan terhadap garis netral, b lebar potongan.
        τ nol di serat luar (Q = 0) dan biasanya maksimum di garis netral.
      </>,
      <>
        <b>Persegi</b> τmaks = 1,5·V/A (parabola), lingkaran 4/3·V/A, pipa tipis ≈ 2·V/A. Rata-rata V/A selalu meremehkan geser
        maksimum.
      </>,
      <>
        <b>WF:</b> di pertemuan sayap–badan b melompat dari bf ke tw sehingga τ melompat bf/tw kali. Badan memikul hampir seluruh V —
        dasar rumus praktis τ ≈ V/(h·tw).
      </>,
      <>
        <b>Batas rumus:</b> τ di sini adalah rata-rata selebar potongan horizontal. Di sayap tipis aliran geser sebenarnya mengalir
        mendatar (q = τ·t), dan pada kanal C resultannya memunculkan pusat geser di luar badan (lanjutan).
      </>,
    )
    tryThis.push('Pilih Persegi, potong di garis netral: τ/(V/A) = 1,5 persis. Geser potongan ke tepi: τ → 0.')
    tryThis.push('Pilih I / WF, tekan "Badan di bawah sayap": τ melompat dibanding tepat di dalam sayap. Lihat % V yang dipikul badan.')
    tryThis.push('Pilih Pipa, kecilkan t: τmaks/(V/A) mendekati 2.')
    tryThis.push('Bandingkan T dengan WF: garis netral T dekat sayap sehingga τ maks bergeser ke atas.')
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
