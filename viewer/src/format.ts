const AU_PER_PC = 206_264.8

/** A distance in parsecs as a reading and its unit, in the unit that keeps the reading between 1 and 1000. */
export function distanceParts(pc: number): [string, string] {
  if (pc < 0.05) return [round(pc * AU_PER_PC), "au"]
  if (pc < 1_000) return [round(pc), "pc"]
  if (pc < 1e6) return [round(pc / 1e3), "kpc"]
  if (pc < 1e9) return [round(pc / 1e6), "Mpc"]
  return [round(pc / 1e9), "Gpc"]
}

export const formatDistance = (pc: number) => distanceParts(pc).join(" ")

export const formatCount = (n: number) => n.toLocaleString("en-US")

function round(value: number) {
  if (value >= 100) return value.toFixed(0)
  if (value >= 10) return value.toFixed(1)
  return value.toFixed(2)
}
