import { describe, expect, it } from "vitest"
import { fluxOf, pointSizeOf, profileOf, targetExposure, toneCurve, updateExposure } from "./light.ts"

describe("linear starlight", () => {
  it("combines ten thousand magnitude 17 stars into one magnitude 7 star", () => {
    expect(fluxOf(6)).toBe(1)
    expect(10000 * fluxOf(17)).toBeCloseTo(fluxOf(7), 12)
  })
  it.each([1.5, 4, 16, 32])("integrates the sprite profile to unit flux at diameter %d", (diameter) => {
    let sum = 0
    for (let i = 0; i < 1000; i++) {
      const r = (i + 0.5) / 1000
      sum += (profileOf(r, diameter) * 2 * Math.PI * r * (diameter / 2) ** 2) / 1000
    }
    expect(sum).toBeCloseTo(1, 6)
  })
  it("sizes visible points by exposed flux in CSS pixels", () => {
    expect(pointSizeOf(6, 0)).toBe(1.5)
    expect(pointSizeOf(6, 9)).toBe(4)
    expect(pointSizeOf(-30, 1)).toBe(16)
  })
  it("maps black, midtones and the white point", () => {
    expect(toneCurve(0)).toBe(0)
    expect(toneCurve(1)).toBe(0.53125)
    expect(toneCurve(4)).toBe(1)
  })
  it("meters the mean with a ten-stop bound in either direction", () => {
    expect(targetExposure(0)).toBe(1024)
    expect(targetExposure(0.04)).toBe(0.5)
    expect(targetExposure(1000)).toBe(1 / 1024)
  })
  it("adapts with a half-second time constant independent of frame rate", () => {
    expect(updateExposure(1, 4, 0)).toBe(1)
    expect(updateExposure(1, 4, 0.5)).toBeCloseTo(4 - 3 / Math.E)
    expect(updateExposure(updateExposure(4, 1, 0.2), 1, 0.3)).toBeCloseTo(updateExposure(4, 1, 0.5))
  })
})
