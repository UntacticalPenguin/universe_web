import * as THREE from "three"
import type { OrbitControls } from "three/addons/controls/OrbitControls.js"

/** Compass meridians follow the camera. Drag or latch a direction to orbit its current pivot. */
export function createOrbitGlobe(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const globe = document.querySelector<SVGSVGElement>("#orbit-globe")!
  const meridians = globe.querySelector("path")!
  const directions = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-orbit]"))
  const speedMenu = document.querySelector<HTMLSelectElement>("#rotation-speed")!
  const speed = () => Number(speedMenu.value)
  speedMenu.onchange = () => {
    controls.rotateSpeed = speed()
  }
  let active: HTMLButtonElement | undefined

  function stop() {
    active?.setAttribute("aria-pressed", "false")
    active = undefined
  }
  function turn(horizontal: number, vertical: number) {
    const offset = camera.position.clone().sub(controls.target)
    const radius = offset.length()
    if (!radius) return
    const azimuth = Math.atan2(offset.y, offset.x) + horizontal * speed()
    const elevation = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(offset.z / radius, -1, 1)) + vertical * speed(),
      -Math.PI / 2 + 1e-5,
      Math.PI / 2 - 1e-5,
    )
    offset.set(Math.cos(elevation) * Math.cos(azimuth), Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation))
    camera.position.copy(controls.target).addScaledVector(offset, radius)
    controls.update()
  }
  directions.forEach(
    (button) =>
      (button.onclick = () => {
        const same = button === active
        stop()
        if (!same) {
          active = button
          button.setAttribute("aria-pressed", "true")
        }
      }),
  )
  controls.addEventListener("start", stop)
  let drag: { id: number; x: number; y: number } | undefined
  globe.onpointerdown = (e) => {
    if (drag || e.button !== 0) return
    stop()
    globe.setPointerCapture(e.pointerId)
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  globe.onpointermove = (e) => {
    if (drag?.id !== e.pointerId || !drag) return
    const scale = Math.PI / globe.getBoundingClientRect().width
    turn((drag.x - e.clientX) * scale, (e.clientY - drag.y) * scale)
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  globe.onlostpointercapture = () => {
    drag = undefined
  }
  globe.onkeydown = (e) => {
    const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    if (!delta[e.key]) return
    e.preventDefault()
    stop()
    turn((delta[e.key][0] * Math.PI) / 18, (delta[e.key][1] * Math.PI) / 18)
  }
  const lines: THREE.Vector3[][] = []
  const point = (lon: number, lat: number) => new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))
  for (let m = 0; m < 8; m++) lines.push(Array.from({ length: 33 }, (_, i) => point((m * Math.PI) / 4, (i / 32 - 0.5) * Math.PI)))
  for (let p = -1; p <= 1; p++) lines.push(Array.from({ length: 65 }, (_, i) => point((i * Math.PI) / 32, (p * Math.PI) / 4)))
  const inverse = new THREE.Quaternion(),
    local = new THREE.Vector3()
  const last = new THREE.Quaternion(0, 0, 0, 0)
  function draw() {
    if (last.equals(camera.quaternion)) return
    last.copy(camera.quaternion)
    inverse.copy(last).invert()
    meridians.setAttribute(
      "d",
      lines
        .map((line) => {
          let visible = false,
            path = ""
          for (const v of line) {
            local.copy(v).applyQuaternion(inverse)
            if (local.z >= 0) path += (visible ? "L" : "M") + (50 + 40 * local.x).toFixed(1) + " " + (50 - 40 * local.y).toFixed(1)
            visible = local.z >= 0
          }
          return path
        })
        .join(""),
    )
  }
  return {
    stop,
    step(seconds: number) {
      if (active) {
        const [x, y] = active.dataset.orbit!.split(",").map(Number)
        turn(x * Math.min(seconds, 0.1), y * Math.min(seconds, 0.1))
      }
      if (globe.getClientRects().length) draw()
    },
  }
}
