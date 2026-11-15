import { zones } from '../catalog'

export default function Lobby() {
  return (
    <div className="lobby wrap">
      <header className="hero">
        <div className="brand">
          <span className="brand-mark">EDFS</span> Labs
        </div>
        <h1>Laboratorium virtual untuk dasar-dasar teknik sipil</h1>
        <p>
          Ubah parameter, tarik benda, lepaskan, dan lihat akibatnya langsung — lengkap dengan grafik dan angka. Untuk pelajar yang
          ingin paham, dan pengajar yang ingin menunjukkan.
        </p>
        <a className="btn primary" href="#/spring">
          Masuk Room Spring →
        </a>
      </header>

      {zones.map((z) => (
        <section key={z.id} className="zone" style={{ '--zone': z.color } as React.CSSProperties}>
          <div className="zone-head">
            <span className="zone-dot" />
            <h2>Zone {z.name}</h2>
            <span className="zone-tag">{z.tagline}</span>
          </div>
          <div className="rooms">
            {z.rooms.map((r) =>
              r.state === 'live' ? (
                <a key={r.slug} className="room-card live" href={`#/${r.slug}`}>
                  <span className="room-state">Buka</span>
                  <h3>Room {r.name}</h3>
                  <p>{r.desc}</p>
                </a>
              ) : (
                <div key={r.slug} className="room-card" aria-disabled>
                  <span className="room-state soon">Segera</span>
                  <h3>Room {r.name}</h3>
                  <p>{r.desc}</p>
                </div>
              ),
            )}
          </div>
        </section>
      ))}
      <footer className="foot">
        © PT Dunia Teknik Sipil Engineering (Edifisia) · Prototipe v0.1
      </footer>
    </div>
  )
}
