import * as THREE from "three"

/** A ring around the orbit target with its name, drawn over the sky at the target's screen position. */
export function createTargetMark(element: HTMLElement, camera: THREE.PerspectiveCamera) {
  const label = element.querySelector<HTMLElement>("span")!
  const projected = new THREE.Vector3()

  return function place(target: THREE.Vector3, name: string, width: number, height: number) {
    projected.copy(target).project(camera)
    const isVisible = projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1
    element.hidden = !isVisible
    if (!isVisible) return
    element.style.translate = `${((projected.x + 1) / 2) * width}px ${((1 - projected.y) / 2) * height}px`
    label.textContent = name
  }
}
