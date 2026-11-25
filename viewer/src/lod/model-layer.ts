import * as THREE from "three"
import { createGaussianMaterial } from "./glow-layer"
import { createScreenIndex, type StarHit } from "../stars/screen-index"
import type { StarData } from "../stars/load-stars"

export async function loadModel(base: string, scene: THREE.Scene, options: Omit<Parameters<typeof createScreenIndex>[0], "data">, changed: () => void) {
  const prefix = base + "tiles/model/"
  const manifest = await fetch(prefix + "hierarchy.json")
  if (manifest.status === 404 || manifest.headers.get("content-type")?.includes("text/html")) return
  if (!manifest.ok) throw Error("Model manifest HTTP " + manifest.status)
  const meta = await manifest.json()
  if (meta.format !== "MWM1" || meta.version !== 1) throw Error("Unsupported Milky Way model")
  const { uniforms, material } = createGaussianMaterial(true)
  const quad = new THREE.PlaneGeometry(2, 2)
  const group = new THREE.Group()
  group.visible = false
  const indices: { index: ReturnType<typeof createScreenIndex>; data: StarData }[] = []
  for (const [name, node] of Object.entries(meta.tiles) as [string, { count: number }][]) {
    if (!/^r[0-7]$/.test(name)) throw Error("Invalid model tile name")
    const response = await fetch(prefix + name + ".bin")
    if (!response.ok) throw Error("Model tile HTTP " + response.status)
    const bytes = await response.arrayBuffer(),
      header = new DataView(bytes)
    if (
      bytes.byteLength !== 16 + node.count * 24 ||
      header.getUint32(0) !== 0x4d574d31 ||
      header.getUint32(4, true) !== 1 ||
      header.getUint32(8, true) !== node.count
    )
      throw Error("Invalid model tile")
    const rows = new Float32Array(bytes, 16),
      positions = new Float32Array(node.count * 3),
      props = new Float32Array(node.count * 3)
    let count = 0
    for (let i = 0; i < rows.length; i += 6) {
      if (rows[i + 5] <= 0) continue
      positions.set(rows.subarray(i, i + 3), count * 3)
      props.set([300, rows[i + 3] * rows[i + 5], rows[i + 4]], count * 3)
      count++
    }
    const xyz = positions.subarray(0, count * 3)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = quad.index
    geometry.setAttribute("position", quad.attributes.position)
    geometry.setAttribute("offsetPc", new THREE.InstancedBufferAttribute(xyz, 3))
    geometry.setAttribute("properties", new THREE.InstancedBufferAttribute(props.subarray(0, count * 3), 3))
    geometry.instanceCount = count
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    group.add(mesh)
    const empty = new Uint8Array(count),
      missing = new Uint8Array(count).fill(255)
    const data: StarData = { version: 2, count, positions: xyz, absMag: empty, colour: empty, teff: missing, extinction: missing, reddening: missing }
    indices.push({ data, index: createScreenIndex({ ...options, data, magLimit: () => Infinity }) })
  }
  scene.add(group)
  changed()
  return {
    update(enabled: boolean, height: number, dustScreen: boolean) {
      uniforms.dustScreen.value = dustScreen
      uniforms.strength.value = enabled ? THREE.MathUtils.smoothstep(options.camera.position.length(), 2000, 8000) : 0
      group.visible = uniforms.strength.value > 0
      uniforms.observer.value.copy(options.camera.position)
      uniforms.focal.value = (height * options.camera.projectionMatrix.elements[5]) / 2
      return group.visible
    },
    clear() {
      for (const { index } of indices) index.clear()
    },
    rebuild() {
      if (group.visible) for (const { index } of indices) index.rebuild()
    },
    nearest(x: number, y: number) {
      let best: StarHit | undefined,
        closest = Infinity
      if (group.visible)
        for (const { index, data } of indices) {
          const hit = index.nearest(x, y, 6)
          if (!hit) continue
          const d = Math.hypot(x - hit.x, y - hit.y)
          if (d < closest) {
            best = { ...hit, data, tileId: "model", sizePx: 2 }
            closest = d
          }
        }
      return best
    },
  }
}
