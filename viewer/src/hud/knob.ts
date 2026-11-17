/** Pixels of vertical drag that sweep the whole range. */
const SWEEP_PX = 160

type KnobOptions = {
  element: HTMLButtonElement
  output: HTMLElement
  min: number
  max: number
  step: number
  value: number
  format: (value: number) => string
  onInput: (value: number) => void
}

/**
 * A round control that fills clockwise with its value. Drag up or down, scroll over it, or use the arrow keys; double click restores the default.
 * Orange while dragged.
 */
export function createKnob({ element, output, min, max, step, value: initial, format, onInput }: KnobOptions) {
  let value = initial

  function set(next: number) {
    value = Math.min(max, Math.max(min, Math.round(next / step) * step))
    element.style.setProperty("--fill", String((value - min) / (max - min)))
    element.setAttribute("aria-valuenow", String(value))
    element.setAttribute("aria-valuetext", format(value))
    output.textContent = format(value)
    onInput(value)
  }

  element.setAttribute("role", "slider")
  element.setAttribute("aria-valuemin", String(min))
  element.setAttribute("aria-valuemax", String(max))

  element.addEventListener("pointerdown", (event) => {
    element.setPointerCapture(event.pointerId)
    element.toggleAttribute("data-dragging", true)
    const startY = event.clientY
    const startValue = value
    const move = (e: PointerEvent) => set(startValue + ((startY - e.clientY) / SWEEP_PX) * (max - min))
    const end = () => {
      element.toggleAttribute("data-dragging", false)
      element.removeEventListener("pointermove", move)
      element.removeEventListener("pointerup", end)
      element.removeEventListener("pointercancel", end)
    }
    element.addEventListener("pointermove", move)
    element.addEventListener("pointerup", end)
    element.addEventListener("pointercancel", end)
  })
  element.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault()
      set(value - Math.sign(event.deltaY) * step * 2)
    },
    { passive: false },
  )
  element.addEventListener("keydown", (event) => {
    const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key]
    if (direction === undefined) return
    event.preventDefault()
    set(value + direction * step * (event.shiftKey ? 10 : 1))
  })
  element.addEventListener("dblclick", () => set(initial))

  set(initial)
  return { value: () => value, set }
}
