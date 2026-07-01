/**
 * Dual-deck (horizontal) layout drawing analysis.
 * Bays run left → right; top and bottom decks may stack components in the same bay.
 * Stacked components share one bay length; weights are merged downstream.
 */

import type { LayoutComponentType, LayoutSegment } from "./layoutSymbols"

export type LayoutOrientation = "vertical" | "horizontal"

interface OCRWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

interface StripMetrics {
  blue: number
  red: number
  green: number
  dark: number
  light: number
  total: number
}

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Failed to load layout image"))
    }
    img.src = url
  })
}

function parseSegmentDimension(text: string): number | null {
  const n = parseFloat(text.replace(/[^\d.]/g, ""))
  if (isNaN(n) || n < 2 || n > 35) return null
  return n
}

function analyzeRegion(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): StripMetrics {
  const w = Math.max(1, Math.floor(x1 - x0))
  const h = Math.max(1, Math.floor(y1 - y0))
  const data = ctx.getImageData(Math.floor(x0), Math.floor(y0), w, h).data

  const metrics: StripMetrics = { blue: 0, red: 0, green: 0, dark: 0, light: 0, total: 0 }

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    metrics.total++

    if (r > 180 && g > 180 && b > 180) metrics.light++
    else if (r < 60 && g < 60 && b < 60) metrics.dark++
    else {
      if (b > r + 30 && b > g + 20) metrics.blue++
      if (r > g + 25 && r > b + 25) metrics.red++
      if (g > r + 15 && g > b + 10) metrics.green++
    }
  }

  return metrics
}

function classifyRegion(metrics: StripMetrics): LayoutComponentType {
  if (metrics.total === 0) return "unknown"

  const blueRatio = metrics.blue / metrics.total
  const redRatio = metrics.red / metrics.total
  const greenRatio = metrics.green / metrics.total
  const lightRatio = metrics.light / metrics.total
  const darkRatio = metrics.dark / metrics.total

  if (blueRatio > 0.06 && metrics.blue > metrics.red) return "fan"
  if (greenRatio > 0.08) return "heat_recovery"
  if (greenRatio > 0.04) return "filter"

  if (redRatio > 0.015) {
    if (redRatio > 0.04 || (redRatio > 0.025 && lightRatio < 0.7)) return "electric_heat"
    return "coil"
  }

  if (darkRatio > 0.025 && lightRatio < 0.82) return "control_box"
  if (lightRatio > 0.88) return "inspection"

  return "unknown"
}

/** Decide vertical (single-deck) vs horizontal (dual-deck) layout from OCR word positions. */
export function detectLayoutOrientation(
  words: OCRWord[],
  imageWidth: number,
  imageHeight: number
): LayoutOrientation {
  let rightSideCount = 0
  let horizontalEdgeCount = 0
  let dimensionWordCount = 0

  for (const word of words) {
    const val = parseSegmentDimension(word.text)
    if (val === null) continue
    dimensionWordCount++

    const x = (word.bbox.x0 + word.bbox.x1) / 2
    const y = (word.bbox.y0 + word.bbox.y1) / 2

    if (x > imageWidth * 0.42) rightSideCount++
    if (y > imageHeight * 0.62 || y < imageHeight * 0.38) horizontalEdgeCount++
  }

  if (dimensionWordCount < 3) return "vertical"
  return horizontalEdgeCount > rightSideCount ? "horizontal" : "vertical"
}

interface HorizontalDimension {
  val: number
  x: number
  y: number
}

