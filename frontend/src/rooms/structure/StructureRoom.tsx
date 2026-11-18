import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas } from '../../lab/draw'
import { analyze, sampleAt, type FrameResult } from '../../lab/frame2d'
import { Check, Segmented, Slider } from '../../ui/controls'
import { bounds, build, clampParams, defaults, parseQuery, ranges, SETUPS, toQuery, TRUSS_TYPES, type Built, type Params, type Setup } from './model'
import { drawStage, fmt, hitHandle, hitMember, targetView, type Diagram, type Hover, type Layout, type View } from './stage'
import { cantilever, continuous2, portalHingedH, simpleBeam, trussChord } from './theory'

const DIAGRAMS: { id: Diagram; label: string; title: string }[] = [
  { id: 'def', label: 'Lendutan', title: 'Bentuk lendutan (diperbesar)' },
  { id: 'N', label: 'N', title: 'Gaya aksial' },
  { id: 'V', label: 'V', title: 'Gaya geser' },
  { id: 'M', label: 'M', title: 'Momen lentur' },
]

const segOf = (s: Setup) => (s === 'portal' || s === 'gable' ? 12 : 24)

function solve(setup: Setup, p: Params): { built: Built; res: FrameResult } {
  const built = build(setup, p)
  return { built, res: analyze(built.frame, segOf(setup)) }
}

