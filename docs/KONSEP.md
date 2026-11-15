# EDFS Labs — Konsep Produk

> Status: draf konsep v0.1 (2026-11-15). Prototipe pertama: **Room Spring** (`frontend/`).
> Rencana alamat: **labs.edifisia.com**.

## 1. Apa itu EDFS Labs

Laboratorium virtual 2D untuk simulasi fisika–matematika yang menjadi dasar (dan praktik) teknik sipil. Pengguna tidak
membaca rumus lalu percaya — mereka **mengubah parameter, menarik benda, melepaskannya, dan melihat akibatnya**
langsung, lengkap dengan grafik dan angka.

- **Untuk pelajar**: memahami konsep lewat eksperimen (apa itu periode, amplitudo, redaman, tegangan utama, garis
  netral, tekanan pori, …).
- **Untuk pengajar**: alat peraga di kelas (proyektor), tautan eksperimen yang bisa dibagikan, lembar kerja.
- **Untuk praktisi muda**: intuisi rekayasa sebelum memakai EDFS Matrix / Base (software produksi).

Posisi di keluarga Edifisia: Labs adalah **pintu masuk edukasi**. Matrix, Base, Civil Tools = alat kerja; Labs =
tempat belajar mengapa alat kerja itu menghitung seperti itu. Banyak Room bisa menutup dengan tautan
"Lanjut di EDFS Matrix" (mis. Room Model Struktur → model yang sama di Matrix).

### Prinsip

1. **2D, langsung, ringan.** Canvas/SVG di browser, tanpa backend untuk simulasi. Buka → langsung bergerak.
2. **Satu Room = satu fenomena**, dengan beberapa konfigurasi (mis. pegas vertikal tarik / tekan / horizontal / rotasi).
3. **Manipulasi langsung.** Benda bisa ditarik dengan mouse/jari; parameter bisa diubah saat simulasi berjalan.
4. **Teori dan ukuran berdampingan.** Setiap Room menampilkan nilai teoretis (rumus) dan nilai terukur dari simulasi
   (dari grafik), supaya pengguna melihat keduanya cocok.
5. **Benar secara fisika.** Integrasi numerik yang diverifikasi dengan solusi analitis (unit test), satuan SI jelas.
6. **Dwibahasa ID + EN** seperti platform (prototipe baru ID).

## 2. Istilah

| Istilah | Arti |
|---|---|
| **Zone** | Kelompok besar bidang ilmu (pengganti "kategori"). Punya warna sendiri. |
| **Room** | Satu laboratorium/simulator dalam Zone. URL: `labs.edifisia.com/<room>` |
| **Setup** | Konfigurasi di dalam Room (mis. Pegas Tarik, Pegas Tekan). |
| **Experiment** | Keadaan Room yang tersimpan: setup + parameter + kondisi awal. Bisa dibagikan sebagai tautan. |
| **Instrument** | Alat ukur di Room: grafik terhadap waktu, readout, bar energi, penggaris, busur derajat. |
| **Worksheet** | Lembar kerja berpandu (langkah, pertanyaan, isian) di atas sebuah Room. Fitur pengajar. |
| **Lobby** | Halaman depan Labs: peta Zone dan Room. |

## 3. Usulan pembagian Zone

Pembagian mengikuti mata kuliah dasar teknik sipil, sehingga mudah dipetakan ke silabus.

### Zone 1 — Getaran & Dinamika *(Vibration)*
Dasar dinamika struktur dan gempa.

| Room | Isi | Prioritas |
|---|---|---|
| **Spring** | Pegas vertikal (tarik / tekan), horizontal, rotasi. Hukum Hooke, SDOF bebas teredam, grafik u(t), T, A, ζ, energi | **MVP — prototipe ada** |
| **Pendulum** | Bandul sederhana, sudut besar vs kecil (non-linear), bandul ganda (chaos), bandul fisik | MVP |
| Resonance | SDOF dengan gaya harmonik p₀ sin ωt: respons transien + tunak, kurva faktor amplifikasi dinamis vs ω/ωn | Fase 2 |
| Shear Building | Portal geser 2–5 lantai (MDOF), mode shape, frekuensi alami, animasi tiap mode | Fase 2 |
| Earthquake | SDOF di atas tanah bergerak (rekaman gempa), membangun spektrum respons titik demi titik, TMD/base isolation | Fase 3 |

