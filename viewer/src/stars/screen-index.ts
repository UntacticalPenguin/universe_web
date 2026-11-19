import type * as THREE from "three"
import { M_RANGE, type StarData } from "./load-stars.ts"
import { pointSizeOf } from "./stars-layer.ts"

/** Screen-space buckets for picking; a hit is searched in the bucket under the hand and its eight neighbours. */
const CELL_PX = 32

export type StarHit = { index: number; x: number; y: number; sizePx: number; apparentMag: number }

type ScreenIndexOptions = {
  data: StarData
  camera: THREE.PerspectiveCamera
  viewport: () => { width: number; height: number }
  magLimit: () => number
  exposure: () => number
}

type Projection = { x: Float32Array; y: Float32Array; magnitude: Float32Array; star: Uint32Array; count: number }

/**
 * Where each star bright enough to draw lands on screen, rebuilt once the camera settles rather than every frame.
 * Picking then costs a lookup in nine buckets instead of a pass over every star.
 */
export function createScreenIndex({ data, camera, viewport, magLimit, exposure }: ScreenIndexOptions) {
  let projection: Projection | undefined
  let columns = 0
  let rows = 0
  let cellStart = new Uint32Array(0)
  let cellSlots = new Uint32Array(0)

  function rebuild() {
    const { width, height } = viewport()
    projection = projectStars(data, camera, width, height, magLimit())
    columns = Math.ceil(width / CELL_PX)
    rows = Math.ceil(height / CELL_PX)
    ;({ cellStart, cellSlots } = bucket(projection, columns, rows))
    return projection.count
  }

  function nearest(x: number, y: number, rangePx: number): StarHit | undefined {
    if (!projection) return undefined
    const column = Math.floor(x / CELL_PX)
    const row = Math.floor(y / CELL_PX)
    let best: StarHit | undefined
    let bestScore = Infinity
    for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++) {
      for (let c = Math.max(0, column - 1); c <= Math.min(columns - 1, column + 1); c++) {
        const cell = r * columns + c
        for (let k = cellStart[cell]; k < cellStart[cell + 1]; k++) {
          const slot = cellSlots[k]
          const distance = Math.hypot(projection.x[slot] - x, projection.y[slot] - y)
          if (distance > rangePx) continue
          const sizePx = pointSizeOf(projection.magnitude[slot], exposure())
          const score = distance - sizePx
          if (score >= bestScore) continue
          bestScore = score
          best = { index: projection.star[slot], x: projection.x[slot], y: projection.y[slot], sizePx, apparentMag: projection.magnitude[slot] }
        }
      }
    }
    return best
  }

  return {
    rebuild,
    clear: () => (projection = undefined),
    nearest,
    isReady: () => projection !== undefined,
  }
}

function projectStars(data: StarData, camera: THREE.PerspectiveCamera, width: number, height: number, magLimit: number): Projection {
  camera.updateMatrixWorld()
  const v = camera.matrixWorldInverse.elements
  const p = camera.projectionMatrix.elements
  const [mLo, mHi] = M_RANGE
  const x = new Float32Array(data.count)
  const y = new Float32Array(data.count)
  const magnitude = new Float32Array(data.count)
  const star = new Uint32Array(data.count)
  let count = 0

  for (let i = 0; i < data.count; i++) {
    const wx = data.positions[3 * i]
    const wy = data.positions[3 * i + 1]
    const wz = data.positions[3 * i + 2]
    const vx = v[0] * wx + v[4] * wy + v[8] * wz + v[12]
    const vy = v[1] * wx + v[5] * wy + v[9] * wz + v[13]
    const vz = v[2] * wx + v[6] * wy + v[10] * wz + v[14]
    if (vz >= 0) continue
    const m = mLo + (data.absMag[i] / 255) * (mHi - mLo) + 5 * Math.log10(Math.max(Math.hypot(vx, vy, vz), 1e-6) / 10)
    if (m > magLimit) continue
    const w = p[3] * vx + p[7] * vy + p[11] * vz + p[15]
    const sx = ((p[0] * vx + p[4] * vy + p[8] * vz + p[12]) / w + 1) * 0.5 * width
    const sy = (1 - (p[1] * vx + p[5] * vy + p[9] * vz + p[13]) / w) * 0.5 * height
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue
    x[count] = sx
    y[count] = sy
    magnitude[count] = m
    star[count] = i
    count++
  }
  return { x, y, magnitude, star, count }
}

/** Counting sort of projected stars into grid cells: cell `c` owns `cellSlots[cellStart[c] .. cellStart[c + 1]]`. */
function bucket(projection: Projection, columns: number, rows: number) {
  const cellOf = new Uint32Array(projection.count)
  const cellStart = new Uint32Array(columns * rows + 1)
  for (let i = 0; i < projection.count; i++) {
    const cell = Math.floor(projection.y[i] / CELL_PX) * columns + Math.floor(projection.x[i] / CELL_PX)
    cellOf[i] = cell
    cellStart[cell + 1]++
  }
  for (let c = 0; c < columns * rows; c++) cellStart[c + 1] += cellStart[c]
  const next = cellStart.slice(0, -1)
  const cellSlots = new Uint32Array(projection.count)
  for (let i = 0; i < projection.count; i++) cellSlots[next[cellOf[i]]++] = i
  return { cellStart, cellSlots }
}
