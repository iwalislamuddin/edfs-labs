import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { Segmented, Slider } from '../../ui/controls'
import { hooke, principal, principal3, PRESETS, tauAbs, transform, transformStrain, tresca, vonMises, type Stress } from './mohr'
import { clampParams, defaults, parseQuery, RANGES, SETUPS, stressOf, toQuery, wrapTheta, type Params, type Setup } from './model'
import { drawCurves, drawStage, fmt, hitZone, mohrState, mohrTarget, screenAngle, stepView, type Layout, type MohrView } from './stage'

export default function ElementRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [grabbing, setGrabbing] = useState(false)

  useEffect(() => onQuery(toQuery(setup, p)), [setup, p]) // eslint-disable-line react-hooks/exhaustive-deps

  const live = useRef({ setup, p })
  live.current = { setup, p }
  const stageRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<HTMLCanvasElement>(null)
  const layout = useRef<Layout | null>(null)
  const view = useRef<MohrView | null>(null)
  const drag = useRef<{ zone: 'el' | 'mohr'; last: number; th: number } | null>(null)

  useEffect(() => {
    let raf = 0
    const frame = () => {
      const L = live.current
      const c = stageRef.current
      if (c) {
        const { w, h, ctx } = fitCanvas(c)
        view.current = stepView(view.current, mohrTarget(L.setup, L.p))
        layout.current = drawStage(ctx, w, h, { setup: L.setup, p: L.p, base: mohrState(L.setup, L.p), view: view.current })
      }
      const pc = plotRef.current
      if (pc) {
        const { w, h, ctx } = fitCanvas(pc)
        drawCurves(ctx, w, h, L.setup, L.p)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const changeSetup = (s: Setup) => {
    setSetup(s)
    setP(defaults(s))
    view.current = null
  }
  const set = (key: keyof Params) => (val: number) => setP((old) => clampParams({ ...old, [key]: val }))
  const preset = (s: Stress, sz = 0) => setP((old) => clampParams({ ...old, ...s, sz, th: 0 }))

  // ---- pointer: putar elemen (di kiri) atau geser titik X′ di lingkaran Mohr (di kanan) ----
  const local = (e: React.PointerEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }
  const rotatable = () => live.current.setup !== 'tiga'
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l || !rotatable()) return
    const [x, y] = local(e)
    const zone = hitZone(l, x, y)
    if (!zone) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { zone, last: screenAngle(l, zone, x, y), th: live.current.p.th }
    setGrabbing(true)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    const d = drag.current
    if (!d) {
      e.currentTarget.style.cursor = rotatable() && hitZone(l, x, y) ? 'grab' : 'default'
      return
    }
    const a = screenAngle(l, d.zone, x, y)
    let da = a - d.last
    if (da > Math.PI) da -= 2 * Math.PI
    if (da < -Math.PI) da += 2 * Math.PI
    d.last = a
    // sudut layar naik = searah jarum jam; θ positif berlawanan jarum jam. Di Mohr titik berputar 2θ.
    d.th -= ((d.zone === 'mohr' ? 0.5 : 1) * da * 180) / Math.PI
    const th = wrapTheta(Math.round(d.th * 2) / 2)
    setP((old) => (old.th === th ? old : { ...old, th }))
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setGrabbing(false)
  }

  const s = stressOf(p)
  const pr = principal(s)

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Material &amp; Elemen › <b>Room Element</b>
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
            <div className="stage-tip wide-only">
              {setup === 'tiga'
                ? 'Arsiran = semua pasangan (σ, τ) yang mungkin pada bidang sembarang di titik ini.'
                : 'Putar elemen dengan menariknya, atau tarik titik X′ di lingkaran Mohr (berputar 2θ).'}
            </div>
          </div>
          <div className="card plot-card">
            <div className="plot-head">
              <b>{setup === 'regangan' ? 'Regangan' : 'Tegangan'} terhadap sudut putar θ</b>
              <span style={{ color: 'var(--mute)', fontSize: 13 }}>titik ungu: bidang utama (θp) dan geser maks (θs)</span>
            </div>
            <canvas ref={plotRef} className="plot" />
          </div>
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Keadaan tegangan</h3>
            <div className="btn-row" style={{ marginTop: 0, marginBottom: 12 }}>
              {PRESETS.map((x) => (
                <button key={x.id} className="btn ghost sm" title={x.hint} onClick={() => preset(x.s, x.sz)}>
                  {x.label}
                </button>
              ))}
            </div>
            <Slider label="Tegangan normal arah x" symbol="σx" unit="MPa" value={p.sx} {...RANGES.sx} onChange={set('sx')} />
            <Slider label="Tegangan normal arah y" symbol="σy" unit="MPa" value={p.sy} {...RANGES.sy} onChange={set('sy')} />
            <Slider label="Tegangan geser" symbol="τxy" unit="MPa" value={p.txy} {...RANGES.txy} onChange={set('txy')} />
            {setup === 'tiga' && (
              <Slider label="Tegangan normal arah z" symbol="σz" unit="MPa" value={p.sz} {...RANGES.sz} onChange={set('sz')} hint="σz = 0: tegangan bidang (pelat tipis, permukaan bebas)" />
            )}
          </div>

          {setup !== 'tiga' && (
            <div className="card">
              <h3>Rotasi elemen</h3>
              <Slider label="Sudut putar (berlawanan jarum jam)" symbol="θ" unit="°" value={p.th} {...RANGES.th} onChange={set('th')} />
              <div className="btn-row" style={{ marginTop: 0 }}>
                <button className="btn ghost sm" onClick={() => set('th')(Math.round(pr.thetaP * 2) / 2)} disabled={pr.R < 1e-9}>
                  Ke bidang utama
                </button>
                <button className="btn ghost sm" onClick={() => set('th')(Math.round(pr.thetaS * 2) / 2)} disabled={pr.R < 1e-9}>
                  Ke geser maks
                </button>
                <button className="btn ghost sm" onClick={() => set('th')(0)}>
                  θ = 0
                </button>
              </div>
            </div>
          )}

          {setup === 'regangan' && (
            <div className="card">
              <h3>Material</h3>
              <Slider label="Modulus elastisitas" symbol="E" unit="GPa" value={p.E} {...RANGES.E} onChange={set('E')} hint="baja 200 · aluminium 70 · beton ≈ 25 (fc′ 28 MPa)" />
              <Slider label="Rasio Poisson" symbol="ν" unit="" value={p.nu} {...RANGES.nu} onChange={set('nu')} hint="baja 0,30 · beton 0,20 · karet ≈ 0,50" />
              <Slider label="Pembesar gambar deformasi" symbol="k" unit="×" value={p.k} {...RANGES.k} onChange={set('k')} />
            </div>
          )}

          <div className="card">
            <h3>Rumus vs pindai θ</h3>
            <ResultTable setup={setup} p={p} />
          </div>
        </aside>
      </div>

      <Notes setup={setup} p={p} />
    </div>
  )
}

