/**
 * Default component bay lengths (inches) from Systemair layout drawings.
 * Used when OCR cannot read individual segment dimensions from sheet 1.
 */

import type { LayoutSegment } from "./layoutSymbols"
import type { WeightComponentKind } from "./layoutSymbols"

/** Standard Geniox layout segment sequence (top → bottom along unit length). */
export const STANDARD_LAYOUT_SEGMENTS_IN: number[] = [
  7.9, 7.9, 7.9, 19.7, 11.8, 31.5, 11.8, 7.9, 15.7, 27.6,
]

export function standardLayoutSegments(): LayoutSegment[] {
  return STANDARD_LAYOUT_SEGMENTS_IN.map((lengthIn) => ({
    lengthIn,
    type: "unknown" as const,
  }))
}

/** Typical bay length (inches) for a weight-table component when layout OCR misses it. */
export function defaultLengthInForKind(kind: WeightComponentKind | null): number {
  switch (kind) {
    case "damper":
    case "filter":
    case "coil":
    case "special":
      return 7.9
    case "electric_heat":
      return 19.7
    case "inspection":
      return 31.5
    case "control_box":
      return 15.7
    case "fan":
      return 27.6
    case "heat_recovery":
      return 15.7
    default:
      return 7.9
  }
}

/** Convert inches → mm (layout drawings are always in inches). */
export function segmentInchesToMm(lengthIn: number): number {
  return Math.round(lengthIn * 25.4 * 10) / 10
}
