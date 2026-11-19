export const luminanceWeights = [0.2126, 0.7152, 0.0722] as const
export const profileArea = (Math.PI * (1 - Math.exp(-4))) / 16

export const fluxOf = (magnitude: number) => 10 ** (-0.4 * (magnitude - 6))

export const pointSizeOf = (magnitude: number, exposure: number) => Math.min(16, 1.5 + 2.5 * Math.log10(1 + fluxOf(magnitude) * exposure))

export const profileOf = (radius: number, diameter: number) => (radius > 1 ? 0 : Math.exp(-4 * radius ** 2) / (profileArea * diameter ** 2))

export const toneCurve = (light: number) => light * ((1 + light / 16) / (1 + light))

export const targetExposure = (mean: number) => Math.max(2 ** -10, Math.min(2 ** 10, 0.02 / mean))

export const updateExposure = (current: number, target: number, seconds: number) => current + (target - current) * -Math.expm1(-seconds / 0.5)