/** Segment lengths left → right from bottom (or top) dimension row. */
export function extractDimensionsHorizontalOrder(
  words: OCRWord[],
  imageWidth: number,
  imageHeight: number,
  excludeValues: Set<number>
): HorizontalDimension[] {
  const candidates: HorizontalDimension[] = []

  for (const word of words) {
    const val = parseSegmentDimension(word.text)
    if (val === null) continue
    if (excludeValues.has(val)) continue

    const x = (word.bbox.x0 + word.bbox.x1) / 2
    const y = (word.bbox.y0 + word.bbox.y1) / 2

    // Dimension labels sit along top or bottom edge of the unit drawing
    const onBottom = y > imageHeight * 0.62
    const onTop = y < imageHeight * 0.38
    if (!onBottom && !onTop) continue

    candidates.push({ val, x, y })
  }

  const bottomRow = candidates.filter((c) => c.y > imageHeight * 0.62)
  const topRow = candidates.filter((c) => c.y < imageHeight * 0.38)
  const row =
    bottomRow.length >= topRow.length && bottomRow.length >= 3
      ? bottomRow
      : topRow.length >= 3
        ? topRow
        : candidates

  row.sort((a, b) => a.x - b.x)

  const ordered: HorizontalDimension[] = []
  let lastX = -999
  for (const c of row) {
    if (ordered.length > 0 && Math.abs(c.x - lastX) < imageWidth * 0.04) continue
    ordered.push(c)
    lastX = c.x
  }

  return ordered
}

interface BayTypes {
  top: LayoutComponentType
  bottom: LayoutComponentType
}

async function detectDualDeckBayTypes(
  imageFile: File | Blob,
  bayCenters: number[],
  imageWidth: number,
  imageHeight: number
): Promise<BayTypes[]> {
  if (bayCenters.length === 0) return []

  const img = await loadImage(imageFile)
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return []

  ctx.drawImage(img, 0, 0)

  const topY0 = imageHeight * 0.12
  const topY1 = imageHeight * 0.46
  const bottomY0 = imageHeight * 0.48
  const bottomY1 = imageHeight * 0.78

  const types: BayTypes[] = []

  for (let i = 0; i < bayCenters.length; i++) {
    const xCenter = bayCenters[i]
    const x0 =
      i === 0
        ? imageWidth * 0.06
        : (bayCenters[i - 1] + xCenter) / 2
    const x1 =
      i === bayCenters.length - 1
        ? imageWidth * 0.94
        : (xCenter + bayCenters[i + 1]) / 2

    const topMetrics = analyzeRegion(ctx, x0, topY0, x1, topY1)
    const bottomMetrics = analyzeRegion(ctx, x0, bottomY0, x1, bottomY1)

    types.push({
      top: classifyRegion(topMetrics),
      bottom: classifyRegion(bottomMetrics),
    })
  }

  return types
}

function pickPrimaryType(top: LayoutComponentType, bottom: LayoutComponentType): LayoutComponentType {
  if (bottom !== "unknown") return bottom
  if (top !== "unknown") return top
  return "unknown"
}

function isStackedBay(top: LayoutComponentType, bottom: LayoutComponentType): boolean {
  if (top === "unknown" || bottom === "unknown") return false
  return top !== bottom
}

/**
 * Build layout segments for a dual-deck horizontal drawing.
 */
export async function analyzeDualDeckLayout(
  imageFile: File | Blob,
  words: OCRWord[],
  excludeValues: Set<number>
): Promise<LayoutSegment[]> {
  const img = await loadImage(imageFile)
  const dims = extractDimensionsHorizontalOrder(words, img.width, img.height, excludeValues)

  if (dims.length === 0) return []

  const lengthsIn = dims.map((d) => d.val)
  const bayCenters = dims.map((d) => d.x)

  let bayTypes: BayTypes[] = []
  try {
    bayTypes = await detectDualDeckBayTypes(imageFile, bayCenters, img.width, img.height)
  } catch {
    bayTypes = []
  }

  while (bayTypes.length < lengthsIn.length) {
    bayTypes.push({ top: "unknown", bottom: "unknown" })
  }

  return lengthsIn.map((lengthIn, i) => {
    const top = bayTypes[i]?.top ?? "unknown"
    const bottom = bayTypes[i]?.bottom ?? "unknown"
    const stacked = isStackedBay(top, bottom)

    return {
      lengthIn,
      type: pickPrimaryType(top, bottom),
      stackedTypes: stacked ? [top, bottom] : bottom !== "unknown" ? [bottom] : top !== "unknown" ? [top] : undefined,
      isStackedBay: stacked,
      typeConfidence: stacked ? 0.75 : top !== "unknown" || bottom !== "unknown" ? 0.65 : 0.3,
    }
  })
}
