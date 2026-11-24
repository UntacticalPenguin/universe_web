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
import { loadHierarchy } from "./lod/hierarchy"
import { createStream } from "./lod/stream"
import { catalog, diskOutline, type Landmark } from "./view/catalog"
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

  const tree = params.has("stars") ? null : await loadHierarchy(import.meta.env.BASE_URL)
  const data = tree ? undefined : await loadStars(STAR_FILE)
  const stars = data ? createStarsLayer(data, pixelRatio) : undefined
  if (stars) scene.add(stars.points)
  const overlay = new THREE.Scene()
  const outline = diskOutline()
  overlay.add(outline)
  const outlineToggle = $("#outline")
  outlineToggle.onclick = () => {
    outline.visible = !outline.visible
    outlineToggle.setAttribute("aria-pressed", String(outline.visible))
    invalidate()
  }

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

  let targetName = "Sun"
  const targetPosition = new THREE.Vector3()
  controls.enablePan = false
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
  const indexOptions = {
    camera,
    viewport,
    magLimit: () => cutoff(magSelector.value()),
    exposure: () => drawnExposure,
    dust: () => dust,
    spikes: () => spikes,
  }
  const requestedBudget = Number(params.get("budget"))
  const budget = requestedBudget > 0 && Number.isFinite(requestedBudget) ? Math.floor(requestedBudget) : 3000000
  const stream = tree ? createStream(tree, scene, indexOptions, pixelRatio, budget, invalidate, params.get("debug") === "1") : undefined
  const screenIndex = stream ?? createScreenIndex({ ...indexOptions, data: data! })
  const buttons = new Map<string, HTMLButtonElement>()
  function select(id: string) {
    for (const [key, button] of buttons) button.setAttribute("aria-pressed", String(key === id))
  }
  function focus(object: Landmark, frame = true) {
    targetName = object.name
    targetPosition.set(...object.position)
    select(object.id)
    if (frame) flight.setDistance(object.distance)
    flight.to(targetPosition)
    invalidate()
  }
  for (const object of catalog) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = object.name
    button.onclick = () => focus(object)
    buttons.set(object.id, button)
    $("#catalog").append(button)
  }
  select("sun")
  const pointer = createPointer({
    layer: $("#cursor"),
    surface: renderer.domElement,
    pick: (x, y, range) => screenIndex.nearest(x, y, range),
    describe: (hit) => describeStar(hit.data ?? data!, hit, dust),
    onSelect: (hit) => {
      orbit.stop()
      targetName = hit.tileId ? hit.tileId + " #" + hit.index : starName(hit.index)
      select("")
      targetPosition.copy(positionOf(hit.data ?? data!, hit.index))
      flight.to(targetPosition)
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
    onInput: (m) => (stars?.setMagLimit(cutoff(m)), invalidate()),
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
  for (let i = 0; data && i < data.count; i++) if (data.extinction[i] === MISSING && data.reddening[i] === MISSING) missingDust++
  $("#dust-status").textContent = !data ? "dust correction disabled" : `no dust · ${Math.round((100 * missingDust) / Math.max(data.count, 1))} % unknown`
  const dustButton = $("#dust")
  dustButton.addEventListener("click", () => {
    dust = !dust
    stars?.setDust(dust)
    dustButton.textContent = dust ? "dust on" : "dust off"
    dustButton.setAttribute("aria-pressed", String(dust))
    $("#dust-status").hidden = dust
    invalidate()
  })
  const spikeButton = $("#spikes")
  spikeButton.addEventListener("click", () => {
    spikes = !spikes
    stars?.setSpikes(spikes)
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

  const { counts, extent } = countPerDecade(data?.positions ?? new Float32Array(), data?.count ?? 0)
  const allRoots = tree?.roots.slice() ?? []
  const available = allRoots.includes("deep/r") && allRoots.includes("deep-wide/r")
  let deeper = available && params.get("preview") === "deep"
  const hasLuminous = allRoots.includes("luminous/r")
  let luminous = hasLuminous && params.get("preview") === "luminous"
  const luminousToggle = $<HTMLButtonElement>("#luminous-toggle")
  $("#luminous-row").hidden = !hasLuminous
  let precise = params.get("quality") === "precise"
  const toggle = $<HTMLButtonElement>("#deep-toggle"),
    quality = $<HTMLButtonElement>("#quality-toggle")
  $("#deep-controls").hidden = !available
  function updateCatalog() {
    if (!tree) return
    const activeSurveys = new Set([luminous ? "luminous" : "stars", "lmc"])
    if (deeper && !luminous) {
      activeSurveys.add("deep")
      if (!precise) activeSurveys.add("deep-wide")
    }
    tree.roots = allRoots.filter((id) => activeSurveys.has(tree.nodes[id].survey))
    counts.fill(0)
    extent[0] = Infinity
    extent[1] = 0
    // In streaming mode the ruler estimates the distribution from each tile’s own payload.
    if (tree)
      for (const node of Object.values(tree.nodes)) {
        if (!activeSurveys.has(node.survey)) continue
        const r = Math.max(0.001, Math.hypot(...node.center))
        const bin = Math.floor(Math.log10(r)) + 3
        if (bin >= 0 && bin < counts.length) counts[bin] += node.count
        extent[0] = Math.min(extent[0], Math.max(0.001, r - Math.sqrt(3) * node.half))
        extent[1] = Math.max(extent[1], r + Math.sqrt(3) * node.half)
      }
    const extra = tree.roots.filter((id) => tree.nodes[id].survey.startsWith("deep")).reduce((n, id) => n + tree.nodes[id].subtreeCount, 0)
    $("#deep-count").textContent = deeper ? extra.toLocaleString("en-US") + " additional Gaia sources" : "Bright catalog"
    if (luminous) $("#deep-count").textContent = tree.nodes["luminous/r"].subtreeCount.toLocaleString("en-US") + " luminous Gaia sources"
    luminousToggle.setAttribute("aria-pressed", String(luminous))
    luminousToggle.textContent = luminous ? "On" : "Off"
    toggle.setAttribute("aria-pressed", String(deeper))
    toggle.textContent = deeper ? "On" : "Off"
    quality.disabled = !deeper
    quality.setAttribute("aria-pressed", String(deeper && precise))
    quality.textContent = deeper && precise ? "On" : "Off"
  }
  updateCatalog()
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

  function refreshCatalog() {
    updateCatalog()
    rail.layout()
    invalidate()
    const url = new URL(location.href)
    if (luminous) url.searchParams.set("preview", "luminous")
    else if (deeper) url.searchParams.set("preview", "deep")
    else url.searchParams.delete("preview")
    if (deeper && precise) url.searchParams.set("quality", "precise")
    else url.searchParams.delete("quality")
    history.replaceState(null, "", url)
  }
  luminousToggle.onclick = () => {
    luminous = !luminous
    deeper = false
    refreshCatalog()
  }
  toggle.onclick = () => {
    luminous = false
    deeper = !deeper
    refreshCatalog()
  }
  quality.onclick = () => {
    precise = !precise
    refreshCatalog()
  }
  $("#home").onclick = () => focus(catalog[0], false)
  const initial = catalog.find((object) => object.id === params.get("focus"))
  if (initial) focus(initial)
  const tileStatus = $("#tile-status")
  if (!stream) tileStatus.textContent = "Single-file catalog"
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
      stars?.setExposure(drawnExposure)
      if (stream) {
        const state = stream.update()
        tileStatus.textContent = `Octree · ${state.nodes} tiles · ${state.points.toLocaleString("en-US")} points · ${state.pending} loading`
      }
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
      renderer.autoClear = false
      renderer.render(overlay, camera)
      renderer.autoClear = true
      if (IS_BENCH) {
        // Reading one pixel waits for the GPU to finish, so the time includes the GPU's work, not only the CPU's.
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe)
        drawTimes.push(performance.now() - startedAt)
        if (drawTimes.length > BENCH_WINDOW) drawTimes.shift()
      }
      isDirty = automatic && (needsMeter || Math.abs(desiredExposure - baseExposure) > 0.01 * baseExposure)
      framesThisSecond++
      visible = undefined
      placeTargetMark(targetPosition, targetName, window.innerWidth, window.innerHeight)
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
    showTray({
      target: targetName,
      distancePc: flight.distance(),
      loaded: stream?.loaded() ?? data!.count,
      visible,
      fps,
      drawMs: IS_BENCH ? median(drawTimes) : undefined,
    })
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
  if (data.distances) {
    const row = hit.index * 20,
      info = data.distances
    const distance = (offset: number) => (info.getFloat32(row + offset, true) / 1000).toFixed(2)
    return `<b>Gaia DR3 ${info.getBigUint64(row, true)}</b> · ${distance(12)} kpc from Sun · 16–84% interval ${distance(8)}–${distance(16)} kpc`
  }
  if (hit.tileId?.startsWith("lmc/")) return `<b>OGLE-III LMC field</b> · V ≈ ${hit.apparentMag.toFixed(1)} from camera · adopted distance 49.59 kpc`
  const { kelvin, source } = displayTemperature(data, hit.index, dust)
  const extinction = extinctionOf(data, hit.index)
  const reddening = reddeningOf(data, hit.index)
  return [
    `<b>${hit.tileId ? hit.tileId + " #" + hit.index : starName(hit.index)}</b>`,
    !hit.tileId && hit.index === 0 ? "" : `<b>${formatDistance(positionOf(data, hit.index).length())}</b> from sun`,
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
