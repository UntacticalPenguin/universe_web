import type { StarData } from "../stars/load-stars.ts"
import type { Tile } from "./hierarchy.ts"
export function decodeTile(buffer: ArrayBuffer, tile: Tile) {
  const deep = tile.survey === "deep" || tile.survey === "deep-wide"
  if (buffer.byteLength !== 16 + (deep ? 31 : 11) * tile.count) throw Error("Incorrect STN1 length")
  const header = new DataView(buffer)
  if (header.getUint32(0) !== (deep ? 0x47444931 : 0x53544e31) || header.getUint32(4, true) !== 1 || header.getUint32(8, true) !== tile.count)
    throw Error("Invalid STN1 header")
  const count = tile.count,
    offsets = new Int16Array(buffer, 16, 3 * count)
  const positions = new Float32Array(3 * count)
  for (let i = 0; i < positions.length; i++) positions[i] = tile.center[i % 3] + (offsets[i] * tile.half) / 32767
  const bytes = (i: number) => new Uint8Array(buffer, 16 + 6 * count + i * count, count)
  const data: StarData = { version: 2, count, positions, absMag: bytes(0), colour: bytes(1), teff: bytes(2), extinction: bytes(3), reddening: bytes(4) }
  if (deep) data.distances = new DataView(buffer, 16 + 11 * count)
  return { data, offsets }
}
