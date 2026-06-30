/**
 * Length unit detection and conversion.
 * Drawings and weight tables default to inches; mm is detected when explicit or by heuristic.
 */

export const INCH_TO_MM = 25.4
export const MM_TO_INCH = 1 / INCH_TO_MM

export type LengthUnit = "in" | "mm"

/** Values above this (whole numbers) are treated as mm unless "in" is explicit. */
const MM_HEURISTIC_THRESHOLD = 400

export function inferLengthUnit(value: number, contextText = ""): LengthUnit {
  const lower = contextText.toLowerCase()
  if (/\bmm\b/.test(lower) || lower.includes("(mm)")) return "mm"
  if (/\bin\b/.test(lower) || lower.includes("inch")) return "in"

  // Large whole numbers are mm in engineering tables (e.g. 1641 mm, 2740 mm)
  if (value >= MM_HEURISTIC_THRESHOLD && Math.abs(value - Math.round(value)) < 0.01) {
    return "mm"
  }

  // Default per project convention: drawings use inches
  return "in"
}

export function toInches(value: number, unit: LengthUnit): number {
  if (value <= 0) return 0
  return unit === "mm" ? value * MM_TO_INCH : value
}

export function toMillimeters(value: number, unit: LengthUnit): number {
  if (value <= 0) return 0
  return unit === "in" ? value * INCH_TO_MM : value
}

export interface ParsedLength {
  raw: number
  unit: LengthUnit
  inches: number
  millimeters: number
}

/**
 * Parse a length from text like "107.9 in", "1641 mm", or bare "152.8" (defaults to inches).
 */
export function parseLengthFromText(text: string): ParsedLength | null {
  if (!text?.trim()) return null

  const normalized = text.replace(/[""''`″]/g, "").trim()

  // Explicit unit: "107.9 in" or "1641 mm"
  const explicitRe = /(\d+(?:\.\d+)?)\s*(mm|in(?:ch(?:es)?)?)\b/i
  const explicitMatch = normalized.match(explicitRe)
  if (explicitMatch) {
    const raw = parseFloat(explicitMatch[1])
    const unit: LengthUnit = explicitMatch[2].toLowerCase().startsWith("mm") ? "mm" : "in"
    return { raw, unit, inches: toInches(raw, unit), millimeters: toMillimeters(raw, unit) }
  }

  // Number after Length / Casing / Baseframe label without unit suffix
  const contextRe =
    /(?:Casing|Baseframe|Length|length)\s*(?:\(.*?\))?\s*(\d+(?:\.\d+)?)/i
  const contextMatch = normalized.match(contextRe)
  if (contextMatch) {
    const raw = parseFloat(contextMatch[1])
    const unit = inferLengthUnit(raw, normalized)
    return { raw, unit, inches: toInches(raw, unit), millimeters: toMillimeters(raw, unit) }
  }

  // Bare decimal dimension (common on inch drawings: 152.8, 107.9)
  const bareDecimal = normalized.match(/\b(\d{1,3}\.\d{1,2})\b/)
  if (bareDecimal) {
    const raw = parseFloat(bareDecimal[1])
    const unit = inferLengthUnit(raw, normalized)
    return { raw, unit, inches: toInches(raw, unit), millimeters: toMillimeters(raw, unit) }
  }

  return null
}

/**
 * Parse length from a numeric value when unit is unknown (OCR fallback).
 */
export function parseLengthFromValue(value: number, contextText = ""): ParsedLength {
  const unit = inferLengthUnit(value, contextText)
  return {
    raw: value,
    unit,
    inches: toInches(value, unit),
    millimeters: toMillimeters(value, unit),
  }
}

/**
 * Extract all dimension values from OCR text, normalized to inches.
 */
export function extractDimensionValuesInches(ocrText: string): number[] {
  const inches: number[] = []

  // Explicit inches
  const inRe = /(\d+(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?|''|″)\b/gi
  let m
  while ((m = inRe.exec(ocrText)) !== null) {
    const val = parseFloat(m[1])
    if (val > 0 && val < 500) inches.push(val)
  }

  // Explicit mm → convert to inches
  const mmRe = /(\d+(?:\.\d+)?)\s*mm\b/gi
  while ((m = mmRe.exec(ocrText)) !== null) {
    const val = parseFloat(m[1])
    if (val > 0 && val < 20000) inches.push(toInches(val, "mm"))
  }

  // Bare decimals on inch drawings (152.8, 107.9, 7.9)
  const decRe = /\b(\d{1,3}\.\d{1,2})\b/g
  while ((m = decRe.exec(ocrText)) !== null) {
    const val = parseFloat(m[1])
    if (val >= 2 && val <= 400) inches.push(val)
  }

  return [...new Set(inches.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => b - a)
}

/**
 * Detect dominant length unit used in a document.
 */
export function detectDocumentLengthUnit(text: string): LengthUnit {
  const lower = text.toLowerCase()
  const mmCount = (lower.match(/\bmm\b/g) || []).length
  const inCount = (lower.match(/\bin\b/g) || []).length + (lower.match(/inch/g) || []).length
  if (mmCount > inCount && mmCount > 0) return "mm"
  if (inCount > 0) return "in"
  return "in" // default
}
