import { svg } from "../dom.ts"

/** The rail spans 200 au (bottom) to the edge of the observable universe (top), one row per decade of parsecs. */
const LOG_MIN = -3
const LOG_MAX = 10.3
const PADDING_PX = 32
const SEGMENTS = 10
const COLUMN = { label: 50, meter: 58, spine: 118, landmark: 128 }
const SEGMENT_PX = 4

const LANDMARKS: [parsecs: number, name: string][] = [
  [1.3, "proxima"],
  [136, "pleiades"],
  [8_200, "galactic centre"],
  [50_000, "lmc"],
  [765_000, "andromeda"],
  [1.65e7, "virgo cluster"],
  [3.4e9, "z = 1"],
  [1.42e10, "cmb"],
]

type ScaleRailOptions = {
  element: SVGSVGElement
  /** Stars per decade of distance from the Sun, indexed from `LOG_MIN`. */
  starsPerDecade: number[]
  /** The farthest star loaded, in parsecs, for the bracket marking where data exists. */
  dataExtent: [number, number]
  onScrub: (parsecs: number) => void
}

/**
 * A logarithmic ruler of distance down the left edge: a row per decade with its label, a meter of how many loaded stars lie at that distance
 * from the Sun, and landmarks. A white tick marks the camera's distance from its target; dragging along the rail sets it, in orange.
 */
export function createScaleRail({ element, starsPerDecade, dataExtent, onScrub }: ScaleRailOptions) {
  let height = 0
  let marker: SVGGElement | undefined

  const yOf = (parsecs: number) => PADDING_PX + ((LOG_MAX - Math.log10(parsecs)) / (LOG_MAX - LOG_MIN)) * (height - 2 * PADDING_PX)
  const parsecsAt = (y: number) => 10 ** (LOG_MAX - ((y - PADDING_PX) / (height - 2 * PADDING_PX)) * (LOG_MAX - LOG_MIN))

  function layout() {
    height = element.clientHeight
    element.replaceChildren()
    const maxCount = Math.max(1, ...starsPerDecade)

    element.append(svg("line", { class: "spine", x1: COLUMN.spine, x2: COLUMN.spine, y1: yOf(10 ** LOG_MAX), y2: yOf(10 ** LOG_MIN) }))
    for (let decade = LOG_MIN; decade <= Math.floor(LOG_MAX); decade++) {
      const y = yOf(10 ** decade)
      element.append(svg("line", { class: "major", x1: COLUMN.spine - 8, x2: COLUMN.spine, y1: y, y2: y }))
      element.append(svg("text", { class: "label", x: COLUMN.label, y: y + 3, "text-anchor": "end" }, labelOf(decade)))
      for (let k = 2; k < 10; k++) {
        const minorY = yOf(k * 10 ** decade)
        if (minorY > PADDING_PX) element.append(svg("line", { class: "minor", x1: COLUMN.spine - 4, x2: COLUMN.spine, y1: minorY, y2: minorY }))
      }
      const count = starsPerDecade[decade - LOG_MIN] ?? 0
      const lit = count === 0 ? 0 : Math.max(1, Math.round((SEGMENTS * Math.log10(1 + count)) / Math.log10(1 + maxCount)))
      const rowY = (y + yOf(10 ** (decade + 1))) / 2
      const meter = svg("g", { class: "meter" })
      meter.append(svg("title", {}, `${count.toLocaleString("en-US")} stars loaded at ${labelOf(decade)} – ${labelOf(decade + 1)} from the sun`))
      for (let s = 0; s < SEGMENTS; s++) {
        meter.append(svg("rect", { class: s < lit ? "on" : "", x: COLUMN.meter + s * (SEGMENT_PX + 1), y: rowY - 3, width: SEGMENT_PX, height: 6 }))
      }
      element.append(meter)
    }
    for (const [parsecs, name] of LANDMARKS) {
      const y = yOf(parsecs)
      element.append(svg("line", { class: "landmark-tick", x1: COLUMN.spine, x2: COLUMN.spine + 4, y1: y, y2: y }))
      element.append(svg("text", { class: "landmark", x: COLUMN.landmark, y: y + 3 }, name))
    }
    const [near, far] = dataExtent.map(yOf)
    element.append(svg("path", { class: "extent", d: `M${COLUMN.spine - 12} ${far}h-3V${near}h3` }))

    marker = svg("g", { class: "marker" })
    marker.append(svg("line", { x1: COLUMN.spine - 14, x2: COLUMN.spine + 6, y1: 0, y2: 0 }))
    element.append(marker)
  }

  function setDistance(parsecs: number) {
    if (!marker) return
    const clamped = Math.min(10 ** LOG_MAX, Math.max(10 ** LOG_MIN, parsecs))
    marker.setAttribute("transform", `translate(0 ${yOf(clamped)})`)
  }

  element.addEventListener("pointerdown", (event) => {
    element.setPointerCapture(event.pointerId)
    element.toggleAttribute("data-live", true)
    const scrub = (e: PointerEvent) => onScrub(parsecsAt(e.clientY - element.getBoundingClientRect().top))
    const end = () => {
      element.toggleAttribute("data-live", false)
      element.removeEventListener("pointermove", scrub)
      element.removeEventListener("pointerup", end)
      element.removeEventListener("pointercancel", end)
    }
    scrub(event)
    element.addEventListener("pointermove", scrub)
    element.addEventListener("pointerup", end)
    element.addEventListener("pointercancel", end)
  })

  layout()
  return { layout, setDistance }
}

/** Decades below 1 pc read in astronomical units, which are easier to picture there. */
function labelOf(decade: number) {
  const named: Record<number, string> = { [-3]: "206 au", [-2]: "2k au", [-1]: "21k au" }
  if (decade in named) return named[decade]
  const units = ["pc", "kpc", "Mpc", "Gpc"]
  const unit = units[Math.min(3, Math.floor(decade / 3))]
  return `${10 ** (decade - 3 * units.indexOf(unit))} ${unit}`
}

/** Counts stars per decade of distance from the Sun, for the rail's meters. */
export function countPerDecade(positions: Float32Array, count: number) {
  const counts = new Array(Math.ceil(LOG_MAX) - LOG_MIN + 1).fill(0)
  let near = Infinity
  let far = 0
  for (let i = 0; i < count; i++) {
    const r = Math.hypot(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2])
    if (r === 0) continue
    near = Math.min(near, r)
    far = Math.max(far, r)
    const decade = Math.floor(Math.log10(r)) - LOG_MIN
    if (decade >= 0 && decade < counts.length) counts[decade]++
  }
  return { counts, extent: [near, far] as [number, number] }
}