export default function StructureRoom({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const init = useMemo(() => parseQuery(query), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setup, setSetup] = useState<Setup>(init.setup)
  const [p, setP] = useState<Params>(init.params)
  const [diagram, setDiagram] = useState<Diagram>(init.setup === 'truss' ? 'N' : 'M')
  const [show, setShow] = useState({ reactions: true, values: true, loads: true })
  const [hover, setHover] = useState<Hover | null>(null)
  const [grabbing, setGrabbing] = useState(false)

  const { built, res } = useMemo(() => solve(setup, p), [setup, p])
  const rg = ranges(setup, p)

  useEffect(() => onQuery(toQuery(setup, p)), [setup, p]) // eslint-disable-line react-hooks/exhaustive-deps

  const live = useRef({ setup, p, built, res, diagram, show, hover })
  live.current = { setup, p, built, res, diagram, show, hover }
  const stageRef = useRef<HTMLCanvasElement>(null)
  const layout = useRef<Layout | null>(null)
  const view = useRef<View | null>(null)
  const drag = useRef(false)

  // gambar ulang tiap frame (murah: hasil analisis sudah di-memo); skala panggung dihaluskan saat geometri berubah
  useEffect(() => {
    let raf = 0
    const frame = () => {
      const L = live.current
      const c = stageRef.current
      if (c) {
        const { w, h, ctx } = fitCanvas(c)
        const tv = targetView(L.setup, L.p, w, h)
        const v = view.current
        const k = drag.current ? 1 : 0.18
        view.current = v ? { s: v.s + (tv.s - v.s) * k, ox: v.ox + (tv.ox - v.ox) * k, oy: v.oy + (tv.oy - v.oy) * k } : tv
        layout.current = drawStage(ctx, w, h, view.current, {
          setup: L.setup,
          p: L.p,
          built: L.built,
          res: L.res,
          diagram: L.diagram,
          reactions: L.show.reactions,
          values: L.show.values,
          loads: L.show.loads,
          hover: L.hover,
        })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const changeSetup = (s: Setup) => {
    setSetup(s)
    setP(defaults(s))
    setHover(null)
    setDiagram(s === 'truss' ? 'N' : 'M')
    view.current = null
  }
  const set = (key: keyof Params) => (val: number) => setP((old) => clampParams(setup, { ...old, [key]: val }))

  // ---- pointer ----
  const local = (e: React.PointerEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }
  const aFromX = (x: number) => {
    const l = layout.current
    const tr = live.current.built.track
    if (!l || !tr) return 0
    return (x - l.view.ox) / l.view.s - tr.x0
  }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    if (!hitHandle(l, x, y)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = true
    setGrabbing(true)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const l = layout.current
    if (!l) return
    const [x, y] = local(e)
    if (drag.current) {
      const a = aFromX(x)
      setP((old) => {
        const n = clampParams(live.current.setup, { ...old, a: Math.round(a * 20) / 20 })
        return n.a === old.a ? old : n
      })
      return
    }
    const onHandle = hitHandle(l, x, y)
    e.currentTarget.style.cursor = onHandle ? 'grab' : 'default'
    const hv = onHandle ? null : hitMember(l, live.current.built, live.current.res, x, y)
    setHover((old) => (old?.member === hv?.member && old?.s === hv?.s ? old : hv))
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = false
    setGrabbing(false)
  }

  const hv = hover && res.members[hover.member] ? { name: built.names[hover.member], st: sampleAt(res.members[hover.member], hover.s) } : null
  const beam = setup === 'sederhana' || setup === 'kantilever' || setup === 'menerus'
  const hasP = setup !== 'gable'

  return (
    <div className="room">
      <div className="room-bar">
        <a href="#/" className="crumb">
          ← Lobby
        </a>
        <span className="crumb-path">
          Zone Statika &amp; Struktur › <b>Room Structure Model</b>
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
              onPointerLeave={() => !drag.current && setHover(null)}
            />
            <div className="stage-tip">
              {hasP && p.P > 0
                ? setup === 'truss'
                  ? 'Geser beban P (oranye) ke simpul lain · arahkan kursor ke batang untuk membaca nilainya.'
                  : 'Geser beban P (oranye) di sepanjang batang · arahkan kursor ke batang untuk membaca N, V, M, δ.'
                : 'Arahkan kursor ke batang untuk membaca N, V, M, δ di titik itu.'}
            </div>
            <div className="stage-live">
              {hv ? (
                <>
                  <b style={{ color: 'var(--ink)' }}>{hv.name}</b>
                  <span>s = {hv.st.s.toFixed(2)} m</span>
                  <span>N = {fmt(hv.st.N)} kN</span>
                  {setup !== 'truss' && (
                    <>
                      <span>V = {fmt(hv.st.V)} kN</span>
                      <span>M = {fmt(hv.st.M)} kN·m</span>
                    </>
                  )}
                  <span>δ = {fmt(Math.hypot(hv.st.ux, hv.st.uy) * 1000)} mm</span>
                </>
              ) : (
                <span>δmaks = {fmt(res.maxDisp * 1000)} mm</span>
              )}
            </div>
          </div>
          <div className="card">
            <div className="plot-head">
              <b>Tampilkan</b>
              <div className="plot-opts">
                <Check label="Beban" checked={show.loads} onChange={(v) => setShow({ ...show, loads: v })} />
                <Check label="Reaksi" checked={show.reactions} onChange={(v) => setShow({ ...show, reactions: v })} />
                <Check label="Nilai" checked={show.values} onChange={(v) => setShow({ ...show, values: v })} />
              </div>
            </div>
            <Segmented value={diagram} options={DIAGRAMS} onChange={setDiagram} />
          </div>
        </section>

        <aside className="side-col">
          <div className="card">
            <h3>Geometri & material</h3>
            {setup === 'menerus' ? (
              <>
                <Slider label="Bentang 1" symbol="L₁" unit="m" value={p.L} {...rg.L} onChange={set('L')} />
                <Slider label="Bentang 2" symbol="L₂" unit="m" value={p.L2} {...rg.L2} onChange={set('L2')} />
              </>
            ) : (
              <Slider label="Bentang" symbol="L" unit="m" value={p.L} {...rg.L} onChange={set('L')} />
            )}
            {(setup === 'portal' || setup === 'gable' || setup === 'truss') && (
              <Slider label={setup === 'truss' ? 'Tinggi rangka' : 'Tinggi kolom'} symbol="h" unit="m" value={p.h} {...rg.h} onChange={set('h')} />
            )}
            {setup === 'gable' && <Slider label="Tinggi puncak atap" symbol="f" unit="m" value={p.f} {...rg.f} onChange={set('f')} />}
            {setup === 'truss' ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Segmented
                    value={String(Math.round(p.tp))}
                    options={TRUSS_TYPES.map((t, i) => ({ id: String(i), label: t }))}
                    onChange={(v) => set('tp')(Number(v))}
                  />
                </div>
                <Slider label="Jumlah panel" symbol="n" unit="panel" value={p.n} {...rg.n} onChange={set('n')} />
                <Slider label="Kekakuan aksial" symbol="EA" unit="kN" value={p.EA} {...rg.EA} onChange={set('EA')} hint="baja, A = 1000 mm² → EA = 200 000 kN" />
              </>
            ) : (
              <Slider
                label="Kekakuan lentur"
                symbol="EI"
                unit="kN·m²"
                value={p.EI}
                {...rg.EI}
                onChange={set('EI')}
                hint="WF 200·100: E = 200 GPa, I = 1840 cm⁴ → EI ≈ 3 680 kN·m²"
              />
            )}
            {(setup === 'portal' || setup === 'gable') && (
              <>
                <Slider label={setup === 'gable' ? 'Rasio I kasau / I kolom' : 'Rasio I balok / I kolom'} symbol="r" unit="" value={p.r} {...rg.r} onChange={set('r')} />
                <div className="btn-row" style={{ marginTop: 0 }}>
                  <span style={{ fontSize: 14 }}>Tumpuan dasar</span>
                  <Segmented
                    value={p.bj ? 'jepit' : 'sendi'}
                    options={[
                      { id: 'jepit', label: 'Jepit' },
                      { id: 'sendi', label: 'Sendi' },
                    ]}
                    onChange={(v) => set('bj')(v === 'jepit' ? 1 : 0)}
                  />
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h3>Beban</h3>
            {hasP && (
              <>
                <Slider label="Beban terpusat" symbol="P" unit="kN" value={p.P} {...rg.P} onChange={set('P')} />
                <Slider
                  label={setup === 'truss' ? 'Posisi P (simpul bawah)' : 'Posisi P dari kiri'}
                  symbol="a"
                  unit="m"
                  value={p.a}
                  {...rg.a}
                  onChange={set('a')}
                />
              </>
            )}
            {setup === 'truss' ? (
              <Slider label="Beban tiap simpul bawah" symbol="w" unit="kN" value={p.w} {...rg.w} onChange={set('w')} />
            ) : (
              <Slider
                label={setup === 'gable' ? 'Beban merata atap' : setup === 'portal' ? 'Beban merata balok' : 'Beban merata'}
                symbol="q"
                unit="kN/m"
                value={p.q}
                {...rg.q}
                onChange={set('q')}
              />
            )}
            {(setup === 'portal' || setup === 'gable') && (
              <Slider label="Beban lateral (angin/gempa)" symbol="W" unit="kN" value={p.W} {...rg.W} onChange={set('W')} />
            )}
            <div className="btn-row">
              {hasP && (
                <button className="btn ghost sm" onClick={() => set('a')(trackLen(setup, p) / 2)}>
                  P di tengah
                </button>
              )}
              {setup === 'menerus' && (
                <button className="btn ghost sm" onClick={() => set('a')(p.L / 2)}>
                  P di tengah bentang 1
                </button>
              )}
              <button className="btn ghost sm" onClick={() => setP(defaults(setup))}>
                Bawaan
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Teori vs matriks kekakuan</h3>
            <TheoryTable setup={setup} p={p} built={built} res={res} />
          </div>

          <div className="card">
            <h3>Gaya batang</h3>
            <MemberTable setup={setup} built={built} res={res} />
          </div>
        </aside>
      </div>

      <Notes setup={setup} p={p} beam={beam} />
    </div>
  )
}

const trackLen = (s: Setup, p: Params) => bounds(s, p).x1

// ---------- tabel ----------

function TheoryTable({ setup, p, built, res }: { setup: Setup; p: Params; built: Built; res: FrameResult }) {
  if (!res.ok) return <p style={{ fontSize: 14, color: 'var(--mute)' }}>Struktur labil — tidak ada solusi statik.</p>
  const R = res.reactions
  const m0 = res.members[0]
  const rows: [string, number | null, number, string][] = [] // label, teori, matriks, satuan
  const allM = res.members.flatMap((m) => m.stations.map((s) => s.M))
  const span = setup === 'menerus' ? Math.max(p.L, p.L2) : p.L // bentang terpanjang

  if (setup === 'sederhana') {
    const t = simpleBeam(p.L, p.P, p.a, p.q, p.EI)
    rows.push(['Reaksi R_A', t.RA, R[0].ry, 'kN'])
    rows.push(['Reaksi R_B', t.RB, R[1].ry, 'kN'])
    rows.push([`M maks (x = ${t.xMax.toFixed(2)} m)`, t.Mmax, Math.max(...allM), 'kN·m'])
    rows.push(['δ di tengah bentang', t.dMid * 1000, -sampleAt(m0, p.L / 2).uy * 1000, 'mm'])
  } else if (setup === 'kantilever') {
    const t = cantilever(p.L, p.P, p.a, p.q, p.EI)
    rows.push(['Reaksi vertikal R', t.R, R[0].ry, 'kN'])
    rows.push(['Momen jepit M_A', t.MA, m0.stations[0].M, 'kN·m'])
    rows.push(['δ di ujung bebas', t.dTip * 1000, -m0.stations[m0.stations.length - 1].uy * 1000, 'mm'])
  } else if (setup === 'menerus') {
    const t = continuous2(p.L, p.L2, p.P, p.a, p.q)
    rows.push(['Momen tumpuan tengah M_B', t.MB, m0.stations[m0.stations.length - 1].M, 'kN·m'])
    rows.push(['Reaksi R_A', t.RA, R[0].ry, 'kN'])
    rows.push(['Reaksi R_B (tengah)', t.RB, R[1].ry, 'kN'])
    rows.push(['Reaksi R_C', t.RC, R[2].ry, 'kN'])
  } else if (setup === 'portal' || setup === 'gable') {
    const loadV = p.q * p.L + (setup === 'portal' ? p.P : 0)
    rows.push(['Σ reaksi vertikal = Σ beban', loadV, R.reduce((a, r) => a + r.ry, 0), 'kN'])
    rows.push(['Σ reaksi horizontal = −W', -p.W, R.reduce((a, r) => a + r.rx, 0), 'kN'])
    if (setup === 'portal' && !p.bj && p.W === 0) {
      rows.push(['H tumpuan (dua sendi)', portalHingedH(p.L, p.h, p.q, p.P, p.a, p.r), R[0].rx, 'kN'])
    }
    rows.push(['M maks positif', null, Math.max(...allM), 'kN·m'])
    rows.push(['M maks negatif', null, Math.min(...allM), 'kN·m'])
  } else {
    const t = trussChord(p)
    rows.push(['Reaksi R_A', t.RA, R[0].ry, 'kN'])
    rows.push(['Reaksi R_B', t.RB, R[1].ry, 'kN'])
    rows.push([`Batang ${built.names[built.focus]} (Ritter, M/h)`, t.F, res.members[built.focus].stations[0].N, 'kN'])
  }
  const dMax = res.maxDisp * 1000
  return (
    <>
      <table className="readout">
        <thead>
          <tr>
            <th />
            <th>Teori</th>
            <th>Matriks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([lab, t, m, u]) => (
            <tr key={lab}>
              <th>{lab}</th>
              <td>{t === null ? '—' : `${fmt(t)}`}</td>
              <td>
                {fmt(m)} <small>{u}</small>
              </td>
            </tr>
          ))}
          <tr>
            <th>Lendutan maks δ</th>
            <td>—</td>
            <td>
              {fmt(dMax)} <small>mm</small>
            </td>
          </tr>
          <tr>
            <th>Rasio L/δ</th>
            <td>
              <small>batas umum L/240 – L/360</small>
            </td>
            <td>{dMax > 1e-9 ? `L/${Math.round((span * 1000) / dMax)}` : '—'}</td>
          </tr>
        </tbody>
      </table>
      {setup === 'portal' && !p.bj && p.W !== 0 && (
        <small className="slider-hint" style={{ marginTop: 6 }}>
          Rumus H dua sendi ditampilkan bila W = 0.
        </small>
      )}
      {setup === 'portal' && !p.bj && p.W === 0 && (
        <small className="slider-hint" style={{ marginTop: 6 }}>
          Rumus mengabaikan deformasi aksial, karena itu selisihnya kecil.
        </small>
      )}
    </>
  )
}

function MemberTable({ setup, built, res }: { setup: Setup; built: Built; res: FrameResult }) {
  if (!res.ok) return null
  const truss = setup === 'truss'
  return (
    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
      <table className="readout">
        <thead>
          <tr>
            <th>Batang</th>
            <th>N {truss ? '' : 'ujung'}</th>
            {truss ? <th /> : <th>M min / maks</th>}
          </tr>
        </thead>
        <tbody>
          {res.members.map((mr, i) => {
            const st = mr.stations
            const N0 = st[0].N
            const N1 = st[st.length - 1].N
            const Ms = st.map((s) => s.M)
            return (
              <tr key={i}>
                <th>{built.names[i]}</th>
                <td>{truss || Math.abs(N0 - N1) < 1e-6 ? fmt(N0) : `${fmt(N0)} … ${fmt(N1)}`}</td>
                {truss ? (
                  <td>
                    <small>{Math.abs(N0) < 1e-6 ? 'nol' : N0 > 0 ? 'tarik' : 'tekan'}</small>
                  </td>
                ) : (
                  <td>
                    {fmt(Math.min(...Ms))} / {fmt(Math.max(...Ms))}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- catatan ----------

function Notes({ setup, p, beam }: { setup: Setup; p: Params; beam: boolean }) {
  const concept: React.ReactNode[] = []
  const tryThis: React.ReactNode[] = []
  concept.push(
    <>
      <b>Metode kekakuan langsung:</b> tiap batang punya matriks kekakuan 6×6 (EA/L, 12EI/L³, 6EI/L², 4EI/L, 2EI/L). Matriks dirakit
      menjadi <code>K·D = F</code>, tumpuan mengunci derajat kebebasan, lalu D (perpindahan) diselesaikan. Gaya dalam dan reaksi dihitung
      balik dari D — cara yang sama dipakai EDFS Matrix dan software struktur lain.
    </>,
  )
  if (beam) {
    concept.push(
      <>
        <b>Hubungan q–V–M:</b> <code>dV/dx = −q</code> dan <code>dM/dx = V</code>. Di bawah beban merata V linear dan M parabola; di
        bawah beban terpusat V meloncat sebesar P dan M membentuk sudut. M maksimum terjadi di titik V = 0.
      </>,
    )
    concept.push(
      <>
        <b>Lendutan:</b> <code>EI·v″ = −M</code>. Lendutan sebanding dengan beban dan berbanding terbalik dengan EI — EI dua kali
        lipat, lendutan setengahnya, tetapi diagram M tidak berubah (balok statis tertentu).
      </>,
    )
  }
  if (setup === 'sederhana') {
    tryThis.push('Geser P dari tumpuan kiri ke kanan: R_A turun linear, R_B naik. Momen maks terbesar saat P di tengah: PL/4.')
    tryThis.push(`Set P = 0: momen maks = qL²/8 = ${fmt((p.q * p.L * p.L) / 8)} kN·m, lendutan 5qL⁴/384EI.`)
    tryThis.push('Gandakan L: momen akibat q menjadi 4×, lendutan 16× — bentang sangat menentukan.')
  } else if (setup === 'kantilever') {
    tryThis.push('Pindahkan P ke ujung: momen jepit = P·L, lendutan ujung PL³/3EI.')
    tryThis.push('Perhatikan seluruh momen bernilai negatif (hogging): tulangan utama kantilever ada di sisi atas.')
  } else if (setup === 'menerus') {
    concept.push(
      <>
        <b>Statis tak tentu:</b> 3 reaksi vertikal, hanya 2 persamaan keseimbangan yang berguna. Persamaan tiga momen (Clapeyron)
        memberi M_B; hasilnya sama persis dengan metode kekakuan.
      </>,
    )
    tryThis.push('Dua bentang sama, q penuh, P = 0: M_B = −qL²/8 dan reaksi tengah = 1,25·qL (bukan qL!).')
    tryThis.push('Taruh P hanya di bentang 1: bentang 2 ikut melengkung ke atas dan R_C bisa negatif (tumpuan tertarik).')
    tryThis.push('Ubah EI: lendutan berubah, M tidak — distribusi momen hanya ditentukan rasio kekakuan antarbatang (di sini EI seragam).')
  } else if (setup === 'portal' || setup === 'gable') {
    concept.push(
      <>
        <b>Kekakuan relatif menentukan momen:</b> pada struktur statis tak tentu, momen terbagi menurut kekakuan batang. Balok kaku
        (r besar) menahan lebih banyak momen lapangan; kolom kaku (r kecil) menjepit balok lebih kuat.
      </>,
    )
    concept.push(
      <>
        <b>Sendi vs jepit:</b> tumpuan sendi tidak menahan momen, sehingga portal lebih lentur terhadap beban lateral W dan momen kolom
        terbesar pindah ke sambungan balok–kolom.
      </>,
    )
    if (setup === 'gable') {
      concept.push(
        <>
          <b>Dorongan horizontal:</b> kasau miring mendorong puncak kolom ke luar; tumpuan menahan dengan reaksi horizontal ke dalam.
          Makin landai atap (f kecil), makin besar dorongannya.
        </>,
      )
      tryThis.push('Turunkan f ke 0 (atap datar) lalu naikkan ke 6 m: amati reaksi horizontal dan momen di puncak kolom.')
    }
    tryThis.push('Ubah r dari 0,2 sampai 5 dan perhatikan momen di sambungan balok–kolom berpindah ke tengah bentang.')
    tryThis.push('Ganti tumpuan jepit ↔ sendi dengan beban lateral W saja (q = 0): bandingkan lendutan dan momen dasar kolom.')
    tryThis.push('Tampilkan N: di bawah beban gravitasi kolom tertekan; beban W menarik satu kolom dan menekan kolom lain.')
  } else {
    concept.push(
      <>
        <b>Rangka ideal:</b> semua sambungan sendi dan beban hanya di simpul, sehingga tiap batang hanya memikul gaya aksial — tarik
        (biru) atau tekan (merah). Tebal garis sebanding dengan |N|.
      </>,
    )
    concept.push(
      <>
        <b>Metode potongan (Ritter):</b> potong rangka melalui tiga batang, ambil momen terhadap titik pertemuan dua batang lainnya:
        gaya batang bawah = M/h, dengan M momen balok sederhana ekivalen.
      </>,
    )
    tryThis.push('Bandingkan Pratt dan Howe: diagonal Pratt tarik, diagonal Howe tekan. Mengapa Pratt populer untuk baja (batang tekan pendek)?')
    tryThis.push('Gandakan tinggi h: gaya batang tepi menjadi setengahnya, lendutan jauh berkurang.')
    tryThis.push('Pada Pratt, beban hanya di satu simpul: cari batang tegak yang gayanya nol, lalu jelaskan dengan keseimbangan simpul.')
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
