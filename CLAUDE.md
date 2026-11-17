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
- `ui/` — `Lobby.tsx`, `controls.tsx` (Slider, Segmented, Check).

## Menambah Room baru
1. Buat `rooms/<slug>/` (model + stage + komponen Room dengan props `{query, onQuery}`).
2. Daftarkan di `App.tsx` (`ROOMS`) dan set `live: true` di `catalog.ts`.
3. Tambah uji fisika di `lab/` atau folder Room bila ada rumus baru.

## Status & pekerjaan terbuka
- Live: **Room Spring** (4 setup). Uji `sdof.test.ts` lulus (periode, energi, log decrement, redaman kritis).
- Live: **Room Pendulum** (tab Sederhana / Ganda / Fisik): grafik θ–t, model linear pembanding, T₀ vs T eksak vs terukur,
  mode normal bandul ganda + bandul kembar (chaos), pusat osilasi bandul fisik.
- Belum: Room lain (Model Struktur, Element, Fluida, Tanah), teks UI EN, deploy Cloudflare + SSO Supabase,
  Worksheet/akses Free–Premium (lihat KONSEP.md, Fase 1–3).
- Cacat visual kecil: label "-180°" di setup rotasi menimpa arsir tanah; label Fk di setup tekan dekat garis "panjang bebas".
- Repo GitHub berstatus publik, sementara README menyebut proprietary.
