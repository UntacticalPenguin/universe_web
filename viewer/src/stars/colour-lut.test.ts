import { afterEach, expect, it, vi } from "vitest"
import { displayTemperature, temperatureOf } from "./colour-lut.ts"
import { loadStars, colourIndexOf, extinctionOf, reddeningOf } from "./load-stars.ts"
import { pointSizeOf } from "../render/light.ts"

afterEach(() => vi.unstubAllGlobals())

it("reads measured, dereddened and observed colours from a synthetic v2 catalog", async () => {
  const count = 3
  const buffer = new ArrayBuffer(16 + 17 * count)
  new Uint8Array(buffer).set(new TextEncoder().encode("STR1"))
  const header = new DataView(buffer)
  header.setUint32(4, 2, true)
  header.setUint32(8, count, true)
  new Uint8Array(buffer, 16 + count * 12).set([100, 100, 100, 128, 128, 128, 127, 255, 255, 127, 255, 255, 64, 64, 255])
  vi.stubGlobal("fetch", async () => new Response(buffer))
  const data = await loadStars("synthetic.bin")
  const observed = colourIndexOf(data, 0)
  expect(displayTemperature(data, 0, true)).toEqual({ kelvin: temperatureOf(observed), source: "from colour" })
  expect(displayTemperature(data, 0, false).kelvin).toBeCloseTo(10000)
  expect(displayTemperature(data, 0, false).source).toBe("GSP-Phot")
  expect(extinctionOf(data, 0)).toBe(4)
  expect(displayTemperature(data, 1, false).kelvin).toBeCloseTo(temperatureOf(observed - reddeningOf(data, 1)!))
  expect(displayTemperature(data, 2, false)).toEqual(displayTemperature(data, 2, true))
})
it("extends only bright sprites when spikes are enabled", () => {
  expect(pointSizeOf(6, 1, true)).toBe(pointSizeOf(6, 1))
  expect(pointSizeOf(-60, 1, true)).toBe(48)
  expect(pointSizeOf(-60, 1)).toBe(16)
})
