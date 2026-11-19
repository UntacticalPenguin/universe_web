import "@fontsource-variable/jetbrains-mono"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { $ } from "./dom.ts"
import { formatDistance } from "./format.ts"
import { createSlider } from "./hud/value-slider.ts"
import { createCinematicOrbit } from "./hud/cinematic-orbit.ts"
import { createPointer } from "./hud/pointer.ts"
import { countPerDecade, createScaleRail } from "./hud/scale-rail.ts"
import { createTargetMark } from "./hud/target-mark.ts"
import { createTray } from "./hud/tray.ts"
import { spectralClassOf, displayTemperature } from "./stars/colour-lut.ts"
import { absoluteMagnitudeOf, extinctionOf, reddeningOf, MISSING, loadStars, type StarData } from "./stars/load-stars.ts"
import { createScreenIndex, type StarHit } from "./stars/screen-index.ts"
import { createStarsLayer } from "./stars/stars-layer.ts"
import { createHdrTarget } from "./render/hdr-target.ts"
import { createGlow } from "./render/glow.ts"
import { createToneMap } from "./render/tone-map.ts"
import { createLuminanceMeter } from "./render/auto-exposure.ts"
import { targetExposure, updateExposure } from "./render/light.ts"
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
  $<HTMLDetailsElement>("#settings").open = !window.matchMedia("(max-width: 640px)").matches
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

  const canvas = renderer.domElement
  const hdr = createHdrTarget(canvas.width, canvas.height)
  hdr.texture.minFilter = hdr.texture.magFilter = THREE.LinearFilter
  const bloom = createGlow(hdr)
  const toneMap = createToneMap(hdr.texture, bloom.textures)
  let dust = true
  let spikes = false
  const measureMean = createLuminanceMeter(hdr)
  let automatic = true
  let baseExposure = 1
  let desiredExposure = 1
  let drawnExposure = 1
  let needsMeter = true
  let drawNumber = 0
  let lastMeterDraw = -4
  let previousTime = performance.now()
  let isDirty = true
  let lastChange = performance.now()
  const invalidate = () => {
    needsMeter = true
    isDirty = true
    lastChange = performance.now()
    screenIndex.clear()
    pointer.refresh()
  }
  controls.addEventListener("change", invalidate)

  let targetIndex = 0
  const targetName = () => starName(targetIndex)
  const flight = createFlight(camera, controls)

  const orbit = createCinematicOrbit(camera, controls)
  const drawer = $<HTMLDetailsElement>("#settings")
  drawer.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      drawer.open = false
      $("#drawer-toggle").focus()
    }
  })
  const allPosition = 20.1
  const cutoff = (m: number) => (m >= allPosition ? Infinity : m)
  const screenIndex = createScreenIndex({
    data,
    camera,
    viewport,
    magLimit: () => cutoff(magSelector.value()),
    exposure: () => drawnExposure,
    dust: () => dust,
    spikes: () => spikes,
  })
  const pointer = createPointer({
    layer: $("#cursor"),
    surface: renderer.domElement,
    pick: (x, y, range) => screenIndex.nearest(x, y, range),
    describe: (hit) => describeStar(data, hit, dust),
    onSelect: (hit) => {
      orbit.stop()
      targetIndex = hit.index
      flight.to(positionOf(data, hit.index))
      invalidate()
    },
  })

  const magSelector = createSlider({
    element: $<HTMLInputElement>("#mag-value"),
    min: 2,
    max: allPosition,
    step: 0.1,
    value: allPosition,
    format: (m) => (m >= allPosition ? "all" : m.toFixed(1)),
    onInput: (m) => (stars.setMagLimit(cutoff(m)), invalidate()),
  })
  const exposureSelector = createSlider({
    element: $<HTMLInputElement>("#exposure-value"),
    min: -3,
    max: 3,
    step: 0.1,
    value: 0,
    format: (stops) => `${stops >= 0 ? "+" : ""}${stops.toFixed(1)}`,
    onInput: invalidate,
  })

  const sat = createSlider({
    element: $<HTMLInputElement>("#sat-value"),
    min: 1,
    max: 3,
    step: 0.1,
    value: 1,
    format: (value) => `×${value.toFixed(1)}`,
    onInput: (value) => {
      $("#enhanced").hidden = value <= 1
      invalidate()
    },
  })
  const glow = createSlider({
    element: $<HTMLInputElement>("#glow-value"),
    min: 0,
    max: 20,
    step: 1,
    value: 4,
    format: (value) => `${value}%`,
    onInput: invalidate,
  })
  let missingDust = 0
  for (let i = 0; i < data.count; i++) if (data.extinction[i] === MISSING && data.reddening[i] === MISSING) missingDust++
  $("#dust-status").textContent = `no dust · ${Math.round((100 * missingDust) / Math.max(data.count, 1))} % unknown`
  const dustButton = $("#dust")
  dustButton.addEventListener("click", () => {
    dust = !dust
    stars.setDust(dust)
    dustButton.textContent = dust ? "dust on" : "dust off"
    dustButton.setAttribute("aria-pressed", String(dust))
    $("#dust-status").hidden = dust
    invalidate()
  })
  const spikeButton = $("#spikes")
  spikeButton.addEventListener("click", () => {
    spikes = !spikes
    stars.setSpikes(spikes)
    spikeButton.textContent = spikes ? "spikes on" : "spikes off"
    spikeButton.setAttribute("aria-pressed", String(spikes))
    invalidate()
  })
  const mode = $("#exposure-mode")
  mode.addEventListener("click", () => {
    automatic = !automatic
    mode.textContent = automatic ? "auto" : "fixed"
    mode.setAttribute("aria-pressed", String(automatic))
    desiredExposure = baseExposure
    invalidate()
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

  $("#home").onclick = () => {
    targetIndex = 0
    flight.to(new THREE.Vector3())
    invalidate()
  }

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
    hdr.setSize(canvas.width, canvas.height)
    rail.layout()
    invalidate()
  })

  renderer.setAnimationLoop((now: number) => {
    const seconds = Math.max(0, (now - previousTime) / 1000)
    previousTime = now
    orbit.step(seconds)
    if (flight.step(now)) invalidate()
    controls.update()
    if (isDirty) {
      const startedAt = performance.now()
      if (automatic) baseExposure = updateExposure(baseExposure, desiredExposure, seconds)
      drawnExposure = baseExposure * 2 ** exposureSelector.value()
      stars.setExposure(drawnExposure)
      renderer.setRenderTarget(hdr)
      renderer.render(scene, camera)
      if (automatic && drawNumber - lastMeterDraw >= 4) {
        desiredExposure = targetExposure(measureMean(renderer))
        lastMeterDraw = drawNumber
        needsMeter = false
      }
      drawNumber++
      if (glow.value() > 0) bloom.render(renderer)
      toneMap(renderer, drawnExposure, glow.value() / 100, sat.value())
      if (IS_BENCH) {
        // Reading one pixel waits for the GPU to finish, so the time includes the GPU's work, not only the CPU's.
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe)
        drawTimes.push(performance.now() - startedAt)
        if (drawTimes.length > BENCH_WINDOW) drawTimes.shift()
      }
      isDirty = automatic && (needsMeter || Math.abs(desiredExposure - baseExposure) > 0.01 * baseExposure)
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

function describeStar(data: StarData, hit: StarHit, dust: boolean) {
  const { kelvin, source } = displayTemperature(data, hit.index, dust)
  const extinction = extinctionOf(data, hit.index)
  const reddening = reddeningOf(data, hit.index)
  return [
    `<b>${starName(hit.index)}</b>`,
    hit.index === 0 ? "" : `<b>${formatDistance(positionOf(data, hit.index).length())}</b> from sun`,
    `M <b>${(absoluteMagnitudeOf(data, hit.index) - (dust ? 0 : (extinction ?? 0))).toFixed(1)}</b>`,
    `m <b>${hit.apparentMag.toFixed(1)}</b>`,
    `<b>${(Math.round(kelvin / 100) * 100).toLocaleString("en-US")}</b> K (${source})`,
    extinction === undefined ? "" : `A_G <b>${extinction.toFixed(2)}</b> mag`,
    reddening === undefined ? "" : `E(BP−RP) <b>${reddening.toFixed(2)}</b> mag`,
    `type <b>${spectralClassOf(kelvin)}</b>`,
  ]
    .filter(Boolean)
    .join(" · ")
}

main().catch((error) => {
  console.error(error)
  $("#error").textContent = `error: ${error instanceof Error ? error.message : error}`
})
