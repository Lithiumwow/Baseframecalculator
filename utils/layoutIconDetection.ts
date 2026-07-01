/**
 * Detect Systemair layout component symbols from cross-section drawing images.
 * Uses color/pattern heuristics on vertical strips between dimension labels.
 */

import type { LayoutComponentType, LayoutSegment } from "./layoutSymbols"
import { STANDARD_LAYOUT_SEGMENTS_IN } from "./layoutSegmentDefaults"
import {
  detectLayoutOrientation,
  analyzeDualDeckLayout,
  type LayoutOrientation,
} from "./dualDeckLayout"

export type { LayoutOrientation }

interface OCRWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
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

function parseDimension(text: string): number | null {
  const n = parseFloat(text.replace(/[^\d.]/g, ""))
  if (isNaN(n) || n < 2 || n > 35) return null
  return n
}

/** Extract segment lengths in top-to-bottom order from OCR word positions (right-side view). */
export function extractDimensionsInSpatialOrder(
  words: OCRWord[],
  imageWidth: number,
  excludeValues: Set<number>
): number[] {
  const candidates: Array<{ val: number; y: number }> = []

  for (const word of words) {
    const val = parseDimension(word.text)
    if (val === null) continue
    if (excludeValues.has(val)) continue

    const xCenter = (word.bbox.x0 + word.bbox.x1) / 2
    // Cross-section dimensions sit on the right half of the drawing
    if (xCenter < imageWidth * 0.42) continue

    const y = (word.bbox.y0 + word.bbox.y1) / 2
    candidates.push({ val, y })
  }

  candidates.sort((a, b) => a.y - b.y)

  const ordered: number[] = []
  let lastY = -999
  for (const c of candidates) {
    if (ordered.length > 0 && Math.abs(c.y - lastY) < 6) continue
    ordered.push(c.val)
    lastY = c.y
  }

  return ordered
}

/** Fallback: preserve order of segment-sized numbers in OCR text. */
export function extractDimensionsFromTextInOrder(
  text: string,
  excludeValues: Set<number>
): number[] {
  const ordered: number[] = []
  const re = /\b(\d+(?:\.\d+)?)\b/g
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    const val = parseFloat(match[1])
    if (isNaN(val) || val < 2 || val > 35) continue
    if (excludeValues.has(val)) continue
    ordered.push(val)
  }

  return ordered
}

interface StripMetrics {
  blue: number
  red: number
  green: number
  dark: number
  light: number
  total: number
}