### Zone 2 — Statika & Struktur
| Room | Isi | Prioritas |
|---|---|---|
| **Structure Model** | Model 2D sederhana: balok (sederhana, kantilever, menerus), portal, gable, truss. Beban titik/merata yang bisa digeser, reaksi, diagram N/V/M, lendutan dibesarkan | MVP |
| Equilibrium | Diagram benda bebas, resultan gaya, tuas & momen, katrol | Fase 2 |
| Influence Line | Beban berjalan di atas balok/truss, garis pengaruh reaksi, geser, momen | Fase 2 |
| Cable & Arch | Kabel parabola/katenari, pelengkung tiga sendi, garis tekan | Fase 3 |

### Zone 3 — Material & Elemen *(Mekanika Bahan)*
| Room | Isi | Prioritas |
|---|---|---|
| **Element** | Elemen 2D (dan sajian 3D sederhana) dengan σx, σy, τxy: rotasi elemen, tegangan utama, lingkaran Mohr interaktif, regangan & Poisson | MVP |
| Tensile Test | Uji tarik baja/beton: kurva tegangan–regangan, leleh, strain hardening, necking, modulus | Fase 2 |
| Buckling | Kolom Euler dengan berbagai tumpuan, panjang efektif, imperfeksi | Fase 2 |
| Section | Penampang (I, T, persegi, bebas): titik berat, momen inersia, distribusi tegangan lentur, garis netral | Fase 2 |

### Zone 4 — Fluida *(Hidrolika)*
| Room | Isi | Prioritas |
|---|---|---|
| Hydrostatic | Tekanan vs kedalaman, gaya & titik tangkap pada pintu air (tegak/miring) | Fase 2 |
| Buoyancy | Archimedes, stabilitas benda apung (metasentrum) | Fase 2 |
| Pipe Flow | Bernoulli, garis energi & hidrolis, kehilangan tinggi tekan | Fase 3 |
| Open Channel | Manning, energi spesifik, aliran kritis, loncatan hidrolis | Fase 3 |

### Zone 5 — Tanah *(Geoteknik)*
| Room | Isi | Prioritas |
|---|---|---|
| Soil Stress | Tegangan efektif & tekanan pori vs muka air; Boussinesq (bulb tekanan) di bawah beban titik/lajur | Fase 2 |
| Mohr–Coulomb | Uji geser langsung / triaksial virtual, selubung keruntuhan, c dan φ | Fase 2 |
| Consolidation | Terzaghi 1D: isokron tekanan pori berlebih, derajat konsolidasi vs waktu | Fase 3 |
| Seepage | Rembesan di bawah bendung/turap, flow net, gradien keluar | Fase 3 |
| Earth Pressure | Rankine aktif/pasif pada dinding penahan, irisan Coulomb | Fase 3 |
| Slope | Lingkaran gelincir, metode irisan, faktor keamanan | Fase 3 |

Nama Room di URL memakai bahasa Inggris pendek (`/spring`, `/pendulum`) supaya stabil di kedua bahasa; judul tampilan
dwibahasa ("Room Pegas" / "Spring Room").

