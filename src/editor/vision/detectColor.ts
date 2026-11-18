export interface ColorDetection {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  area: number
}

/** Find the largest connected foreground region whose pixels match the target colour. */
export function detectColor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  target: readonly [number, number, number],
  tolerance: number,
  minArea: number,
): ColorDetection | null {
  if (rgba.length !== width * height * 4 || width <= 0 || height <= 0) return null
  const count = width * height
  const candidates = new Uint8Array(count)
  const distanceLimit = tolerance * tolerance
  for (let i = 0; i < count; i++) {
    const offset = i * 4
    const dr = rgba[offset]! - target[0]
    const dg = rgba[offset + 1]! - target[1]
    const db = rgba[offset + 2]! - target[2]
    if (rgba[offset + 3]! > 0 && dr * dr + dg * dg + db * db <= distanceLimit) candidates[i] = 1
  }

  const queue = new Int32Array(count)
  let best: ColorDetection | null = null
  for (let seed = 0; seed < count; seed++) {
    if (!candidates[seed]) continue
    let end = 0
    const enqueue = (i: number) => {
      if (!candidates[i]) return
      candidates[i] = 0
      queue[end++] = i
    }
    enqueue(seed)
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    let sumX = 0
    let sumY = 0
    for (let read = 0; read < end; read++) {
      const i = queue[read]!
      const x = i % width
      const y = Math.floor(i / width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      sumX += x
      sumY += y
      if (x > 0) enqueue(i - 1)
      if (x + 1 < width) enqueue(i + 1)
      if (y > 0) enqueue(i - width)
      if (y + 1 < height) enqueue(i + width)
    }
    if (end >= minArea && (!best || end > best.area)) {
      best = {
        x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1,
        centerX: sumX / end, centerY: sumY / end, area: end,
      }
    }
  }
  return best
}
