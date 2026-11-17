/** Stars as written by pipeline/prepare.py; the layout is documented there. */
export type StarData = {
  count: number
  /** x, y, z in parsecs, heliocentric galactic: x toward the galactic centre, z toward the north galactic pole. */
  positions: Float32Array
  /** Absolute magnitude, quantised to a byte over `M_RANGE`. */
  absMag: Uint8Array
  /** Gaia bp_rp colour index, quantised to a byte over `COLOUR_RANGE`. */
  colour: Uint8Array
}

export const M_RANGE = [-10, 20] as const
export const COLOUR_RANGE = [-0.5, 4.5] as const

export async function loadStars(url: string): Promise<StarData> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`could not load ${url} (http ${response.status}); run pipeline/prepare.py first`)
  return parseStars(await response.arrayBuffer())
}

export const absoluteMagnitudeOf = (data: StarData, index: number) => dequantise(data.absMag[index], M_RANGE)

export const colourIndexOf = (data: StarData, index: number) => dequantise(data.colour[index], COLOUR_RANGE)

function parseStars(buffer: ArrayBuffer): StarData {
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4))
  if (magic !== "STR1") throw new Error(`not a star file (magic "${magic}")`)
  const header = new DataView(buffer, 4, 12)
  const version = header.getUint32(0, true)
  const count = header.getUint32(4, true)
  if (version !== 1) throw new Error(`unsupported star file version ${version}`)

  const positionBytes = count * 12
  const expected = 16 + positionBytes + 2 * count
  if (buffer.byteLength !== expected) throw new Error(`star file is ${buffer.byteLength} B, expected ${expected} B`)

  return {
    count,
    positions: new Float32Array(buffer, 16, count * 3),
    absMag: new Uint8Array(buffer, 16 + positionBytes, count),
    colour: new Uint8Array(buffer, 16 + positionBytes + count, count),
  }
}

const dequantise = (byte: number, [lo, hi]: readonly [number, number]) => lo + (byte / 255) * (hi - lo)
