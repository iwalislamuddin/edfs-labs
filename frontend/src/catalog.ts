// Katalog Zone & Room — sumber Lobby. Room 'live' punya modul di src/rooms/<slug>/.

export interface Room {
  slug: string
  name: string
  desc: string
  state: 'live' | 'soon'
}

export interface Zone {
  id: string
  name: string
  tagline: string
  color: string
  rooms: Room[]
}

export const zones: Zone[] = [
  {
    id: 'getaran',
    name: 'Getaran & Dinamika',
    tagline: 'Dasar dinamika struktur dan gempa',
    color: '#0d304b',
    rooms: [
      { slug: 'spring', name: 'Spring', desc: 'Pegas tarik, tekan, horizontal, rotasi. Hukum Hooke, periode, amplitudo, redaman.', state: 'live' },
      { slug: 'pendulum', name: 'Pendulum', desc: 'Bandul sederhana, sudut besar vs kecil, bandul ganda (chaos), bandul fisik.', state: 'live' },
      { slug: 'resonance', name: 'Resonance', desc: 'Gaya harmonik dan eksitasi dasar: transien, resonansi, Rd, fase, transmisibilitas.', state: 'live' },
      { slug: 'shear-building', name: 'Shear Building', desc: 'Portal geser 2–5 lantai: mode getar, massa efektif, lantai lunak, resonansi gerak tanah.', state: 'live' },
      { slug: 'earthquake', name: 'Earthquake', desc: 'Gempa sintetis, spektrum respons titik demi titik vs SNI 1726, isolasi dasar.', state: 'live' },
      { slug: 'machine', name: 'Machine Foundation', desc: 'Mesin rotasi & torak di atas blok tanah atau meja beton: start/stop melewati resonansi.', state: 'live' },
    ],
  },
  {
    id: 'struktur',
    name: 'Statika & Struktur',
    tagline: 'Gaya, keseimbangan, dan perilaku struktur 2D',
    color: '#566449',
    rooms: [
      { slug: 'structure', name: 'Structure Model', desc: 'Balok, portal, gable, truss: reaksi, diagram N-V-M, lendutan.', state: 'live' },
      { slug: 'equilibrium', name: 'Equilibrium', desc: 'Diagram benda bebas, resultan gaya, momen dan tuas.', state: 'soon' },
      { slug: 'influence-line', name: 'Influence Line', desc: 'Beban berjalan dan garis pengaruh.', state: 'soon' },
      { slug: 'cable-arch', name: 'Cable & Arch', desc: 'Kabel, pelengkung tiga sendi, garis tekan.', state: 'soon' },
    ],
  },
  {
    id: 'material',
    name: 'Material & Elemen',
    tagline: 'Tegangan, regangan, dan kekuatan bahan',
    color: '#661465',
    rooms: [
      { slug: 'element', name: 'Element', desc: 'Tegangan-regangan 2D/3D, tegangan utama, lingkaran Mohr.', state: 'live' },
      { slug: 'tensile-test', name: 'Tensile Test', desc: 'Uji tarik virtual: leleh, strain hardening, necking.', state: 'soon' },
      { slug: 'buckling', name: 'Buckling', desc: 'Tekuk kolom Euler, panjang efektif, imperfeksi.', state: 'soon' },
      { slug: 'section', name: 'Section', desc: 'Titik berat, momen inersia, tegangan lentur penampang.', state: 'soon' },
    ],
  },
  {
    id: 'fluida',
    name: 'Fluida',
    tagline: 'Hidrostatika dan hidrolika',
    color: '#1f6f8b',
    rooms: [
      { slug: 'hydrostatic', name: 'Hydrostatic', desc: 'Tekanan hidrostatis, gaya pada pintu air.', state: 'soon' },
      { slug: 'buoyancy', name: 'Buoyancy', desc: 'Archimedes dan stabilitas benda apung.', state: 'soon' },
      { slug: 'pipe-flow', name: 'Pipe Flow', desc: 'Bernoulli, garis energi, kehilangan tinggi tekan.', state: 'soon' },
      { slug: 'open-channel', name: 'Open Channel', desc: 'Manning, energi spesifik, loncatan hidrolis.', state: 'soon' },
    ],
  },
  {
    id: 'tanah',
    name: 'Tanah',
    tagline: 'Geoteknik dari tegangan efektif sampai lereng',
    color: '#661414',
    rooms: [
      { slug: 'soil-stress', name: 'Soil Stress', desc: 'Tegangan efektif, tekanan pori, bulb tekanan Boussinesq.', state: 'soon' },
      { slug: 'mohr-coulomb', name: 'Mohr–Coulomb', desc: 'Uji geser virtual dan selubung keruntuhan.', state: 'soon' },
      { slug: 'consolidation', name: 'Consolidation', desc: 'Konsolidasi 1D Terzaghi, isokron tekanan pori.', state: 'soon' },
      { slug: 'seepage', name: 'Seepage', desc: 'Rembesan dan flow net di bawah bendung.', state: 'soon' },
      { slug: 'slope', name: 'Slope', desc: 'Lingkaran gelincir dan faktor keamanan lereng.', state: 'soon' },
    ],
  },
]

export const roomBySlug = (slug: string) => {
  for (const z of zones) {
    const r = z.rooms.find((x) => x.slug === slug)
    if (r) return { zone: z, room: r }
  }
  return null
}
