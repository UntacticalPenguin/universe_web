import * as THREE from "three"
import type { Hierarchy } from "./hierarchy.ts"

export function selectNodes(tree: Hierarchy, camera: THREE.PerspectiveCamera, height: number, limit: number, budget: number, loaded: (id: string) => boolean) {
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
  const focal = (height * camera.projectionMatrix.elements[5]) / 2
  const queue: { id: string; pixels: number }[] = []
  const draw: string[] = [],
    request: string[] = []
  let points = 0
  function candidate(id: string) {
    const n = tree.nodes[id],
      c = new THREE.Vector3(...n.center)
    const box = new THREE.Box3(c.clone().addScalar(-n.half), c.clone().addScalar(n.half))
    if (!frustum.intersectsBox(box) || n.mMin + 5 * Math.log10(Math.max(1e-6, box.distanceToPoint(camera.position)) / 10) > limit) return null
    return { id, pixels: (2 * n.half * focal) / Math.max(1e-6, c.distanceTo(camera.position)) }
  }
  function push(item: NonNullable<ReturnType<typeof candidate>>) {
    let i = queue.length
    queue.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (queue[parent].pixels >= item.pixels) break
      queue[i] = queue[parent]
      i = parent
    }
    queue[i] = item
  }
  function pop() {
    const head = queue[0],
      tail = queue.pop()!
    if (queue.length) {
      let i = 0
      while (i * 2 + 1 < queue.length) {
        let child = i * 2 + 1
        if (child + 1 < queue.length && queue[child + 1].pixels > queue[child].pixels) child++
        if (tail.pixels >= queue[child].pixels) break
        queue[i] = queue[child]
        i = child
      }
      queue[i] = tail
    }
    return head
  }
  for (const root of tree.roots) {
    const c = candidate(root)
    if (c) push(c)
  }
  while (queue.length) {
    const { id, pixels } = pop(),
      n = tree.nodes[id]
    if (points + n.count > budget) continue
    points += n.count
    if (!loaded(id)) {
      request.push(id)
      continue
    }
    draw.push(id)
    if (pixels <= 300) continue
    for (const child of n.children) {
      const next = candidate(child)
      if (next) push(next)
    }
  }
  return { draw, request }
}
