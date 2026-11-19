import { expect, it } from "vitest"
import { PerspectiveCamera } from "three"
import { selectNodes } from "./select-nodes"
import { decodeTile } from "./decode"
import type { Tile, Hierarchy } from "./hierarchy"

const root: Tile = {
  center: [0, 0, -10],
  centroid: [0, 0, -10],
  half: 4,
  count: 3,
  subtreeCount: 6,
  mMin: 2,
  lSum: 1,
  lSum0: 1,
  meanBpRp: 0,
  meanLogTeff0: 4,
  children: ["child"],
  survey: "stars",
  url: "r.bin",
}
const tree: Hierarchy = { roots: ["r"], nodes: { r: root, child: { ...root, half: 1, children: [] } } }
const camera = new PerspectiveCamera(60, 1, 0.01, 1000)
function choose(budget: number, loaded: string[], height = 1000, limit = Infinity) {
  return selectNodes(tree, camera, height, limit, budget, (id) => loaded.includes(id))
}
it("draws real parent stars while children load or remain below the detail threshold", () => {
  expect(choose(6, ["r"])).toEqual({ draw: ["r"], request: ["child"] })
  expect(choose(6, ["r", "child"]).draw).toEqual(["r", "child"])
  expect(choose(3, ["r", "child"])).toEqual({ draw: ["r"], request: [] })
  expect(choose(6, ["r", "child"], 100)).toEqual({ draw: ["r"], request: [] })
})
it("rejects an invisible or too faint subtree", () => {
  expect(choose(6, [], 1000, -10).request).toEqual([])
  const away = new PerspectiveCamera(60, 1, 0.01, 1000)
  away.rotateY(Math.PI)
  away.updateMatrixWorld()
  expect(selectNodes(tree, away, 1000, Infinity, 6, () => true).draw).toEqual([])
})
it("checks tile length, magic and row count and reconstructs relative positions", () => {
  const bytes = new ArrayBuffer(49),
    header = new DataView(bytes)
  expect(() => decodeTile(bytes, root)).toThrow()
  header.setUint32(0, 0x53544e31)
  header.setUint32(4, 1, true)
  header.setUint32(8, 3, true)
  header.setInt16(16, 32767, true)
  expect([...decodeTile(bytes, root).data.positions.slice(0, 3)]).toEqual([4, 0, -10])
  expect(() => decodeTile(bytes.slice(0, 48), root)).toThrow()
  header.setUint32(8, 4, true)
  expect(() => decodeTile(bytes, root)).toThrow()
})
