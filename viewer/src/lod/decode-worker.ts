import { decodeTile } from "./decode.ts"
import type { Tile } from "./hierarchy.ts"
self.onmessage = async ({ data: tile }: { data: Tile }) => {
  try {
    const response = await fetch(tile.url)
    if (!response.ok) throw Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer(),
      result = decodeTile(buffer, tile)
    self.postMessage(result, { transfer: [buffer, result.data.positions.buffer] })
  } catch (e) {
    self.postMessage({ error: String(e) })
  }
}