## 4. Anatomi sebuah Room

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Lobby   Zone Getaran › Room Spring          [Pegas Tarik|Tekan|Horiz|Rotasi]   ⤴ Bagikan │
├───────────────────────────────────────────────┬──────────────────────────┤
│                                               │ PARAMETER                │
│              STAGE (canvas 2D)                │  massa m      [==●==] 2 kg│
│  - benda bisa di-drag lalu dilepas            │  kekakuan k   [=●===] 80  │
│  - garis panjang bebas & kesetimbangan        │  redaman c    [●====] 0   │
│  - panah gaya, penanda ukuran                 │ KONTROL ▶ ⏸ ⟲  kecepatan │
│                                               │ TEORI      vs   TERUKUR   │
│                                               │  Tn 0.99 s      T 0.99 s  │
├───────────────────────────────────────────────┤  ζ 0             A 5.0 cm │
│ INSTRUMENT: grafik u(t) — penanda A dan T,    │ ENERGI  Ek ▓▓░  Ep ▓░░    │
│ selubung redaman                              │ CATATAN & "Coba ini"      │
└───────────────────────────────────────────────┴──────────────────────────┘
```

Komponen bersama (dipakai semua Room):

- **Stage**: canvas dengan auto-fit skala, hit test, drag (mouse & sentuh).
- **Integrator**: RK4 langkah tetap kecil (sub-step), terpisah dari laju gambar (frame rate). Room lain bisa memakai
  solver khusus (mis. matriks kekakuan untuk Structure Model — logika dari EDFS Matrix bisa di-port ke TS, 2D saja).
- **Plot**: grafik waktu bergulir, autoscale, penanda puncak/periode, ekspor CSV.
- **Panel parameter**: slider + input angka, satuan, rentang aman.
- **Readout Teori vs Terukur**.
- **Notebook**: catatan konsep dengan angka hidup + daftar "Coba ini".
- **Share**: semua parameter di URL (`/spring?setup=tarik&m=2&k=80&c=0`) → pengajar membagikan eksperimen siap pakai.

## 5. Room Spring (MVP, prototipe)

Model: sistem SDOF linear `M q̈ + C q̇ + K q = F`

| Setup | q | M | K | F |
|---|---|---|---|---|
| Pegas tarik (massa digantung) | perpanjangan pegas (m) | m | k | m·g |
| Pegas tekan (massa di atas) | perpendekan pegas (m) | m | k | m·g |
| Horizontal | perpanjangan (m) | m | k | 0 |
| Rotasi (piringan + pegas spiral) | sudut θ (rad) | J = ½·m·r² | kθ | 0 |

Simpangan yang digambar u = q − q_eq dengan q_eq = F/K (lendutan statis δst = mg/k).

Fitur prototipe:
- Ganti m, k, c, g saat simulasi berjalan → kesetimbangan bergeser seketika (posisi mutlak tetap, sesuai fisika).
- Tarik/tekan benda dengan mouse/jari lalu lepas; tombol: lepas dari panjang bebas (amplitudo = δst), simpangkan,
  ketuk (impuls kecepatan), kembali ke kesetimbangan.
- c = 0 → bergetar selamanya (energi konstan, diuji). c = 2√(km) → redaman kritis.
- Grafik u(t) 10 detik: penanda puncak, garis ±A, braket periode T terukur, selubung teoretis A₀·e^(−ζωn t).
- Teori: ωn, fn, Tn, ζ (+ kategori redaman), Td, δst. Terukur: T, f, A dari puncak grafik.
- Bar energi: kinetik, potensial (terhadap kesetimbangan), terdisipasi oleh damper.
- Panah gaya (berat & gaya pegas) pada setup vertikal.
- Kecepatan 1× / 0,5× / 0,25× (gerak lambat).
- Parameter tersimpan di URL (bisa dibagikan).

Lanjutan Room Spring: pegas seri/paralel, dua massa (2DOF), gaya luar harmonik (jembatan ke Room Resonance), pegas
non-linear (bilinear/ perkerasan), gesekan Coulomb, ekspor CSV, mode presentasi.

## 6. Pengguna, akses, dan monetisasi

Mengikuti aturan platform (Guest / Free User / Premium, satu **Edifisia Premium** membuka semua aplikasi).

| Fitur | Guest | Free (login) | Premium |
|---|---|---|---|
| Semua Room inti, semua setup | ✔ | ✔ | ✔ |
| Bagikan tautan eksperimen (URL) | ✔ | ✔ | ✔ |
| Simpan eksperimen ke akun | – | 5 eksperimen | tak terbatas |
| Ekspor data CSV / PNG grafik | – | ✔ | ✔ |
| Worksheet siap pakai + ekspor PDF | – | lihat | ✔ |
| Mode Kelas (pengajar membuat worksheet, siswa mengisi, rekap jawaban) | – | – | ✔ |
| Room lanjutan (MDOF, Earthquake, Consolidation, Slope, …) | pratinjau | pratinjau | ✔ |

Alasan: Room inti gratis = corong pemasaran (SEO "simulasi pegas", "lingkaran Mohr interaktif", dsb.) dan reputasi
Edifisia di kampus. Nilai Premium = hal yang dibutuhkan pengajar/kampus (kelas, worksheet, simpan, Room lanjutan).
Keputusan akhir di tangan Edifisia — tabel ini usulan.

## 7. Arsitektur teknis

- **Frontend**: React 19 + TypeScript + Vite (sama dengan Matrix/Base), state zustand bila Room membesar. Gambar 2D
  dengan Canvas 2D (performa animasi), SVG untuk diagram statis bila perlu. Tanpa three.js di MVP.
- **Simulasi di browser**, tidak ada backend untuk menghitung. Room yang butuh solver berat (FEM 2D) tetap di TS/WASM.
- **Struktur kode**:
  ```
  frontend/src/
    catalog.ts           daftar Zone & Room (sumber Lobby, status live/soon, warna)
    lab/                 inti bersama: sdof.ts (integrator), plot.ts, draw.ts, ui (Slider, Readout…)
    rooms/<room>/        satu folder per Room: model.ts (fisika murni + test), draw.ts, <Room>Room.tsx
    ui/Lobby.tsx
  ```
  Satu Room = satu modul yang di-lazy-load (`import()`), supaya Lobby tetap ringan saat Room bertambah puluhan.
- **Routing**: path per Room (`/spring`), parameter di query string. Prototipe memakai hash (`#/spring?...`) supaya
  bisa dibuka tanpa konfigurasi server; pindah ke path saat deploy (fallback SPA di Cloudflare).
