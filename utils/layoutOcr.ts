/**
 * Parse layout/dimension drawings to extract section lengths and component positions.
 * All internal dimensions stored in inches; convert to mm via lengthUnits.
 */

import { extractTextFromImage, preprocessImageForOCR } from "./ocr"
import {
  INCH_TO_MM,
  extractDimensionValuesInches,
  parseLengthFromText,
  parseLengthFromValue,
} from "./lengthUnits"
import type { LayoutSegment } from "./layoutSymbols"
import { analyzeLayoutDrawing } from "./layoutIconDetection"

export { INCH_TO_MM }

export interface ParsedLayout {
  /** All lengths stored in inches internally */
  baseframeLengthIn: number
  baseframeLengthMm: number
  casingSectionLengthsIn: number[]
  /** Ordered segment lengths (excludes hood/end cap when detected) */
  componentSegmentLengthsIn: number[]
  /** Segments with icon-mapped component types */
  componentSegments: LayoutSegment[]
  weatherHoodLengthIn: number
  frameWidthIn: number | null
  /** Detected source unit from drawing */
  sourceUnit: "in" | "mm"
}

function findBaseframeLength(valuesIn: number[]): number {
  const candidates = valuesIn.filter((v) => v >= 50 && v <= 400)
  return candidates.length > 0 ? Math.max(...candidates) : 0
}

function findCasingSectionLengths(valuesIn: number[], baseframeLength: number): number[] {
  const tolerance = 2
  for (let i = 0; i < valuesIn.length; i++) {
    for (let j = i + 1; j < valuesIn.length; j++) {
      const sum = valuesIn[i] + valuesIn[j]
      if (Math.abs(sum - baseframeLength) < tolerance) {
        return [Math.max(valuesIn[i], valuesIn[j]), Math.min(valuesIn[i], valuesIn[j])]
      }
    }
  }

  const under = valuesIn.filter((v) => v < baseframeLength && v > 20).sort((a, b) => b - a)
  if (under.length >= 2) return [under[0], under[1]]
  return []
}

function findComponentSegments(valuesIn: number[], casingLengths: number[]): number[] {
  const casingTotal = casingLengths.reduce((a, b) => a + b, 0)
  const exclude = new Set([...casingLengths, casingTotal, 44.6, 31.6, 22.9, 8.6])
  // Preserve appearance order — repeated values (e.g. 7.9) are distinct segments
  return valuesIn.filter((v) => v >= 2 && v <= 35 && !exclude.has(v))
}

function findWeatherHoodLength(valuesIn: number[]): number {
  return valuesIn.find((v) => v >= 15 && v <= 22) || 0
}

/**
 * Parse layout drawing OCR text into structured dimensions.
 */
export function parseLayoutText(ocrText: string): ParsedLayout {
  const valuesIn = extractDimensionValuesInches(ocrText)

  // Also try labeled lengths (e.g. "Baseframe Length 152.8 in")
  const labeledLengths: number[] = []
  const labelRe = /(?:Casing|Baseframe)\s+Length\s+(\d+(?:\.\d+)?)\s*(in|mm)?/gi
  let lm
  while ((lm = labelRe.exec(ocrText)) !== null) {
    const parsed = parseLengthFromText(lm[0])
    if (parsed) labeledLengths.push(parsed.inches)
  }

  const allValues = [...new Set([...valuesIn, ...labeledLengths])].sort((a, b) => b - a)

  const baseframeLengthIn = findBaseframeLength(allValues)
  const casingSectionLengthsIn = findCasingSectionLengths(allValues, baseframeLengthIn)
  const componentSegmentLengthsIn = findComponentSegments(allValues, casingSectionLengthsIn)
  const weatherHoodLengthIn = findWeatherHoodLength(allValues)
  const frameWidthIn = allValues.find((v) => v >= 30 && v <= 60) || null

  const lower = ocrText.toLowerCase()
  const sourceUnit: "in" | "mm" =
    (lower.match(/\bmm\b/g) || []).length > (lower.match(/\bin\b/g) || []).length ? "mm" : "in"

  return {
    baseframeLengthIn,
    baseframeLengthMm: baseframeLengthIn * INCH_TO_MM,
    casingSectionLengthsIn,
    componentSegmentLengthsIn,
    componentSegments: componentSegmentLengthsIn.map((lengthIn) => ({
      lengthIn,
      type: "unknown" as const,
    })),
    weatherHoodLengthIn,
    frameWidthIn,
    sourceUnit,
  }
}

/**
 * OCR a layout drawing image and extract dimensions.
 */
export async function processLayoutImage(
  imageFile: File,
  onProgress?: (progress: number) => void
): Promise<ParsedLayout> {
  const preprocessed = await preprocessImageForOCR(imageFile)
  const { text, words } = await extractTextFromImage(preprocessed, onProgress)
  const base = parseLayoutText(text)

  const exclude = new Set([
    base.baseframeLengthIn,
    ...base.casingSectionLengthsIn,
    base.casingSectionLengthsIn.reduce((a, b) => a + b, 0),
    base.frameWidthIn ?? 0,
    44.6,
    31.6,
    22.9,
    8.6,
  ])

  const componentSegments = await analyzeLayoutDrawing(
    preprocessed,
    text,
    words,
    exclude,
    base.weatherHoodLengthIn,
    2.0
  )

  return {
    ...base,
    componentSegments,
    componentSegmentLengthsIn: componentSegments.map((s) => s.lengthIn),
  }
}

/** Convert inches to mm for app storage */
export function inchesToMm(inches: number): number {
  return inches * INCH_TO_MM
}

/** Parse any length string/value → mm for the app */
export function lengthToMm(textOrValue: string | number, context = ""): number {
  if (typeof textOrValue === "number") {
    return parseLengthFromValue(textOrValue, context).millimeters
  }
  const parsed = parseLengthFromText(textOrValue)
  return parsed?.millimeters ?? 0
}
