# EDFS Labs — panduan untuk Claude

Laboratorium virtual 2D simulasi fisika–matematika teknik sipil (keluarga Edifisia, rencana `labs.edifisia.com`).
Repo: https://github.com/iwalislamuddin/edfs-labs (branch `main`). Konsep lengkap dan roadmap: [docs/KONSEP.md](docs/KONSEP.md) —
baca dulu sebelum menambah Zone/Room.

## Konvensi
- Kode, komentar, dan pesan commit dalam **Bahasa Indonesia**. UI saat ini ID (EN menyusul).
- Istilah: **Zone** (bidang ilmu) → **Room** (satu simulator). Daftar Zone/Room ada di `frontend/src/catalog.ts`.
- Hanya 2D (Canvas 2D), tanpa backend dulu. Parameter eksperimen disimpan di URL hash (`#/<room>?m=..&k=..`) agar bisa dibagikan.
- Token warna selaras `edifisia-platform` (lihat `frontend/src/styles.css` dan `frontend/src/lab/theme.ts`).
- Repo saudara (untuk rujukan pola, di luar folder ini): edfs-matrix, edfs-base, edifisia-platform.

## Menjalankan
```bash
npm --prefix frontend install
npm --prefix frontend run dev     # http://localhost:5180 (pindah ke 5181 kalau port terpakai)
npm --prefix frontend test        # vitest: uji fisika
npm --prefix frontend run build   # tsc --noEmit + vite build
```
Di Windows PowerShell, `npm` butuh `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (sudah diatur).
Preview Claude: konfigurasi `labs` di `.claude/launch.json`.

## Struktur `frontend/src`
- `lab/` — inti yang dipakai ulang semua Room:
  - `sdof.ts` — sistem SDOF `M q̈ + C q̇ + K q = F`, integrasi RK4 (h = 1/2000 s), `modal()`, `energy()` (terhadap kesetimbangan).
  - `draw.ts` (pegas, dashpot, arsir, panah, dimensi), `plot.ts` (grafik simpangan–waktu + envelope, puncak, braket T), `theme.ts`.
- `rooms/<room>/` — satu folder per Room, di-lazy-load dari `App.tsx` (`ROOMS`). Room Spring:
  `model.ts` (setup tarik/tekan/horizontal/rotasi, rentang, query URL), `stage.ts` (gambar panggung + hit test drag),
  `SpringRoom.tsx` (loop rAF, UI kontrol, tabel teori vs terukur, bar energi).
  Room Pendulum (`rooms/pendulum/`): `physics.ts` (bandul 1 DOF non-linear + model linear, periode eksak via AGM,
  bandul fisik batang, bandul ganda Lagrange + mode normal) diuji di `physics.test.ts`; integrator vektor umum `lab/ode.ts` (`rk4Vec`).
  `lab/plot.ts` mendukung seri tambahan + legenda (`extra`, `mainLabel`).
  Room Structure (`rooms/structure/`, slug `structure`): solver statik 2D metode kekakuan langsung di `lab/frame2d.ts`
  (`analyze()`: elemen portal EA+EI dan rangka EA, beban merata/terpusat/simpul, tumpuan jepit/sendi/rol, deteksi labil;
  batang dibagi sub-elemen → stasiun N/V/M + perpindahan; `sampleAt()`). Konvensi: N tarik +, M sagging + digambar di sisi
  serat tertarik. `model.ts` membangun Frame per setup (sederhana, kantilever, menerus, portal, gable, truss Pratt/Howe/Warren),
  `theory.ts` rumus tangan (tiga momen, portal dua sendi, Ritter) diuji terhadap solver di `structure.test.ts`;
  `stage.ts` gambar diagram/lendutan/reaksi + drag beban P + hover readout.
  Room Element (`rooms/element/`, slug `element`): `mohr.ts` (transformasi tegangan/regangan bidang, tegangan utama,
  θp/θs, 3 tegangan utama dengan σz, Von Mises/Tresca, Hooke 2D, strain gauge) diuji di `mohr.test.ts`. Konvensi: tarik +,
  θ berlawanan jarum jam, Mohr digambar dengan τ positif ke bawah (X = (σx, τxy), Y = (σy, −τxy)) sehingga titik berputar
  2θ searah elemen. `stage.ts`: elemen kiri (diputar / terdeformasi + gauge / kubus 3D) + lingkaran Mohr kanan
  (bertumpuk vertikal bila lebar < 560 px), skala Mohr membesar seketika dan mengecil perlahan; `drawCurves` σ(θ).
  Room Resonance (`rooms/resonance/`, slug `resonance`): `physics.ts` (SDOF + eksitasi harmonik dengan fase gaya ψ
  diintegrasikan, Rd/φ/TR, solusi analitis lengkap, `measure()` = simulasi tak berdimensi sampai tunak) diuji di
  `physics.test.ts`; setup Gaya Harmonik / Eksitasi Dasar (u relatif, x = u + ug; "dari diam" = diam mutlak, v = −ug0·ω).
  `freq.ts` grafik Rd|TR + φ vs β (geser untuk set ω), titik terukur hijau dicatat otomatis saat tunak + "Sapu frekuensi".
  `stage.ts` massa–pegas–peredam horizontal, meja getar, diagram fasor. `lab/plot.ts` punya opsi `hlines`.
  Inti MDOF `lab/mdof.ts` (bangunan geser: `stiffness`, `jacobiEigen`, `modes()` ternormalisasi massa + Γ + massa efektif,
  `pushShape`, `classicalDamping`, `steadyRel` modal kompleks, `stepModal`/`steadyModal`/`measureRoof`) diuji di
  `mdof.test.ts` (rumus tertutup gedung seragam, ortogonalitas, modal = integrasi langsung sistem penuh). Integrator SDOF
  gaya harmonik dipindah ke `lab/forced.ts` (dipakai Resonance dan Shear Building).
  Room Shear Building (`rooms/shear-building/`, slug `shear-building`): setup Getaran Bebas / Gerak Tanah Harmonik;
  simulasi di koordinat modal (ζ sama semua mode), perubahan parameter memproyeksikan keadaan fisik ke mode baru.
  `stage.ts` gedung (kolom kurva S) + profil simpangan & selubung; `modes.ts` panel mode mini (klik = getarkan mode);
  `freq.ts` respons frekuensi log tiap lantai vs ω/ω₁ + titik terukur/sapuan.
  Inti gempa `lab/ground.ts`: rekaman SINTETIS deterministik per seed (Kanai–Tajimi × selubung + high-pass, pulsa
  dekat sesar, sinus), integrasi eksak Nigam–Jennings (`njCoef`, `sdofResponse`), `spectrum()` Sd/PSv/PSa, `sniSa()`
  spektrum desain SNI 1726, `groundMotion()` (v, d dengan koreksi garis dasar untuk gambar); diuji di `ground.test.ts`.
  Room Earthquake (`rooms/earthquake/`, slug `earthquake`): tab Spektrum Respons (titik hijau dicatat saat rekaman
  selesai, geser grafik spektrum untuk T) dan Isolasi Dasar (`isolation.ts` 2DOF, diuji di `isolation.test.ts`);
  `charts.ts` riwayat waktu penuh bertumpuk + spektrum; parameter apa pun yang mengubah eksperimen memulai ulang t = 0.
  Room Machine Foundation (`rooms/machine/`, slug `machine`): `physics.ts` (kinematika engkol eksak, gaya mesin rotasi
  m·e·ω² / torak primer+sekunder, analog Lysmer kz/cz, amplitudo tunak 2 harmonik, RK4 dengan θ, ω, α) diuji di
  `physics.test.ts`; `rocking.ts` blok kaku 3DOF di CG (geser x, vertikal z, rocking ψ; kx/kz Lysmer, kψ/cψ Hall,
  kopel lewat tinggi CG zc; gaya horizontal dari massa berputar di ketinggian poros, offset ex; respons tunak kompleks
  `steady3`/`steadyState3`, `modes3`, RK4 `step3`; pondasi meja = `tableSystem`: pelat kaku di atas 4 kolom jepit–jepit, `tableK`
  kx = Σ12EI/h³, kz = ΣEA/h, kopel sway–rocking lewat lentur kolom, `modalDamping` ζ sama semua mode) diuji di
  `rocking.test.ts`. Setup Mesin Rotasi / Mesin Torak × pondasi blok tanah (L, B, H, tinggi poros, offset) / meja;
  amplitudo dinilai di bantalan (x − dz·ψ, z + dx·ψ), orbit bantalan, start/stop dengan laju rpm/s, jejak run-up
  per arah, takometer & grafik dengan pita ±20% tiap mode, kategori kecepatan indikatif. Skala gambar simpangan
  auto atau tetap (`sk` = px per µm di URL, batang skala + peringatan keluar skala) untuk membandingkan antar parameter.
  Room Section (`rooms/section/`, slug `section`): `section.ts` penampang dari bagian persegi/lingkaran (lubang = tanda −1,
  bagian positif tidak tumpang tindih) — A, titik berat, Ix/Iy/Ixy (Steiner), sumbu utama, `rotated()` Iu/Iv/Iuv, `gridScan`
  (pembanding kertas milimeter), `above()` luas & momen pertama di atas garis (eksak, termasuk segmen lingkaran),
  `plastic()` Zx/Zy, `tauAt`/`shearProfile` τ = V(Iy·Qx − Ixy·Qy)/((IxIy − Ixy²)b), `stressPlane` σ = N/A + a·x + b·y
  (lentur dua arah tak simetris; Mx + menekan atas, My + menekan kanan), `hull` + `kern` (inti), diuji di `section.test.ts`.
  `model.ts` 8 bentuk (persegi, kotak, WF, T, kanal, siku, Z, pipa), beban bawaan diskalakan ke penampang (`loadScale`).
  `stage.ts` tab Properti (sumbu u yang diputar, sumbu utama, elips inersia, GN plastis) / Tegangan Normal (gradien σ,
  garis netral, inti, titik tangkap N bisa digeser) / Tegangan Geser (potongan digeser, luas Q diarsir, diagram τ(y));
  `charts.ts` I(θ), σ tegak lurus garis netral, b/Q/τ terhadap y.
  Room Buckling (`rooms/buckling/`, slug `buckling`): `buckling.ts` Euler analitis 4 tumpuan (akar βL karakteristik, mode
  1–3, bentuk mode + titik belok), elemen hingga balok-kolom (K + kekakuan geometrik G, eigen via Cholesky + `jacobiEigen`),
  kolom tak sempurna (lengkung awal e0 = bentuk mode 1, eksentrisitas e sebagai momen ujung di ujung bebas berputar;
  M = −EI·w''), rumus δ = e0·α/(1−α) + e(sec(kLe/2) − 1), `southwell`, `firstYield`, `sniFcr` (SNI 1729 E3), `perry`,
  elastica (integral eliptik K/E + RK4 θ'' = −λ² sin θ; hanya tumpuan seperempat-gelombang: sendi, jepit–bebas, jepit)
  diuji di `buckling.test.ts`. `model.ts` memakai ulang penampang Room Section (`column()`: I/r/c/S terhadap sumbu x, y, atau
  sumbu utama terlemah). Tab Euler / Imperfeksi (uji tekan otomatis sampai leleh pertama, plot Southwell) / Kurva Kolom / Elastica.
- `ui/` — `Lobby.tsx`, `controls.tsx` (Slider, Segmented, Check).

## Menambah Room baru
1. Buat `rooms/<slug>/` (model + stage + komponen Room dengan props `{query, onQuery}`).
2. Daftarkan di `App.tsx` (`ROOMS`) dan set `live: true` di `catalog.ts`.
3. Tambah uji fisika di `lab/` atau folder Room bila ada rumus baru.

## Status & pekerjaan terbuka
- Live: **Room Spring** (4 setup). Uji `sdof.test.ts` lulus (periode, energi, log decrement, redaman kritis).
- Live: **Room Pendulum** (tab Sederhana / Ganda / Fisik): grafik θ–t, model linear pembanding, T₀ vs T eksak vs terukur,
  mode normal bandul ganda + bandul kembar (chaos), pusat osilasi bandul fisik.
- Live: **Room Structure Model** (6 setup): diagram N/V/M & lendutan di panggung, P bisa digeser, hover baca nilai,
  tabel teori vs matriks kekakuan, gaya batang. Lanjutan: beban bergerak/garis pengaruh, sambungan sendi dalam (release),
  ekspor, tautan "Lanjut di EDFS Matrix".
- Live: **Room Element** (tab Tegangan & Mohr / Regangan & Poisson / Tiga Dimensi): elemen bisa diputar dengan drag
  (di elemen atau titik X′ di lingkaran Mohr), 6 kasus bawaan, tabel rumus vs pindai θ, grafik σ(θ).
  Lanjutan: rosette input (ε0/ε45/ε90 → tegangan), kriteria keruntuhan Mohr–Coulomb (jembatan ke Zone Tanah).
- Live: **Room Resonance** (Fase 2): transien + tunak, fasor, Rd/TR & fase teori vs terukur, isolasi β > √2.
  Lanjutan: massa tak seimbang (mesin, p0 = me·e·ω²), sapuan chirp kontinu, TMD (jembatan ke Shear Building/Earthquake).
- Live: **Room Shear Building** (Fase 2): 2–5 lantai, lantai lunak, massa atap, mode & massa efektif, drift & geser
  dasar maks, tarik pelat lantai, resonansi tiap mode. Lanjutan: spektrum/rekaman gempa (Room Earthquake), TMD di atap.
- Live: **Room Earthquake**: gempa sintetis (bukan rekaman nyata), spektrum titik demi titik vs SNI 1726, isolasi dasar.
  Lanjutan: impor rekaman nyata (CSV/AT2), spektrum MDOF (gabung Shear Building, SRSS/CQC), TMD, histeretik/daktilitas.
- Live: **Room Machine Foundation**: mesin rotasi & torak, blok tanah (redaman radiasi) vs meja beton, run-up/coast-down.
  Rocking + geser terkopel (blok tanah) dan sway + rocking meja (kolom jepit–jepit) sudah ada. Lanjutan: penanaman blok
  (embedment), konstanta tanah bergantung frekuensi, massa/lentur kolom & balok meja, torsi (yawing), multi-silinder,
  isolator pegas.
- Live: **Room Section** (tab Properti / Tegangan Normal / Tegangan Geser): tabel Steiner, rumus vs grid, Iu(θ), Z & faktor
  bentuk, inti penampang, keseimbangan ∫σ dA, τ di loncatan sayap–badan. Lanjutan: penampang bebas (tambah/geser persegi),
  pusat geser & aliran geser di sayap tipis, torsi, penampang beton bertulang (retak/transformasi), penampang komposit.
- Live: **Room Buckling** (tab Euler / Imperfeksi / Kurva Kolom / Elastica): Pcr teori vs eigen matriks, panjang efektif &
  bayangan cermin jepit–bebas, Southwell, Perry–Robertson, SNI 1729 E3 (K teori/rekomendasi), elastica pasca-tekuk.
  Lanjutan: pengaku lateral di tengah (mode 2 dipaksa), tekuk inelastis numerik (tegangan sisa), tekuk torsi/lentur-torsi
  (siku, kanal), tekuk lokal pelat (Q), portal bergoyang (alinyemen G), beam-column (interaksi H1).
- Belum: Room lain (Fase 2 Material: Tensile Test; Fluida, Tanah), teks UI EN, deploy Cloudflare + SSO Supabase,
  Worksheet/akses Free–Premium (lihat KONSEP.md, Fase 1–3).
- Cacat visual kecil: label "-180°" di setup rotasi menimpa arsir tanah; label Fk di setup tekan dekat garis "panjang bebas".
- Repo GitHub berstatus publik, sementara README menyebut proprietary.
