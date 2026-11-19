import * as THREE from "three"
import type { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { createSlider } from "./value-slider.ts"
import { $ } from "../dom.ts"

/** A fixed world-space orbit axis gives an uninterrupted circle even for a vertical shot. */
export function createCinematicOrbit(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const play = $<HTMLButtonElement>("#orbit-play")
  const axis = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const defaultAutoRotate = controls.autoRotate
  let playing = false
  function setAxis(degrees: number) {
    const heading = THREE.MathUtils.degToRad(degrees)
    axis.set(-Math.sin(heading), Math.cos(heading), 0).applyQuaternion(camera.quaternion)
  }
  const direction = createSlider({
    element: $<HTMLInputElement>("#orbit-direction"),
    min: -180,
    max: 180,
    step: 1,
    value: 0,
    format: (d) => `${d}°`,
    onInput: (d) => {
      setAxis(d)
      $("#heading-arrow").style.transform = `rotate(${-d}deg)`
    },
  })
  const speed = createSlider({
    element: $<HTMLInputElement>("#orbit-speed"),
    min: 0.5,
    max: 30,
    step: 0.5,
    value: 4,
    format: (s) => `${s}°/s`,
    onInput: () => {},
  })
  function stop() {
    controls.autoRotate = defaultAutoRotate
    playing = false
    play.setAttribute("aria-pressed", "false")
    play.textContent = "▶ Play orbit"
  }
  play.onclick = () => {
    if (playing) return stop()
    setAxis(direction.value())
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion)
    controls.autoRotate = false
    playing = true
    play.setAttribute("aria-pressed", "true")
    play.textContent = "Ⅱ Pause orbit"
  }
  controls.addEventListener("start", stop)
  return {
    stop,
    step(seconds: number) {
      if (!playing) return
      const angle = THREE.MathUtils.degToRad(speed.value()) * Math.min(seconds, 0.1)
      offset.copy(camera.position).sub(controls.target).applyAxisAngle(axis, angle)
      camera.position.copy(controls.target).add(offset)
      camera.up.applyAxisAngle(axis, angle)
    },
  }
}
