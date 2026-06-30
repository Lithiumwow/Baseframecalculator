/**
 * Parse layout/dimension drawings to extract section lengths and component positions.
 */

import { extractTextFromImage, preprocessImageForOCR } from "./ocr"

const INCH_TO_MM = 25.4

export interface ParsedLayout {
  baseframeLengthIn: number
  baseframeLengthMm: number
  casingSectionLengthsIn: number[]
  componentSegmentLengthsIn: number[]
  weatherHoodLengthIn: number
  frameWidthIn: number | null
}

function extractInchValues(text: string): number[] {
  const values: number[] = []
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|''|”|″)/gi,
    /(\d+(?:\.\d+)?)\s+(?:in\b)/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const val = parseFloat(match[1])
      if (val > 0 && val < 500) values.push(val)
    }
  }

  // Also catch standalone dimension numbers common in drawings (e.g. "152.8" near labels)
  const dimPattern = /\b(\d{1,3}\.\d)\b/g
  let m
  while ((m = dimPattern.exec(text)) !== null) {
    const val = parseFloat(m[1])
    if (val >= 2 && val <= 400) values.push(val)
  }

  return [...new Set(values)].sort((a, b) => b - a)
}

function findBaseframeLength(values: number[]): number {
  // Baseframe length is typically the largest dimension (~150-400 in)
  const candidates = values.filter((v) => v >= 50 && v <= 400)
  return candidates.length > 0 ? Math.max(...candidates) : 0
}

function findCasingSectionLengths(values: number[], baseframeLength: number): number[] {
  // Two casing sections that sum to baseframe length
  const tolerance = 2
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const sum = values[i] + values[j]
      if (Math.abs(sum - baseframeLength) < tolerance) {
        return [Math.max(values[i], values[j]), Math.min(values[i], values[j])]
      }
    }
  }

  // Fallback: two largest values under baseframe
  const under = values.filter((v) => v < baseframeLength && v > 20).sort((a, b) => b - a)
  if (under.length >= 2) return [under[0], under[1]]
  return []
}

function findComponentSegments(values: number[], casingLengths: number[]): number[] {
  const casingTotal = casingLengths.reduce((a, b) => a + b, 0)
  // Component segments are smaller dimensions (2–35 in), excluding casing/baseframe totals
  const exclude = new Set([...casingLengths, casingTotal])
  return values
    .filter((v) => v >= 2 && v <= 35 && !exclude.has(v))
    .sort((a, b) => a - b)
}

function findWeatherHoodLength(values: number[]): number {
  // Weather hood typically 15–20 in
  const hood = values.find((v) => v >= 15 && v <= 22 && Math.abs(v - 17.9) < 3)
  return hood || values.find((v) => v >= 15 && v <= 22) || 0
}

/**
 * Parse layout drawing OCR text into structured dimensions.
 */
export function parseLayoutText(ocrText: string): ParsedLayout {
  const values = extractInchValues(ocrText)
  const baseframeLengthIn = findBaseframeLength(values)
  const casingSectionLengthsIn = findCasingSectionLengths(values, baseframeLengthIn)
  const componentSegmentLengthsIn = findComponentSegments(values, casingSectionLengthsIn)
  const weatherHoodLengthIn = findWeatherHoodLength(values)
  const frameWidthIn = values.find((v) => v >= 30 && v <= 60) || null

  return {
    baseframeLengthIn,
    baseframeLengthMm: baseframeLengthIn * INCH_TO_MM,
    casingSectionLengthsIn,
    componentSegmentLengthsIn,
    weatherHoodLengthIn,
    frameWidthIn,
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
  const { text } = await extractTextFromImage(preprocessed, onProgress)
  return parseLayoutText(text)
}

export { INCH_TO_MM }
