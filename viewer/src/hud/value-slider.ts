/** A full-width, click-to-set track with a fixed-width live readout. */
export function createSlider(options: {
  element: HTMLInputElement
  min: number
  max: number
  step: number
  value: number
  format: (value: number) => string
  onInput: (value: number) => void
}) {
  const { element, min, max, step, value, format, onInput } = options
  const output = element.parentElement!.querySelector("output")!
  Object.assign(element, { min: String(min), max: String(max), step: String(step), value: String(value) })
  const refresh = () => {
    const text = format(element.valueAsNumber)
    output.value = text
    element.setAttribute("aria-valuetext", text)
    onInput(element.valueAsNumber)
  }
  element.addEventListener("input", refresh)
  refresh()
  return { value: () => element.valueAsNumber }
}
