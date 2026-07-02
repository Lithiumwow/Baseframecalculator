import type { Section, LugPointSummary, LiftingAnalysis } from "../types"
import {
  collectLegSupportPositionsMm,
  collectLugPositionsMm,
} from "./sectionSupports"
import { analyzeLiftCaseAtLugs, type LineLoadSegment, type PointLoadOnBeam } from "./multispanBeam"

export type { LugPointSummary, LiftingAnalysis }

export function computeLiftingAnalysis(
  sections: Section[],
  frameLengthMm: number,
  totalAppliedLoadN: number,
  lineSegments: LineLoadSegment[],
  pointLoads: PointLoadOnBeam[],
  E: number,
  I: number
): LiftingAnalysis | null {
  const lugs = collectLugPositionsMm(sections)
  if (lugs.length === 0) return null

  const legPositions = collectLegSupportPositionsMm(sections, frameLengthMm)
  const equalShare = totalAppliedLoadN / lugs.length

  const lugPoints: LugPointSummary[] = lugs.map(({ positionMm, section }) => {
    let nearestLeg = legPositions[0]
    let minDist = Math.abs(positionMm - nearestLeg)
    for (const leg of legPositions) {
      const d = Math.abs(positionMm - leg)
      if (d < minDist) {
        minDist = d
        nearestLeg = leg
      }
    }

    const capacityN = section.lugCapacityN
    const summary: LugPointSummary = {
      positionMm,
      sectionName: section.name || "Section",
      shareForceN: equalShare,
      nearestLegMm: nearestLeg,
      distanceToLegMm: minDist,
    }

    if (capacityN && capacityN > 0) {
      summary.lugCapacityN = capacityN
      summary.capacityUtilization = equalShare / capacityN
    }

    return summary
  })

  const liftCase = analyzeLiftCaseAtLugs(
    lugs.map((l) => l.positionMm),
    frameLengthMm,
    lineSegments,
    pointLoads,
    E,
    I
  )

  return {
    lugPoints,
    lugCount: lugs.length,
    liftCaseMaxDeflectionMm: liftCase.maxDeflectionMm,
    maxLiftSpanMm: liftCase.maxSpanMm,
    equalSharePerLugN: equalShare,
  }
}
