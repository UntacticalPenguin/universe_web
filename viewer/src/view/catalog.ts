import * as THREE from "three"

export type Landmark = { id: string; name: string; position: [number, number, number]; distance: number }
// Named-star coordinates adapted from HYG v4.0 (CC BY-SA 4.0), rotated from J2000 equatorial to heliocentric Galactic XYZ, in pc.
export const catalog: Landmark[] = [
  { id: "sun", name: "Sun", position: [0, 0, 0], distance: 3 },
  { id: "milky-way", name: "Milky Way", position: [8200, 0, 0], distance: 38000 },
  { id: "galactic-centre", name: "Galactic centre", position: [8200, 0, 0], distance: 1500 },
  { id: "lmc", name: "Large Magellanic Cloud", position: [7563.8436, -40948.8081, -26928.6368], distance: 9500 },
  { id: "proxima", name: "Proxima Centauri", position: [0.8986, -0.9325, -0.0436], distance: 1 },
  { id: "sirius", name: "Sirius", position: [-1.7692, -1.9125, -0.4075], distance: 1 },
  { id: "vega", name: "Vega", position: [2.7804, 6.6955, 2.5299], distance: 2 },
  { id: "arcturus", name: "Arcturus", position: [3.8762, 1.0423, 10.5176], distance: 2 },
  { id: "betelgeuse", name: "Betelgeuse", position: [-141.9052, -51.0533, -23.7742], distance: 6 },
  { id: "rigel", name: "Rigel", position: [-208.7916, -116.8867, -112.8296], distance: 6 },
  { id: "polaris", name: "Polaris", position: [-65.1525, 99.2586, 59.0974], distance: 6 },
]
export function diskOutline() {
  const vertices = Array.from({ length: 361 }, (_, i) => {
    const a = (i * Math.PI) / 180
    return new THREE.Vector3(8200 + 15000 * Math.cos(a), 15000 * Math.sin(a), 0)
  })
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(vertices),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 340, gapSize: 220, transparent: true, opacity: 0.7, depthTest: false }),
  )
  line.computeLineDistances()
  return line
}
