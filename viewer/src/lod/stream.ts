import * as THREE from "three"
import { createStarsLayer } from "../stars/stars-layer"
import { createScreenIndex, type StarHit } from "../stars/screen-index"
import { selectNodes } from "./select-nodes"
import { createTileLoader } from "./tile-loader"
import type { decodeTile } from "./decode"
import type { Hierarchy } from "./hierarchy"

import { createGlowLayer, unresolvedLight } from "./glow-layer"

type Options = Omit<Parameters<typeof createScreenIndex>[0], "data">
export function createStream(tree: Hierarchy, scene: THREE.Scene, options: Options, pixelRatio: number, budget: number, changed: () => void, debug: boolean) {
  const glow = createGlowLayer(tree, scene)
  let firstDraw = new Map<string, number>()
  function entry(id: string, tile: ReturnType<typeof decodeTile>) {
    const node = tree.nodes[id],
      layer = createStarsLayer(tile.data, pixelRatio, { half: node.half, offsets: tile.offsets })
    layer.points.visible = false
    scene.add(layer.points)
    const center = new THREE.Vector3(...node.center)
    const box = debug ? new THREE.Box3Helper(new THREE.Box3(center.clone().addScalar(-node.half), center.clone().addScalar(node.half)), 0x777777) : undefined
    if (box) {
      box.visible = false
      scene.add(box)
    }
    return { layer, data: tile.data, index: createScreenIndex({ ...options, data: tile.data }), box }
  }
  const cache = new Map<string, ReturnType<typeof entry>>()
  let cachedPoints = 0,
    drawn: string[] = [],
    ready = false
  const loader = createTileLoader(
    tree,
    (id, tile) => {
      cache.set(id, entry(id, tile))
      cachedPoints += tile.data.count
    },
    changed,
  )
  function update() {
    const { camera } = options
    camera.updateMatrixWorld()
    const selection = selectNodes(tree, camera, options.viewport().height, options.magLimit() + (options.dust() ? 0 : 8), budget, (id) => cache.has(id))
    for (const id of drawn) {
      const item = cache.get(id)!
      item.layer.points.visible = false
      if (item.box) item.box.visible = false
    }
    const now = performance.now()
    const nextFirstDraw = new Map<string, number>()
    const frontier = new Set(selection.frontier)
    const key = options.dust() ? "lSum" : "lSum0"
    const weights = new Map<string, number>()
    let fading = false
    drawn = selection.draw
    const drawSet = new Set(drawn)
    for (const id of drawn) {
      const item = cache.get(id)!,
        layer = item.layer
      cache.delete(id)
      cache.set(id, item)
      const node = tree.nodes[id]
      const start = firstDraw.get(id) ?? now
      nextFirstDraw.set(id, start)
      const weight = Math.min(1, (now - start) / 250)
      const inherited = weights.get(id) ?? 1
      const contribution = inherited * weight
      layer.setWeight(contribution)
      fading ||= weight < 1
      const childLight = node.children.reduce((sum, id) => sum + tree.nodes[id][key], 0)
      const parent = weights.has(id)
      const terminal = frontier.delete(id)
      let light = parent ? 0 : unresolvedLight(node[key], childLight, weight, true) * inherited
      if (terminal) light += childLight * (parent ? contribution : inherited)
      else
        for (const child of node.children) {
          const childStart = firstDraw.get(child) ?? now
          const arrival = Math.min(1, (now - childStart) / 250)
          if (frontier.has(child) && !drawSet.has(child)) {
            light += tree.nodes[child][key] * contribution
            frontier.delete(child)
          } else if (drawSet.has(child)) {
            light += tree.nodes[child][key] * contribution * (1 - arrival)
            weights.set(child, contribution)
          }
        }
      if (!parent && !terminal) light += childLight * inherited * (1 - weight)
      glow.add(node, light, camera, options.dust())
      layer.points.visible = true
      if (item.box) item.box.visible = true
      layer.offset.set(...tree.nodes[id].center).sub(camera.position)
      layer.setDust(options.dust())
      layer.setExposure(options.exposure())
      layer.setMagLimit(options.magLimit())
      layer.setSpikes(options.spikes())
    }
    // 64 bytes per resident point allows for decoded positions, GPU attributes and picking buckets.
    for (const [id, item] of cache) {
      if (cachedPoints * 64 <= 256 * 1024 * 1024 || item.layer.points.visible) break
      scene.remove(item.layer.points)
      item.layer.dispose()
      if (item.box) {
        scene.remove(item.box)
        item.box.dispose()
      }
      cache.delete(id)
      cachedPoints -= item.data.count
    }
    firstDraw = nextFirstDraw
    for (const id of frontier) glow.add(tree.nodes[id], tree.nodes[id][key], camera, options.dust())
    glow.finish((options.viewport().height * pixelRatio * camera.projectionMatrix.elements[5]) / 2)
    loader.update(selection.request)
    return { fading, nodes: drawn.length, points: drawn.reduce((n, id) => n + tree.nodes[id].count, 0), pending: loader.active() }
  }
  return {
    update,
    loaded: () => cachedPoints,
    clear() {
      ready = false
      for (const id of drawn) cache.get(id)?.index.clear()
    },
    rebuild() {
      ready = true
      return drawn.reduce((n, id) => n + cache.get(id)!.index.rebuild(), 0)
    },
    isReady: () => ready,
    nearest(x: number, y: number, range: number) {
      let best: StarHit | undefined,
        score = Infinity
      for (const id of drawn) {
        const item = cache.get(id)!,
          hit = item.index.nearest(x, y, range)
        if (hit) {
          const distance = Math.hypot(hit.x - x, hit.y - y) - hit.sizePx
          if (distance < score) {
            best = { ...hit, data: item.data, tileId: id }
            score = distance
          }
        }
      }
      return best
    },
  }
}
