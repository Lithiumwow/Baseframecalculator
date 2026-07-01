/**
 * Dual-deck weight table pairing and bay load assignment.
 * Weight tables list bottom-deck components first, then top-deck (same left→right order).
 * Components in the same bay column share one length; weights are summed.
 */

import type { WeightImportComponent } from "./weightImport"
import type { LayoutSegment } from "./layoutSymbols"
import { segmentInchesToMm } from "./layoutSegmentDefaults"

export interface WeightRow {
  name: string
  weightLb: number
}

/** Split component list into bottom then top deck (Systemair weight table convention). */
export function splitDualDeckComponents(components: WeightRow[]): {
  bottomDeck: WeightRow[]
  topDeck: WeightRow[]
} {
  if (components.length <= 1) {
    return { bottomDeck: components, topDeck: [] }
  }

  const bottomCount = Math.ceil(components.length / 2)
  return {
    bottomDeck: components.slice(0, bottomCount),
    topDeck: components.slice(bottomCount),
  }
}

/**
 * Build one distributed load per layout bay, merging stacked top+bottom weights.
 */
export function assignDualDeckBayLoads(
  sectionComponents: WeightRow[],
  sectionSegments: LayoutSegment[],
  sectionIdx: number,
  weightUnit: "lbs" | "kg",
  frameWidthMm: number
): WeightImportComponent[] {
  const { bottomDeck, topDeck } = splitDualDeckComponents(sectionComponents)
  const bayCount = sectionSegments.length

  if (bayCount === 0) return []

  const loads: WeightImportComponent[] = []
  let positionMm = 0

  for (let bayIdx = 0; bayIdx < bayCount; bayIdx++) {
    const seg = sectionSegments[bayIdx]
    const loadLengthMm = Math.round(segmentInchesToMm(seg.lengthIn))
    const bottom = bottomDeck[bayIdx]
    const top = topDeck[bayIdx]

    const names: string[] = []
    let totalWeight = 0

    if (bottom) {
      names.push(bottom.name)
      totalWeight += bottom.weightLb
    }
    if (top) {
      names.push(top.name)
      totalWeight += top.weightLb
    }

    const includeZeroWeight =
      bottom?.name.toLowerCase().includes("inspection") ||
      bottom?.name.toLowerCase().includes("empty") ||
      top?.name.toLowerCase().includes("inspection") ||
      top?.name.toLowerCase().includes("empty")

    if (totalWeight <= 0 && !includeZeroWeight) {
      positionMm += loadLengthMm
      continue
    }

    loads.push({
      name: names.length > 1 ? names.join(" + ") : names[0] || "Component",
      sectionIndex: sectionIdx,
      position: Math.round(positionMm * 10) / 10,
      weight: Math.round(totalWeight * 100) / 100,
      weightUnit,
      loadType: "Distributed Load",
      loadLength: loadLengthMm,
      loadWidth: frameWidthMm,
    })

    positionMm += loadLengthMm
  }

  return loads
}

/**
 * Heuristic: dual-deck tables repeat component names (two fans, two dampers, etc.).
 */
export function looksLikeDualDeckWeightTable(components: WeightRow[]): boolean {
  if (components.length < 4) return false

  const normalized = components.map((c) => c.name.toLowerCase().trim())
  const unique = new Set(normalized)
  const duplicateRatio = 1 - unique.size / normalized.length

  const repeatedKinds = ["damper", "filter", "fan", "inspection"].filter((kind) =>
    normalized.filter((n) => n.includes(kind)).length >= 2
  )

  return duplicateRatio >= 0.25 || repeatedKinds.length >= 2
}