function analyzeStrip(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): StripMetrics {
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

function classifyStrip(metrics: StripMetrics): LayoutComponentType {
  if (metrics.total === 0) return "unknown"

  const blueRatio = metrics.blue / metrics.total
  const redRatio = metrics.red / metrics.total
  const greenRatio = metrics.green / metrics.total
  const lightRatio = metrics.light / metrics.total
  const darkRatio = metrics.dark / metrics.total

  // Fan: prominent blue motor/fan icon
  if (blueRatio > 0.06 && metrics.blue > metrics.red) return "fan"

  // Filter bay: green hatch in some drawings
  if (greenRatio > 0.08) return "heat_recovery"
  if (greenRatio > 0.04) return "filter"

  if (redRatio > 0.015) {
    // Electric heat: dense red (lightning bolt)
    if (redRatio > 0.04 || (redRatio > 0.025 && lightRatio < 0.7)) return "electric_heat"
    return "coil"
  }

  // Control box: dark schematic lines, not mostly empty
  if (darkRatio > 0.025 && lightRatio < 0.82) return "control_box"

  // Empty / inspection section
  if (lightRatio > 0.88) return "inspection"

  return "unknown"
}

/**
 * Detect component type for each segment strip between dimension labels.
 */
export async function detectSegmentTypesFromImage(
  imageFile: File | Blob,
  dimensionYs: number[],
  imageHeight: number
): Promise<LayoutComponentType[]> {
  if (dimensionYs.length < 2) return []

  const img = await loadImage(imageFile)
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return []

  ctx.drawImage(img, 0, 0)

  // Symbol area: center-right band of the cross-section view
  const x0 = img.width * 0.52
  const x1 = img.width * 0.78

  const sortedYs = [...dimensionYs].sort((a, b) => a - b)
  const types: LayoutComponentType[] = []

  for (let i = 0; i < sortedYs.length - 1; i++) {
    const yTop = sortedYs[i] + 4
    const yBottom = sortedYs[i + 1] - 4
    if (yBottom <= yTop) {
      types.push("unknown")
      continue
    }
    const metrics = analyzeStrip(ctx, x0, yTop, x1, yBottom)
    types.push(classifyStrip(metrics))
  }

  return types
}

/** Build typed layout segments from lengths; apply known pattern when types missing. */
export function buildLayoutSegments(
  lengthsIn: number[],
  types: LayoutComponentType[],
  weatherHoodIn: number,
  endCapIn: number
): LayoutSegment[] {
  let startIdx = 0
  let endIdx = lengthsIn.length

  if (weatherHoodIn > 0 && lengthsIn[0] !== undefined && Math.abs(lengthsIn[0] - weatherHoodIn) < 0.5) {
    startIdx = 1
  }
  if (endCapIn > 0 && lengthsIn[endIdx - 1] !== undefined && Math.abs(lengthsIn[endIdx - 1] - endCapIn) < 0.5) {
    endIdx -= 1
  }

  const core = lengthsIn.slice(startIdx, endIdx)
  const coreTypes = types.slice(startIdx, endIdx)

  // Known Systemair example fallback (Geniox layout from user drawings)
  const exampleTypes: LayoutComponentType[] = [
    "filter",
    "coil",
    "coil",
    "electric_heat",
    "coil",
    "inspection",
    "coil",
    "special",
    "control_box",
    "fan",
  ]

  return core.map((lengthIn, i) => ({
    lengthIn,
    type: coreTypes[i] && coreTypes[i] !== "unknown" ? coreTypes[i] : exampleTypes[i] || "unknown",
    typeConfidence: coreTypes[i] !== "unknown" ? 0.7 : 0.3,
  }))
}

/**
 * Full pipeline: ordered dimensions + icon types from layout image + OCR words.
 */
export async function analyzeLayoutDrawing(
  imageFile: File | Blob,
  ocrText: string,
  words: OCRWord[],
  excludeValues: Set<number>,
  weatherHoodIn: number,
  endCapIn: number
): Promise<{ segments: LayoutSegment[]; orientation: LayoutOrientation }> {
  const img = await loadImage(imageFile)
  const orientation = detectLayoutOrientation(words, img.width, img.height)

  if (orientation === "horizontal") {
    const dualSegments = await analyzeDualDeckLayout(imageFile, words, excludeValues)
    if (dualSegments.length > 0) {
      return { segments: dualSegments, orientation }
    }
  }

  let lengthsIn = extractDimensionsInSpatialOrder(words, img.width, excludeValues)
  if (lengthsIn.length < 4) {
    lengthsIn = extractDimensionsFromTextInOrder(ocrText, excludeValues)
  }
  if (orientation !== "horizontal" && lengthsIn.length < STANDARD_LAYOUT_SEGMENTS_IN.length - 2) {
    lengthsIn = [...STANDARD_LAYOUT_SEGMENTS_IN]
  }

  const dimensionWords = words.filter((w) => {
    const val = parseDimension(w.text)
    return val !== null && !excludeValues.has(val) && (w.bbox.x0 + w.bbox.x1) / 2 >= img.width * 0.42
  })
  const dimensionYs = dimensionWords.map((w) => (w.bbox.y0 + w.bbox.y1) / 2)

  let types: LayoutComponentType[] = []
  try {
    types = await detectSegmentTypesFromImage(imageFile, dimensionYs, img.height)
  } catch {
    types = []
  }

  while (types.length < lengthsIn.length) types.push("unknown")

  return {
    segments: buildLayoutSegments(lengthsIn, types, weatherHoodIn, endCapIn),
    orientation: "vertical",
  }
}
