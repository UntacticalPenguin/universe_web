import "@fontsource-variable/jetbrains-mono"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { $ } from "./dom.ts"
import { formatDistance } from "./format.ts"
import { createKnob } from "./hud/knob.ts"
import { createPointer } from "./hud/pointer.ts"
import { countPerDecade, createScaleRail } from "./hud/scale-rail.ts"
import { createTargetMark } from "./hud/target-mark.ts"
import { createTray } from "./hud/tray.ts"
import { spectralClassOf, temperatureOf } from "./stars/colour-lut.ts"
import { absoluteMagnitudeOf, colourIndexOf, loadStars, type StarData } from "./stars/load-stars.ts"
import { createScreenIndex, type StarHit } from "./stars/screen-index.ts"
import { createStarsLayer } from "./stars/stars-layer.ts"
import { createFlight } from "./view/flight.ts"

const params = new URLSearchParams(window.location.search)
/** `?stars=stars-3m.bin` loads another file from public/data; only plain file names are accepted. */
const STAR_FILE = `${import.meta.env.BASE_URL}data/${/^[\w.-]+\.bin$/.test(params.get("stars") ?? "") ? params.get("stars") : "stars.bin"}`
/** `?bench=1` orbits continuously and measures how long each frame takes to draw. */
const IS_BENCH = params.get("bench") === "1"
const BENCH_WINDOW = 60
/** The screen index is rebuilt once the view has been still this long. */
const SETTLE_MS = 150
const START_OFFSET = new THREE.Vector3(-1500, -2500, 1200)

async function main() {
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })
  const pixelRatio = Math.min(window.devicePixelRatio, 2)
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" })
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  $("#sky").append(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1e-6, 1e11)
  camera.up.set(0, 0, 1)
  camera.position.copy(START_OFFSET)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.zoomSpeed = 1.6
  controls.minDistance = 1e-3
  controls.maxDistance = 1e10
  controls.autoRotate = IS_BENCH
  controls.autoRotateSpeed = 6

  const data = await loadStars(STAR_FILE)
  const stars = createStarsLayer(data, pixelRatio)
  scene.add(stars.points)

  let isDirty = true
  let lastChange = performance.now()
  const invalidate = () => {
    isDirty = true
    lastChange = performance.now()
    screenIndex.clear()
    pointer.refresh()
  }
  controls.addEventListener("change", invalidate)

  let targetIndex = 0
  const targetName = () => starName(targetIndex)
  const flight = createFlight(camera, controls)

  const screenIndex = createScreenIndex({ data, camera, viewport, magLimit: () => magKnob.value(), exposure: () => exposureKnob.value() })
  const pointer = createPointer({
    layer: $("#cursor"),
    surface: renderer.domElement,
    pick: (x, y, range) => screenIndex.nearest(x, y, range),
    describe: (hit) => describeStar(data, hit),
    onSelect: (hit) => {
      targetIndex = hit.index
      flight.to(positionOf(data, hit.index))
      invalidate()
    },
  })

  const magKnob = createKnob({
    element: $<HTMLButtonElement>("#mag-knob"),
    output: $("#mag-value"),
    min: 2,
    max: 20,
    step: 0.1,
    value: 12,
    format: (m) => m.toFixed(1),
    onInput: (m) => (stars.setMagLimit(m), invalidate()),
  })
  const exposureKnob = createKnob({
    element: $<HTMLButtonElement>("#exposure-knob"),
    output: $("#exposure-value"),
    min: -3,
    max: 3,
    step: 0.1,
    value: 0,
    format: (stops) => `${stops >= 0 ? "+" : ""}${stops.toFixed(1)}`,
    onInput: (stops) => (stars.setExposure(stops), invalidate()),
  })

  const { counts, extent } = countPerDecade(data.positions, data.count)
  const rail = createScaleRail({
    element: $<SVGSVGElement>("#rail"),
    starsPerDecade: counts,
    dataExtent: extent,
    onScrub: (parsecs) => {
      flight.cancel()
      flight.setDistance(parsecs)
      invalidate()
    },
  })

  $("#home").addEventListener("click", () => {
    targetIndex = 0
    flight.to(new THREE.Vector3())
    invalidate()
  })

  const showTray = createTray($("#tray"))
  const placeTargetMark = createTargetMark($("#target"), camera)
  let visible: number | undefined
  let framesThisSecond = 0
  let fps = 0
  let secondStartedAt = performance.now()
  const drawTimes: number[] = []
  const gl = renderer.getContext()
  const probe = new Uint8Array(4)

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    rail.layout()
    invalidate()
  })

  renderer.setAnimationLoop((now: number) => {
    if (flight.step(now)) invalidate()
    controls.update()
    if (isDirty) {
      const startedAt = performance.now()
      renderer.render(scene, camera)
      if (IS_BENCH) {
        // Reading one pixel waits for the GPU to finish, so the time includes the GPU's work, not only the CPU's.
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe)
        drawTimes.push(performance.now() - startedAt)
        if (drawTimes.length > BENCH_WINDOW) drawTimes.shift()
      }
      isDirty = false
      framesThisSecond++
      visible = undefined
      placeTargetMark(controls.target, targetName(), window.innerWidth, window.innerHeight)
      rail.setDistance(flight.distance())
    } else if (!screenIndex.isReady() && now - lastChange > SETTLE_MS) {
      visible = screenIndex.rebuild()
      pointer.refresh()
    }
    if (now - secondStartedAt >= 1000) {
      fps = framesThisSecond
      framesThisSecond = 0
      secondStartedAt = now
    }
    showTray({ target: targetName(), distancePc: flight.distance(), loaded: data.count, visible, fps, drawMs: IS_BENCH ? median(drawTimes) : undefined })
  })
}

function median(values: number[]) {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function positionOf(data: StarData, index: number) {
  return new THREE.Vector3(data.positions[3 * index], data.positions[3 * index + 1], data.positions[3 * index + 2])
}

/** Stars are named by their row in the star file until the pipeline carries catalog ids and names. */
const starName = (index: number) => (index === 0 ? "sun" : `star #${index}`)

function describeStar(data: StarData, hit: StarHit) {
  const kelvin = temperatureOf(colourIndexOf(data, hit.index))
  return [
    `<b>${starName(hit.index)}</b>`,
    hit.index === 0 ? "" : `<b>${formatDistance(positionOf(data, hit.index).length())}</b> from sun`,
    `M <b>${absoluteMagnitudeOf(data, hit.index).toFixed(1)}</b>`,
    `m <b>${hit.apparentMag.toFixed(1)}</b>`,
    `<b>${(Math.round(kelvin / 100) * 100).toLocaleString("en-US")}</b> K`,
    `type <b>${spectralClassOf(kelvin)}</b>`,
  ]
    .filter(Boolean)
    .join(" · ")
}

main().catch((error) => {
  console.error(error)
  $("#error").textContent = `error: ${error instanceof Error ? error.message : error}`
})
