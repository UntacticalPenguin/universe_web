import type { Hierarchy } from "./hierarchy.ts"
import type { decodeTile } from "./decode.ts"
export function createTileLoader(tree: Hierarchy, receive: (id: string, tile: ReturnType<typeof decodeTile>) => void, changed: () => void) {
  const active = new Map<string, Worker>(),
    retry = new Map<string, number>()
  function update(wanted: string[]) {
    const keep = new Set(wanted)
    for (const [id, w] of active)
      if (!keep.has(id)) {
        w.terminate()
        active.delete(id)
      }
    for (const id of wanted) {
      if (active.size >= 6) break
      if (active.has(id) || (retry.get(id) ?? 0) > Date.now()) continue
      const w = new Worker(new URL("./decode-worker.ts", import.meta.url), { type: "module" })
      active.set(id, w)
      function finish(error?: string) {
        w.terminate()
        active.delete(id)
        if (error) {
          console.warn(id, error)
          retry.set(id, Date.now() + 10000)
          setTimeout(changed, 10010)
        }
        changed()
      }
      w.onmessage = (e) => {
        if (!e.data.error) receive(id, e.data)
        finish(e.data.error)
      }
      w.onerror = (e) => finish(e.message)
      w.postMessage(tree.nodes[id])
    }
  }
  return { update, active: () => active.size }
}