- **Akun & SSO**: `@supabase/ssr` dengan cookie domain `.edifisia.com` (lihat `edifisia-platform/docs/sso.md`). Login
  lewat `https://edifisia.com/masuk?next=https://labs.edifisia.com/...`. Status Premium dari
  `platform.premium_status()`.
- **Penyimpanan eksperimen**: skema Supabase baru `labs` (tabel `experiments`: id, user_id, room, setup, params jsonb,
  title, created_at, share_slug), RLS milik sendiri; migrasinya milik repo ini.
- **Deploy**: Cloudflare Worker static assets (seperti `edifisia-web`), domain `labs.edifisia.com`, staging
  `labs-staging.edifisia.com` (atau `staging-labs`). CSP ketat (aturan SSO).
- **Integrasi ke edifisia.com**: tambah entri di `edifisia-platform/web/src/lib/apps.ts`
  (`slug: 'labs', name: 'EDFS Labs', state: 'soon'`), aset logo `EDFS_Labs_*`, changelog `content/changelog/labs/`,
  halaman `/aplikasi/labs`.
- **Analitik**: GA4/Meta Pixel sesuai `docs/meta-pixel.md` platform; event per Room dibuka & eksperimen dibagikan.

## 8. Tahapan

| Fase | Isi | Hasil |
|---|---|---|
| 0 — Prototipe | Lobby + Room Spring (selesai di repo ini) | validasi konsep & UX |
| 1 — MVP publik | Room Spring dirapikan, Pendulum, Structure Model (balok/portal/truss statis), Element (Mohr), EN, deploy labs.edifisia.com, SSO, entri di edifisia.com | rilis "beta", gratis |
| 2 — Pengajar | simpan eksperimen, worksheet, ekspor CSV/PDF, Mode Presentasi, Room fase 2 | Premium mulai bernilai |
| 3 — Kelas | Mode Kelas (kode kelas, rekap), Room fase 3 (Fluida & Tanah lanjutan) | paket kampus |

## 9. Pertanyaan terbuka

1. Warna brand Labs (usulan: oranye Edifisia `#ED8D3B` sebagai aksen, atau warna baru) dan logo `EDFS_Labs`.
2. Apakah Room inti benar-benar gratis untuk Guest (disarankan ya, untuk SEO/kampus)?
3. Bahasa slug Room: Inggris (`/spring`) atau Indonesia (`/pegas`)? Usulan: Inggris + judul dwibahasa.
4. Perlu mode offline/PWA (seperti Matrix) untuk kelas dengan internet terbatas? Usulan: ya, di Fase 1 (murah, semua
   simulasi di browser).
5. Paket kampus/kelas: lewat Premium per pengajar, atau lisensi institusi terpisah?
