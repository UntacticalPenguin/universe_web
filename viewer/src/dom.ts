export const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!

export const SVG_NS = "http://www.w3.org/2000/svg"

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}, text?: string) {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value))
  if (text !== undefined) element.textContent = text
  return element
}
