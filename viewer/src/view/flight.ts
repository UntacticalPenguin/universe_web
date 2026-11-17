import * as THREE from "three"
import type { OrbitControls } from "three/addons/controls/OrbitControls.js"

const DURATION_MS = 600

/** Moves the orbit target, and the camera with it, to a new point; the camera keeps its offset, so a flight pans rather than zooms. */
export function createFlight(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  let flight: { from: THREE.Vector3; to: THREE.Vector3; startedAt: number } | undefined

  function to(target: THREE.Vector3) {
    flight = { from: controls.target.clone(), to: target.clone(), startedAt: performance.now() }
  }

  /** Advances the flight; returns whether anything moved. */
  function step(now: number) {
    if (!flight) return false
    const t = Math.min(1, (now - flight.startedAt) / DURATION_MS)
    const next = flight.from.clone().lerp(flight.to, easeOut(t))
    camera.position.add(next.clone().sub(controls.target))
    controls.target.copy(next)
    if (t === 1) flight = undefined
    return true
  }

  /** Sets the camera's distance from the target, keeping its direction. */
  function setDistance(parsecs: number) {
    const offset = camera.position.clone().sub(controls.target)
    camera.position.copy(controls.target).add(offset.setLength(parsecs))
  }

  return {
    to,
    step,
    setDistance,
    cancel: () => (flight = undefined),
    isFlying: () => flight !== undefined,
    distance: () => camera.position.distanceTo(controls.target),
  }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3
