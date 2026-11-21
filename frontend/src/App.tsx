import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { roomBySlug } from './catalog'
import Lobby from './ui/Lobby'

// Satu Room = satu modul yang dimuat saat dibuka.
const ROOMS: Record<string, React.LazyExoticComponent<React.ComponentType<{ query: string; onQuery: (q: string) => void }>>> = {
  spring: lazy(() => import('./rooms/spring/SpringRoom')),
  pendulum: lazy(() => import('./rooms/pendulum/PendulumRoom')),
  structure: lazy(() => import('./rooms/structure/StructureRoom')),
  element: lazy(() => import('./rooms/element/ElementRoom')),
  section: lazy(() => import('./rooms/section/SectionRoom')),
  'shear-building': lazy(() => import('./rooms/shear-building/ShearBuildingRoom')),
  earthquake: lazy(() => import('./rooms/earthquake/EarthquakeRoom')),
  machine: lazy(() => import('./rooms/machine/MachineRoom')),
  resonance: lazy(() => import('./rooms/resonance/ResonanceRoom')),
}

/** Rute hash: #/<room>?<query>. (Saat deploy: pindah ke path /<room> dengan fallback SPA.) */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  return { path, query }
}

export default function App() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const on = () => setRoute(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const onQuery = useCallback(
    (q: string) => history.replaceState(null, '', `#/${route.path}${q ? `?${q}` : ''}`),
    [route.path],
  )

  const found = route.path ? roomBySlug(route.path) : null
  useEffect(() => {
    document.title = found ? `Room ${found.room.name} — EDFS Labs` : 'EDFS Labs — Edifisia'
    window.scrollTo(0, 0)
  }, [route.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const Room = ROOMS[route.path]
  if (!Room) return <Lobby />
  return (
    <Suspense fallback={<div className="loading">Memuat Room…</div>}>
      <Room key={route.path} query={route.query} onQuery={onQuery} />
    </Suspense>
  )
}