// ---------- tabel hasil ----------

/** "Terukur": pindai θ dari −90° sampai 90° (langkah 0,05°) seperti membaca lingkaran Mohr dengan busur derajat. */
function scan(s: Stress) {
  let s1 = -Infinity
  let s2 = Infinity
  let tm = 0
  let thP = 0
  for (let i = 0; i <= 3600; i++) {
    const th = -90 + i * 0.05
    const t = transform(s, th)
    if (t.sx > s1) {
      s1 = t.sx
      thP = th
    }
    s2 = Math.min(s2, t.sx)
    tm = Math.max(tm, Math.abs(t.txy))
  }
  return { s1, s2, tm, thP }
}

type Row = [string, number | null, number | null, string, number?]

function ResultTable({ setup, p }: { setup: Setup; p: Params }) {
  const s = stressOf(p)
  const pr = principal(s)
  const sc = scan(s)
  const rows: Row[] = []
  if (setup === 'tegangan') {
    const r = transform(s, p.th)
    rows.push(['σx′ pada θ', r.sx, null, 'MPa'])
    rows.push(['σy′ pada θ', r.sy, null, 'MPa'])
    rows.push(['τx′y′ pada θ', r.txy, null, 'MPa'])
    rows.push(['Pusat C = (σx+σy)/2', pr.C, null, 'MPa'])
    rows.push(['σ1 = C + R', pr.s1, sc.s1, 'MPa'])
    rows.push(['σ2 = C − R', pr.s2, sc.s2, 'MPa'])
    rows.push(['θp (bidang σ1)', pr.thetaP, sc.thP, '°'])
    rows.push(['τmaks bidang = R', pr.R, sc.tm, 'MPa'])
    rows.push(['θs (geser maks)', pr.thetaS, null, '°'])
    rows.push(['Von Mises σvm', vonMises(s), null, 'MPa'])
    rows.push(['Tresca σ1 − σ3', tresca(s), null, 'MPa'])
  } else if (setup === 'regangan') {
    const e = hooke(s, p.E, p.nu)
    const ep = principal({ sx: e.ex, sy: e.ey, txy: e.gxy / 2 })
    const et = transformStrain(e, p.th)
    const u = 1e6
    rows.push(['εx = (σx − νσy)/E', e.ex * u, null, 'µε', 0])
    rows.push(['εy = (σy − νσx)/E', e.ey * u, null, 'µε', 0])
    rows.push(['γxy = τxy/G', e.gxy * u, null, 'µε', 0])
    rows.push(['εz = −ν(σx+σy)/E', e.ez * u, null, 'µε', 0])
    rows.push(['Modulus geser G = E/2(1+ν)', e.G, null, 'GPa', 2])
    rows.push(['ε1', ep.s1 * u, (pr.s1 - p.nu * pr.s2) / (p.E * 1000) * u, 'µε', 0])
    rows.push(['ε2', ep.s2 * u, (pr.s2 - p.nu * pr.s1) / (p.E * 1000) * u, 'µε', 0])
    rows.push(['θp regangan / tegangan', ep.thetaP, pr.thetaP, '°'])
    rows.push(['Gauge pada θ: εx′', et.ex * u, null, 'µε', 0])
    rows.push(['Regangan volume εv', e.ev * u, null, 'µε', 0])
  } else {
    const [a1, a2, a3] = principal3(s, p.sz)
    rows.push(['σ1', a1, null, 'MPa'])
    rows.push(['σ2', a2, null, 'MPa'])
    rows.push(['σ3', a3, null, 'MPa'])
    rows.push(['τmaks bidang xy = R', pr.R, sc.tm, 'MPa'])
    rows.push(['τmaks mutlak = (σ1 − σ3)/2', tauAbs(s, p.sz), null, 'MPa'])
    rows.push(['Von Mises σvm', vonMises(s, p.sz), null, 'MPa'])
    rows.push(['Tresca σ1 − σ3', tresca(s, p.sz), null, 'MPa'])
    rows.push(['Tegangan rata-rata (σ1+σ2+σ3)/3', (a1 + a2 + a3) / 3, null, 'MPa'])
  }
  const second = setup === 'regangan' ? 'Dari σ1, σ2' : 'Pindai θ'
  return (
    <>
      <table className="readout">
        <thead>
          <tr>
            <th />
            <th>Rumus</th>
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
      {setup !== 'regangan' && (
        <small className="slider-hint" style={{ marginTop: 6 }}>
          Kolom kanan diperoleh dengan memutar elemen 0,05° demi 0,05° dan mencatat nilai ekstrem.
        </small>
      )}
      {setup === 'regangan' && (
        <small className="slider-hint" style={{ marginTop: 6 }}>
          Kolom kanan: Hooke diterapkan langsung pada tegangan utama — arah utama regangan sama dengan tegangan (bahan isotrop).
        </small>
      )}
    </>
  )
}

