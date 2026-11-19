/** A click-open native value menu, including all keyboard-selectable numeric settings. */
export function createSelector(options: {
  element: HTMLSelectElement
  min: number
  max: number
  step: number
  value: number
  format: (value: number) => string
  onInput: (value: number) => void
}) {
  const { element, min, max, step, value, format, onInput } = options
  for (let n = 0; n <= Math.round((max - min) / step); n++) {
    const v = Number((min + n * step).toFixed(2))
    element.add(new Option(format(v), String(v)))
  }
  element.value = String(value)
  element.addEventListener("change", () => onInput(Number(element.value)))
  onInput(value)
  return { value: () => Number(element.value) }
}
