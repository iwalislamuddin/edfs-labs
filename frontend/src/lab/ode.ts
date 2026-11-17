// Integrator umum untuk sistem ODE orde satu y' = f(y) (vektor kecil, langkah tetap).
// Dipakai Room yang persamaannya tidak berbentuk SDOF linear (mis. bandul non-linear, bandul ganda).

export type Deriv = (y: number[]) => number[]

/** Satu langkah Runge-Kutta orde 4 untuk vektor keadaan. */
export function rk4Vec(f: Deriv, y: number[], h: number): number[] {
  const n = y.length
  const k1 = f(y)
  const y2 = new Array<number>(n)
  for (let i = 0; i < n; i++) y2[i] = y[i] + 0.5 * h * k1[i]
  const k2 = f(y2)
  const y3 = new Array<number>(n)
  for (let i = 0; i < n; i++) y3[i] = y[i] + 0.5 * h * k2[i]
  const k3 = f(y3)
  const y4 = new Array<number>(n)
  for (let i = 0; i < n; i++) y4[i] = y[i] + h * k3[i]
  const k4 = f(y4)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
  return out
}