// ---------- catatan ----------

function Notes({ setup, p }: { setup: Setup; p: Params }) {
  const s = stressOf(p)
  const pr = principal(s)
  const concept: React.ReactNode[] = []
  const tryThis: React.ReactNode[] = []
  if (setup === 'tegangan') {
    concept.push(
      <>
        <b>Satu titik, banyak wajah:</b> keadaan tegangan di sebuah titik tetap sama, tetapi nilai σ dan τ yang &quot;dilihat&quot; bergantung
        pada arah bidang potong. Rumus transformasi: <code>σx′ = C + ½(σx−σy)cos 2θ + τxy sin 2θ</code>,{' '}
        <code>τx′y′ = −½(σx−σy)sin 2θ + τxy cos 2θ</code>.
      </>,
      <>
        <b>Lingkaran Mohr</b> menggambar semua pasangan (σx′, τx′y′) sekaligus: pusat C = (σx+σy)/2, jari-jari R = √(((σx−σy)/2)² + τxy²).
        Memutar elemen θ memutar titik X di lingkaran sebesar <b>2θ</b> ke arah yang sama.
      </>,
      <>
        <b>Tegangan utama</b> σ1, σ2 bekerja pada bidang tanpa geser (θp), saling tegak lurus. Geser maksimum R terjadi 45° dari bidang
        utama, dan di sana σ = C (bukan nol!).
      </>,
      <>
        <b>Invarian:</b> σx′ + σy′ selalu = σx + σy = {fmt(p.sx + p.sy)} MPa, berapa pun θ. Itulah mengapa pusat lingkaran tidak bergerak.
      </>,
    )
    tryThis.push('Pilih "Tarik uniaksial", putar ke 45°: muncul geser σ/2 — alasan baja ulet leleh dengan garis Lüders miring 45°.')
    tryThis.push('Pilih "Geser murni" lalu tekan "Ke bidang utama": tarik dan tekan sama besar pada 45° — beton pecah miring akibat torsi.')
    tryThis.push(`Tarik titik X′ satu putaran penuh di lingkaran: elemen hanya berputar 180°. Sekarang θp = ${fmt(pr.thetaP)}°.`)
    tryThis.push('Pilih "Balok (lentur + geser)": arah σ1 menjelaskan retak geser-lentur miring di dekat tumpuan balok beton.')
  } else if (setup === 'regangan') {
    concept.push(
      <>
        <b>Hukum Hooke 2D:</b> <code>εx = (σx − νσy)/E</code>, <code>εy = (σy − νσx)/E</code>, <code>γxy = τxy/G</code> dengan{' '}
        <code>G = E/2(1+ν)</code>. Tarik arah x membuat elemen memendek arah y: itulah efek Poisson.
      </>,
      <>
        <b>Regangan juga punya lingkaran Mohr</b> dengan sumbu ε dan γ/2 (setengah regangan geser teknik). Bentuknya sama persis dengan
        tegangan — pada bahan isotrop arah utama keduanya berimpit.
      </>,
      <>
        <b>Strain gauge</b> hanya mengukur regangan normal di satu arah. Dengan tiga gauge (rosette 0°–45°–90°): εx = ε0, εy = ε90,
        γxy = 2ε45 − ε0 − ε90 — lalu tegangan dihitung balik dengan Hooke.
      </>,
    )
    tryThis.push('Putar ke bidang utama: kotak terdeformasi menjadi persegi panjang (sudut tetap 90°). Pada sudut lain kotak menjadi jajaran genjang.')
    tryThis.push('Set ν = 0,5 dan σx = −σy: regangan volume nol (bahan tak termampatkan seperti karet).')
    tryThis.push('Baca gauge pada θ = 0°, 45°, 90° lalu cocokkan γxy di tabel dengan rumus rosette.')
    tryThis.push('Turunkan E dari 200 (baja) ke 70 (aluminium): tegangan sama, regangan hampir 3× lebih besar.')
  } else {
    concept.push(
      <>
        <b>Tiga lingkaran Mohr:</b> bila σz juga tegangan utama, ada tiga lingkaran di antara σ1, σ2, σ3. Semua bidang potong sembarang
        menghasilkan titik di daerah arsiran — di dalam lingkaran besar, di luar dua yang kecil.
      </>,
      <>
        <b>Geser maksimum mutlak</b> = (σ1 − σ3)/2 dari lingkaran terbesar. Pada tegangan bidang dengan σ1 dan σ2 bertanda sama, nilainya
        lebih besar dari R bidang xy — bidang kritisnya miring keluar bidang.
      </>,
      <>
        <b>Kriteria leleh:</b> Tresca memakai σ1 − σ3, Von Mises memakai ketiga selisih. Tekanan hidrostatik (σ1 = σ2 = σ3) tidak
        menimbulkan geser, sehingga tidak membuat logam leleh.
      </>,
    )
    tryThis.push('Pipa bertekanan (σx = 40, σy = 80, σz = 0): geser mutlak 40 MPa, dua kali R bidang xy — dinding pipa leleh pada bidang 45° terhadap tebal.')
    tryThis.push('Set σx = σy = σz: ketiga lingkaran mengecil menjadi titik dan Von Mises = 0.')
    tryThis.push('Beri σz tekan (−50) pada keadaan geser murni: lingkaran luar membesar, Tresca naik meskipun bidang xy tidak berubah.')
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
