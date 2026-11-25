import { expect, it } from "vitest"
import { unresolvedLight } from "./glow-layer"

it("conserves subtree luminosity before, during and after partial refinement", () => {
  for (const total of [100, 250]) {
    const child = total * 0.6,
      grandchild = child * 0.3
    for (const parentWeight of [0, 0.3, 1])
      for (const childWeight of [0, 0.7, 1]) {
        const stars = (total - child) * parentWeight
        expect(stars + unresolvedLight(total, child, parentWeight, false)).toBeCloseTo(total)
        const partial =
          stars +
          unresolvedLight(total, child, parentWeight, true) +
          (child - grandchild) * childWeight +
          unresolvedLight(child, grandchild, childWeight, false)
        expect(partial).toBeCloseTo(total)
      }
  }
})
