import * as THREE from "three"
import { COLOUR_RANGE } from "./load-stars.ts"

/** 256 star colours, indexed by the quantised bp_rp byte: bp_rp, then temperature, then blackbody spectrum, then CIE XYZ, then linear sRGB. */
export function createColourLut() {
  const texels = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const bpRp = COLOUR_RANGE[0] + (i / 255) * (COLOUR_RANGE[1] - COLOUR_RANGE[0])
    const [r, g, b] = blackbodyRgb(temperatureOf(bpRp))
    texels.set([r * 255, g * 255, b * 255, 255], i * 4)
  }
  const texture = new THREE.DataTexture(texels, 256, 1, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

/** Mucciarelli & Bellazzini (2020), dwarfs at solar metallicity; approximate outside -0.1 < bp_rp < 3. */
export function temperatureOf(bpRp: number) {
  const theta = 0.4929 + 0.5092 * bpRp - 0.0353 * bpRp * bpRp
  return Math.min(40_000, Math.max(2_000, 5040 / theta))
}

export function spectralClassOf(kelvin: number) {
  if (kelvin >= 30_000) return "O"
  if (kelvin >= 10_000) return "B"
  if (kelvin >= 7_500) return "A"
  if (kelvin >= 6_000) return "F"
  if (kelvin >= 5_200) return "G"
  if (kelvin >= 3_700) return "K"
  return "M"
}

/** Colour only, normalised to the brightest channel: brightness comes from the shader. */
function blackbodyRgb(kelvin: number): [number, number, number] {
  let X = 0
  let Y = 0
  let Z = 0
  for (let nm = 380; nm <= 780; nm += 5) {
    const radiance = planck(nm, kelvin)
    const [x, y, z] = colourMatching(nm)
    X += radiance * x
    Y += radiance * y
    Z += radiance * z
  }
  const r = Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z)
  const g = Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z)
  const b = Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z)
  const peak = Math.max(r, g, b) || 1
  return [r / peak, g / peak, b / peak]
}

const planck = (nm: number, kelvin: number) => Math.pow(nm, -5) / (Math.exp(1.4388e7 / (nm * kelvin)) - 1)

/** Analytic fit to the CIE 1931 colour-matching functions (Wyman, Sloan & Shirley 2013). */
function colourMatching(nm: number): [number, number, number] {
  return [
    1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2),
    0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1),
    1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8),
  ]
}

function lobe(x: number, mu: number, below: number, above: number) {
  const t = (x - mu) / (x < mu ? below : above)
  return Math.exp(-0.5 * t * t)
}
