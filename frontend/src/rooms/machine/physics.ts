// Fisika Room Machine Foundation: getaran vertikal pondasi mesin (SDOF).
//   M·ü + c·u̇ + k·u = F(θ, ω, α),  θ' = ω,  ω' = α (percepatan putaran saat start/stop)
// Mesin rotasi: massa tak seimbang m·e → F = m·e·(ω² cos θ + α sin θ).
// Mesin torak (engkol–batang penghubung, silinder vertikal):
//   posisi torak x(θ) = r cos θ + √(l² − r² sin² θ), gaya ke rangka = −m_rec·ẍ + m_rot·r·(ω² cos θ + α sin θ)
//   ≈ (m_rec + m_rot)·r·ω²·cos θ (primer) + m_rec·r·ω²·(r/l)·cos 2θ (sekunder).
// Pondasi blok di atas tanah: analog Lysmer — kz = 4·G·r0/(1−ν), cz = 3,4·r0²·√(ρG)/(1−ν).
// Fisika murni, diuji di physics.test.ts.

export type MachineKind = 'rotasi' | 'torak'

export interface Machine {
  kind: MachineKind
  /** Ketidakseimbangan m·e (kg·m) — mesin rotasi. */
  me: number
  /** Massa bolak-balik (torak + ⅓ batang) dan massa berputar (engkol + ⅔ batang), kg — mesin torak. */
  mRec: number
  mRot: number
  /** Jari-jari engkol r dan panjang batang penghubung l (m). */
  r: number
  l: number
}

export interface Foundation {
  M: number // massa total bergetar (kg)
  k: number // N/m
  c: number // N·s/m
}

// ---- kinematika engkol ----

/** Posisi torak dari pusat engkol dan turunannya terhadap θ. */
export function crank(r: number, l: number, th: number) {
  const s = Math.sin(th)
  const c = Math.cos(th)
  const S = Math.sqrt(l * l - r * r * s * s)
  const x = r * c + S
  const x1 = -r * s - (r * r * s * c) / S
  const x2 = -r * c - (r * r * (c * c - s * s)) / S - (r ** 4 * s * s * c * c) / (S * S * S)
  return { x, x1, x2 }
}

/** Gaya getar vertikal mesin ke pondasi (N), positif ke atas (searah sumbu silinder). */
export function machineForce(m: Machine, th: number, w: number, a: number): number {
  if (m.kind === 'rotasi') return m.me * (w * w * Math.cos(th) + a * Math.sin(th))
  const { x1, x2 } = crank(m.r, m.l, th)
  const xdd = x2 * w * w + x1 * a // percepatan torak
  return -m.mRec * xdd + m.mRot * m.r * (w * w * Math.cos(th) + a * Math.sin(th))
}

/** Amplitudo gaya harmonik pertama dan kedua (pendekatan deret) pada ω tetap. */
export function forceHarmonics(m: Machine, w: number): [number, number] {
  if (m.kind === 'rotasi') return [m.me * w * w, 0]
  return [(m.mRec + m.mRot) * m.r * w * w, m.mRec * m.r * w * w * (m.r / m.l)]
}

// ---- pondasi ----

export interface Soil {
  G: number // modulus geser (Pa)
  nu: number
  rho: number // kg/m³
}

/** Analog Lysmer untuk getaran vertikal pondasi lingkaran ekuivalen berjari-jari r0. */
export function lysmer(s: Soil, r0: number) {
  const k = (4 * s.G * r0) / (1 - s.nu)
  const c = (3.4 * r0 * r0 * Math.sqrt(s.rho * s.G)) / (1 - s.nu)
  return { k, c }
}

/** Rasio massa Bz = (1−ν)·M / (4ρ·r0³); ζ = 0,425/√Bz (Richart–Hall–Woods). */
export const massRatio = (s: Soil, r0: number, M: number) => ((1 - s.nu) * M) / (4 * s.rho * r0 ** 3)

export const wnOf = (f: Foundation) => Math.sqrt(f.k / f.M)
export const zetaOf = (f: Foundation) => f.c / (2 * Math.sqrt(f.k * f.M))

/** Faktor amplifikasi dinamis. */
export const Rd = (b: number, z: number) => 1 / Math.hypot(1 - b * b, 2 * z * b)
export const phase = (b: number, z: number) => Math.atan2(2 * z * b, 1 - b * b)

/**
 * Amplitudo tunak (m) pada putaran ω: maksimum dari u(θ) = Σ Xn·cos(nθ − φn) atas satu putaran
 * (n = 1, 2; harmonik kedua hanya untuk mesin torak, pendekatan deret).
 */
export function steadyAmp(m: Machine, f: Foundation, w: number): { amp: number; X1: number; X2: number; FT: number } {
  const wn = wnOf(f)
  const z = zetaOf(f)
  const [F1, F2] = forceHarmonics(m, w)
  const b1 = w / wn
  const b2 = (2 * w) / wn
  const X1 = (F1 / f.k) * Rd(b1, z)
  const X2 = (F2 / f.k) * Rd(b2, z)
  const p1 = phase(b1, z)
  const p2 = phase(b2, z)
  let amp = 0
  let ft = 0
  const T1 = Math.hypot(1, 2 * z * b1)
  const T2 = Math.hypot(1, 2 * z * b2)
  const q1 = Math.atan(2 * z * b1)
  const q2 = Math.atan(2 * z * b2)
  for (let i = 0; i < 720; i++) {
    const th = (i / 720) * 2 * Math.PI
    const u = X1 * Math.cos(th - p1) + X2 * Math.cos(2 * th - p2)
    amp = Math.max(amp, Math.abs(u))
    // gaya ke tanah = k·u + c·u̇ per harmonik → amplitudo k·Xn·√(1+(2ζβn)²) dengan fase maju atan(2ζβn)
    const fT = f.k * (X1 * T1 * Math.cos(th - p1 + q1) + X2 * T2 * Math.cos(2 * th - p2 + q2))
    ft = Math.max(ft, Math.abs(fT))
  }
  return { amp, X1, X2, FT: ft }
}

// ---- integrasi ----

export interface MState {
  u: number
  v: number
  th: number
  w: number
}

/** Satu langkah RK4; α konstan selama langkah (diatur pemanggil). */
export function stepM(m: Machine, f: Foundation, s: MState, a: number, h: number): MState {
  const d = (x: MState) => {
    const F = machineForce(m, x.th, x.w, a)
    return { u: x.v, v: (F - f.c * x.v - f.k * x.u) / f.M, th: x.w, w: a }
  }
  const add = (x: MState, k: MState, c: number): MState => ({ u: x.u + c * k.u, v: x.v + c * k.v, th: x.th + c * k.th, w: x.w + c * k.w })
  const k1 = d(s)
  const k2 = d(add(s, k1, h / 2))
  const k3 = d(add(s, k2, h / 2))
  const k4 = d(add(s, k3, h))
  const out: MState = {
    u: s.u + (h / 6) * (k1.u + 2 * k2.u + 2 * k3.u + k4.u),
    v: s.v + (h / 6) * (k1.v + 2 * k2.v + 2 * k3.v + k4.v),
    th: s.th + (h / 6) * (k1.th + 2 * k2.th + 2 * k3.th + k4.th),
    w: s.w + (h / 6) * (k1.w + 2 * k2.w + 2 * k3.w + k4.w),
  }
  if (out.th > 1e4) out.th -= Math.floor(out.th / (2 * Math.PI)) * 2 * Math.PI
  return out
}

export const rpmToW = (rpm: number) => (rpm * 2 * Math.PI) / 60
export const wToRpm = (w: number) => (w * 60) / (2 * Math.PI)
