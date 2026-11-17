import { distanceParts, formatCount } from "../format.ts"

export type TrayStatus = {
  target: string
  distancePc: number
  loaded: number
  /** Stars bright enough to draw from here; unknown while the camera moves. */
  visible?: number
  /** Frames drawn in the last second; zero while nothing changes. */
  fps: number
  /** Median time to draw one frame, GPU included; only measured in benchmark mode (`?bench=1`). */
  drawMs?: number
}

/** Fills the tray's readings; the fields themselves are in the page markup. */
export function createTray(element: HTMLElement) {
  const field = (name: string) => element.querySelector<HTMLElement>(`[data-field="${name}"] b`)!
  const fields = {
    target: field("target"),
    distance: field("distance"),
    loaded: field("loaded"),
    visible: field("visible"),
    fps: field("fps"),
    draw: field("draw"),
  }
  const drawField = element.querySelector<HTMLElement>('[data-field="draw"]')!

  return function show({ target, distancePc, loaded, visible, fps, drawMs }: TrayStatus) {
    fields.target.textContent = target
    const [value, unit] = distanceParts(distancePc)
    fields.distance.replaceChildren(value, Object.assign(document.createElement("small"), { textContent: unit }))
    fields.loaded.textContent = formatCount(loaded)
    fields.visible.textContent = visible === undefined ? "—" : formatCount(visible)
    fields.fps.textContent = fps === 0 ? "idle" : String(fps)
    element.toggleAttribute("data-rendering", fps > 0)
    drawField.hidden = drawMs === undefined
    fields.draw.textContent = drawMs === undefined ? "—" : drawMs.toFixed(1)
  }
}
