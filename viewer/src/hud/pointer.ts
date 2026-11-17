import type { StarHit } from "../stars/screen-index.ts"

/** Stars within this distance of the hand are candidates; the nearest one is framed. */
const RANGE_PX = 28
/** A press that travels further than this is an orbit drag, not a click on a star. */
const CLICK_SLOP_PX = 4
const BRACKET_ARM_PX = 4

type PointerOptions = {
  /** A full-page layer that never takes the pointer. */
  layer: HTMLElement
  /** The surface the hand moves over: the sky canvas. */
  surface: HTMLElement
  pick: (x: number, y: number, rangePx: number) => StarHit | undefined
  /** The readout beside a framed star, as HTML. */
  describe: (hit: StarHit) => string
  onSelect: (hit: StarHit) => void
}

/**
 * The page's pointer over the sky, for mice and pens. Hairlines edge to edge mark the hand; the star nearest to it is framed by corner brackets
 * and described. Orange marks what the hand is changing: while pressed, the hairlines and brackets turn orange.
 */
export function createPointer({ layer, surface, pick, describe, onSelect }: PointerOptions) {
  layer.innerHTML = `
    <i class="hairline vertical"></i><i class="hairline horizontal"></i>
    <svg class="marks"><path class="corners" /></svg>
    <span class="readout"></span>`
  const corners = layer.querySelector<SVGPathElement>(".corners")!
  const readout = layer.querySelector<HTMLElement>(".readout")!

  let hand: { x: number; y: number } | undefined
  let press: { x: number; y: number; hit?: StarHit } | undefined
  let frame = 0

  const use = (isCustom: boolean) => {
    if (isCustom) document.documentElement.dataset.cursor = "custom"
    else delete document.documentElement.dataset.cursor
  }

  function draw() {
    frame = 0
    if (!hand) {
      layer.hidden = true
      return
    }
    layer.hidden = false
    layer.style.setProperty("--x", `${hand.x}px`)
    layer.style.setProperty("--y", `${hand.y}px`)
    const hit = press?.hit ?? pick(hand.x, hand.y, RANGE_PX)
    corners.setAttribute("d", hit ? bracketsAround(hit) : "")
    readout.innerHTML = hit ? describe(hit) : ""
    if (hit) {
      const half = halfSizeOf(hit)
      readout.style.translate = `${hit.x + half + 6}px ${hit.y - half - 6}px`
    }
  }

  const schedule = () => (frame ||= requestAnimationFrame(draw))

  surface.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return use(false)
    use(true)
    hand = { x: event.clientX, y: event.clientY }
    schedule()
  })
  surface.addEventListener("pointerleave", () => {
    hand = undefined
    schedule()
  })
  surface.addEventListener("pointerdown", (event) => {
    press = { x: event.clientX, y: event.clientY, hit: pick(event.clientX, event.clientY, RANGE_PX) }
    layer.toggleAttribute("data-live", true)
    schedule()
  })
  window.addEventListener("pointerup", (event) => {
    if (!press) return
    const isClick = Math.hypot(event.clientX - press.x, event.clientY - press.y) <= CLICK_SLOP_PX
    if (isClick && press.hit) onSelect(press.hit)
    press = undefined
    layer.toggleAttribute("data-live", false)
    schedule()
  })

  return { refresh: schedule }
}

const halfSizeOf = (hit: StarHit) => Math.max(6, hit.sizePx / 2 + 4)

function bracketsAround(hit: StarHit) {
  const h = halfSizeOf(hit)
  const a = BRACKET_ARM_PX
  const [l, r, t, b] = [hit.x - h, hit.x + h, hit.y - h, hit.y + h]
  return [`M${l} ${t + a}V${t}H${l + a}`, `M${r - a} ${t}H${r}V${t + a}`, `M${r} ${b - a}V${b}H${r - a}`, `M${l + a} ${b}H${l}V${b - a}`].join("")
}
