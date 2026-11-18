/** Stars as written by pipeline/prepare.py; the layout is documented there. */
export type StarData = {
  count: number
  /** x, y, z in parsecs, heliocentric galactic: x toward the galactic centre, z toward the north galactic pole. */
  positions: Float32Array
  /** Absolute magnitude, quantised to a byte over `M_RANGE`. */
  absMag: Uint8Array
  /** Gaia bp_rp colour index, quantised to a byte over `COLOUR_RANGE`. */
  colour: Uint8Array
  /** File version: 1 has no astrophysics; in version 2 the three arrays below hold Gaia GSP-Phot values. */
  version: 1 | 2
  /** GSP-Phot temperature, log10 kelvin over `TEFF_LOG_RANGE` on 0-254; `MISSING` where unknown (always, for version 1). */
  teff: Uint8Array
  /** GSP-Phot dust extinction A_G in magnitudes over `AG_RANGE` on 0-254; `MISSING` where unknown. */
  extinction: Uint8Array
  /** GSP-Phot dust reddening E(BP-RP) in magnitudes over `REDDENING_RANGE` on 0-254; `MISSING` where unknown. */
  reddening: Uint8Array
}

export const M_RANGE = [-10, 20] as const
export const COLOUR_RANGE = [-0.5, 4.5] as const
export const TEFF_LOG_RANGE = [3.3, 4.7] as const
export const AG_RANGE = [0, 8] as const
export const REDDENING_RANGE = [0, 4] as const
export const MISSING = 255

export async function loadStars(url: string): Promise<StarData> {
  const response = await fetch(url)
  if (response.status === 404) {
    throw new Error(`${url} is not on this site yet; the deploy workflow builds it once Gaia data has been downloaded (see the Actions log)`)
  }
  if (!response.ok) throw new Error(`could not load ${url} (http ${response.status})`)
  return parseStars(await response.arrayBuffer())
}

export const absoluteMagnitudeOf = (data: StarData, index: number) => dequantise(data.absMag[index], M_RANGE)

export const colourIndexOf = (data: StarData, index: number) => dequantise(data.colour[index], COLOUR_RANGE)

/** GSP-Phot temperature in kelvin, or undefined when the file or the star has none. */
export const gspTemperatureOf = (data: StarData, index: number) => optional(data.teff[index], TEFF_LOG_RANGE, (logKelvin) => 10 ** logKelvin)

/** GSP-Phot dust extinction A_G in magnitudes, or undefined. */
export const extinctionOf = (data: StarData, index: number) => optional(data.extinction[index], AG_RANGE)

/** GSP-Phot dust reddening E(BP-RP) in magnitudes, or undefined. */
export const reddeningOf = (data: StarData, index: number) => optional(data.reddening[index], REDDENING_RANGE)

function parseStars(buffer: ArrayBuffer): StarData {
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4))
  if (magic !== "STR1") throw new Error(`not a star file (magic "${magic}")`)
  const header = new DataView(buffer, 4, 12)
  const version = header.getUint32(0, true)
  const count = header.getUint32(4, true)
  if (version !== 1 && version !== 2) throw new Error(`unsupported star file version ${version}`)

  const positionBytes = count * 12
  const byteArrays = version === 1 ? 2 : 5
  const expected = 16 + positionBytes + byteArrays * count
  if (buffer.byteLength !== expected) throw new Error(`star file is ${buffer.byteLength} B, expected ${expected} B`)

  const bytesAt = (k: number) => new Uint8Array(buffer, 16 + positionBytes + k * count, count)
  const missing = () => new Uint8Array(count).fill(MISSING)
  return {
    count,
    version,
    positions: new Float32Array(buffer, 16, count * 3),
    absMag: bytesAt(0),
    colour: bytesAt(1),
    teff: version === 2 ? bytesAt(2) : missing(),
    extinction: version === 2 ? bytesAt(3) : missing(),
    reddening: version === 2 ? bytesAt(4) : missing(),
  }
}

const dequantise = (byte: number, [lo, hi]: readonly [number, number]) => lo + (byte / 255) * (hi - lo)

function optional(byte: number, [lo, hi]: readonly [number, number], map = (value: number) => value) {
  return byte === MISSING ? undefined : map(lo + (byte / 254) * (hi - lo))
}
