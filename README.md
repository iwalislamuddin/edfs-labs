# EDFS Labs

Laboratorium virtual 2D untuk simulasi fisika–matematika dasar teknik sipil (keluarga Edifisia, rencana
`labs.edifisia.com`). Struktur: **Zone** (bidang ilmu) → **Room** (satu simulator).

- Konsep lengkap: [docs/KONSEP.md](docs/KONSEP.md)
- Prototipe: `frontend/` (React 19 + TypeScript + Vite, Canvas 2D, tanpa backend). Room live: **Spring**.

```bash
npm --prefix frontend install
npm --prefix frontend run dev    # http://localhost:5180
npm --prefix frontend test       # uji fisika (periode, energi, redaman)
```

Perangkat lunak berpemilik (proprietary) — © PT Dunia Teknik Sipil Engineering (Edifisia).
