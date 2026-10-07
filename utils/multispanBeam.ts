/**
 * Multi-span simply-supported beam along frame length (gravity / service case).
 * Each span lies between consecutive leg supports; patch + casing loads become line loads.
 */

import type { Load, Section } from "../types"
import {
  convertSectionWeightToN,
  getDistributedLoadTotalWeightN,
} from "./conversions"
import { LONGITUDINAL_BEAM_LOAD_SHARE } from "./sectionSupports"

export interface LineLoadSegment {
  startMm: number
  endMm: number
  /** Line load intensity N/m on one longitudinal beam */
  wNPerM: number
}

export interface PointLoadOnBeam {
  positionMm: number
  forceN: number
}

export interface BeamDiagramPoint {
  x: number
  /** null = intentional break between independent spans (for charting) */
  y: number | null
}

export interface MultispanBeamResult {
  shear: BeamDiagramPoint[]
  moment: BeamDiagramPoint[]
  deflection: BeamDiagramPoint[]
  maxShearN: number
  maxMomentNm: number
  maxDeflectionMm: number
  governingSpanMm: number
  supportPositionsMm: number[]
  usedMultispan: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Build line + point loads on one longitudinal beam from frame data. */
export function buildLongitudinalBeamLoads(
  loads: Load[],
  sections: Section[],
  frameLengthMm: number,
  totalRoofWeight: number,
  totalRoofWeightUnit: "N" | "kg" | "lbs",
  otherComponentsWeight: number,
  otherComponentsWeightUnit: "N" | "kg" | "lbs",
  share: number = LONGITUDINAL_BEAM_LOAD_SHARE
): { lineSegments: LineLoadSegment[]; pointLoads: PointLoadOnBeam[] } {
  const lineSegments: LineLoadSegment[] = []
  const pointLoads: PointLoadOnBeam[] = []

  loads.forEach((load) => {
    if (load.type !== "Distributed Load") return

    let loadLengthMm = load.loadLength ?? 0
    if (loadLengthMm <= 0 && load.area) {
      loadLengthMm = Math.sqrt(load.area) * 1000
    }
    if (loadLengthMm <= 0) return

    const totalN = getDistributedLoadTotalWeightN(load) * share
    const wNPerM = totalN / (loadLengthMm / 1000)
    const startMm = load.startPosition
    const endMm = load.startPosition + loadLengthMm

    lineSegments.push({ startMm, endMm, wNPerM })
  })

  const roofTotalN = convertSectionWeightToN(totalRoofWeight, totalRoofWeightUnit)
  const roofPerMm = frameLengthMm > 0 ? roofTotalN / frameLengthMm : 0

  sections.forEach((section) => {
    const lengthMm = section.endPosition - section.startPosition
    if (lengthMm <= 0) return

    const casingN = convertSectionWeightToN(section.casingWeight, section.casingWeightUnit) * share
    const baseframeN =
      convertSectionWeightToN(section.baseframeWeight || 0, section.baseframeWeightUnit || "kg") *
      share
    const roofN = roofPerMm * lengthMm * share

    const totalLineN = casingN + baseframeN + roofN
    lineSegments.push({
      startMm: section.startPosition,
      endMm: section.endPosition,
      wNPerM: totalLineN / (lengthMm / 1000),
    })
  })

  const otherN = convertSectionWeightToN(otherComponentsWeight, otherComponentsWeightUnit) * share
  if (otherN > 0) {
    pointLoads.push({ positionMm: frameLengthMm / 2, forceN: otherN })
  }

  return { lineSegments, pointLoads }
}

function lineLoadOnSpan(
  segments: LineLoadSegment[],
  spanStartMm: number,
  spanEndMm: number
): Array<{ startLocalM: number; endLocalM: number; w: number }> {
  const spanLenMm = spanEndMm - spanStartMm
  if (spanLenMm <= 0) return []

  const clipped: Array<{ startLocalM: number; endLocalM: number; w: number }> = []

  for (const seg of segments) {
    const a = clamp(seg.startMm, spanStartMm, spanEndMm)
    const b = clamp(seg.endMm, spanStartMm, spanEndMm)
    if (b <= a) continue
    clipped.push({
      startLocalM: (a - spanStartMm) / 1000,
      endLocalM: (b - spanStartMm) / 1000,
      w: seg.wNPerM,
    })
  }

  return clipped
}

function pointLoadsOnSpan(
  points: PointLoadOnBeam[],
  spanStartMm: number,
  spanEndMm: number
): Array<{ localM: number; forceN: number }> {
  return points
    .filter((p) => p.positionMm >= spanStartMm && p.positionMm <= spanEndMm)
    .map((p) => ({ localM: (p.positionMm - spanStartMm) / 1000, forceN: p.forceN }))
}

function spanReactions(
  spanLengthM: number,
  udlParts: Array<{ startLocalM: number; endLocalM: number; w: number }>,
  points: Array<{ localM: number; forceN: number }>
): { rLeft: number; rRight: number } {
  let totalLoad = 0
  let momentAboutLeft = 0

  for (const p of points) {
    totalLoad += p.forceN
    momentAboutLeft += p.forceN * p.localM
  }

  for (const u of udlParts) {
    const len = u.endLocalM - u.startLocalM
    const force = u.w * len
    const centroid = (u.startLocalM + u.endLocalM) / 2
    totalLoad += force
    momentAboutLeft += force * centroid
  }

  const rRight = spanLengthM > 0 ? momentAboutLeft / spanLengthM : 0
  const rLeft = totalLoad - rRight
  return { rLeft, rRight }
}

function shearAtLocal(
  xM: number,
  rLeft: number,
  udlParts: Array<{ startLocalM: number; endLocalM: number; w: number }>,
  points: Array<{ localM: number; forceN: number }>
): number {
  let v = rLeft
  for (const p of points) {
    if (xM > p.localM) v -= p.forceN
  }
  for (const u of udlParts) {
    if (xM > u.startLocalM) {
      const loadedTo = Math.min(xM, u.endLocalM)
      v -= u.w * (loadedTo - u.startLocalM)
    }
  }
  return v
}

function momentAtLocal(
  xM: number,
  rLeft: number,
  udlParts: Array<{ startLocalM: number; endLocalM: number; w: number }>,
  points: Array<{ localM: number; forceN: number }>
): number {
  let m = rLeft * xM
  for (const p of points) {
    if (xM > p.localM) m -= p.forceN * (xM - p.localM)
  }
  for (const u of udlParts) {
    if (xM > u.startLocalM) {
      const loadedTo = Math.min(xM, u.endLocalM)
      const loadedLen = loadedTo - u.startLocalM
      const centroid = u.startLocalM + loadedLen / 2
      m -= u.w * loadedLen * (xM - centroid)
    }
  }
  return m
}

function integrateDeflection(
  xs: number[],
  moments: number[],
  E: number,
  I: number
): number[] {
  const n = xs.length
  if (n < 2 || E <= 0 || I <= 0) return moments.map(() => 0)
  const kappa = moments.map((m) => m / (E * I))
  const theta: number[] = [0]
  for (let i = 1; i < n; i++) {
    const h = xs[i] - xs[i - 1]
    theta.push(theta[i - 1] + ((kappa[i - 1] + kappa[i]) / 2) * h)
  }
  const deltaRaw: number[] = [0]
  for (let i = 1; i < n; i++) {
    const h = xs[i] - xs[i - 1]
    deltaRaw.push(deltaRaw[i - 1] + ((theta[i - 1] + theta[i]) / 2) * h)
  }
  const L = xs[n - 1] - xs[0]
  if (L <= 0) return deltaRaw.map(() => 0)
  const end = deltaRaw[n - 1]
  // Enforce zero deflection at both ends of this simply-supported span
  return deltaRaw.map((d, i) => d - ((xs[i] - xs[0]) / L) * end)
}

function roundDiagramY(value: number, kind: "shear" | "moment" | "deflectionMm"): number {
  if (kind === "deflectionMm") {
    // Avoid staircase plots when δ is << 0.01 mm (toFixed(4) was quantizing)
    const abs = Math.abs(value)
    if (abs >= 1) return Number(value.toFixed(4))
    if (abs >= 0.01) return Number(value.toFixed(5))
    return Number(value.toFixed(7))
  }
  return Number(value.toFixed(3))
}

export function analyzeMultispanBeam(
  supportPositionsMm: number[],
  lineSegments: LineLoadSegment[],
  pointLoads: PointLoadOnBeam[],
  E: number,
  I: number,
  pointsPerSpan: number = 80
): MultispanBeamResult {
  const supports = [...supportPositionsMm].sort((a, b) => a - b)
  const shear: BeamDiagramPoint[] = []
  const moment: BeamDiagramPoint[] = []
  const deflection: BeamDiagramPoint[] = []

  let maxShearN = 0
  let maxMomentNm = 0
  let maxDeflectionMm = 0
  let governingSpanMm = 0

  for (let s = 0; s < supports.length - 1; s++) {
    const spanStartMm = supports[s]
    const spanEndMm = supports[s + 1]
    const spanLenM = (spanEndMm - spanStartMm) / 1000
    if (spanLenM <= 0) continue

    const udlParts = lineLoadOnSpan(lineSegments, spanStartMm, spanEndMm)
    const points = pointLoadsOnSpan(pointLoads, spanStartMm, spanEndMm)
    const { rLeft } = spanReactions(spanLenM, udlParts, points)

    const xs: number[] = []
    const ms: number[] = []
    // Denser sampling on longer spans keeps curves smooth
    const localPoints = Math.max(24, Math.round(pointsPerSpan * Math.max(0.5, spanLenM / 1.0)))

    for (let i = 0; i < localPoints; i++) {
      const xLocalM = (spanLenM * i) / (localPoints - 1)
      const xMm = spanStartMm + xLocalM * 1000
      const v = shearAtLocal(xLocalM, rLeft, udlParts, points)
      const m = momentAtLocal(xLocalM, rLeft, udlParts, points)

      xs.push(xLocalM)
      ms.push(m)

      maxShearN = Math.max(maxShearN, Math.abs(v))
      maxMomentNm = Math.max(maxMomentNm, Math.abs(m))

      shear.push({ x: Number(xMm.toFixed(2)), y: roundDiagramY(v, "shear") })
      moment.push({ x: Number(xMm.toFixed(2)), y: roundDiagramY(m, "moment") })
    }

    // Break chart series between independent spans (avoids fake bridges)
    if (s < supports.length - 2) {
      shear.push({ x: Number(spanEndMm.toFixed(2)), y: null })
      moment.push({ x: Number(spanEndMm.toFixed(2)), y: null })
    }

    if (E > 0 && I > 0) {
      const deltas = integrateDeflection(xs, ms, E, I)
      for (let i = 0; i < xs.length; i++) {
        const xMm = spanStartMm + xs[i] * 1000
        const dMm = deltas[i] * 1000
        deflection.push({
          x: Number(xMm.toFixed(2)),
          y: roundDiagramY(dMm, "deflectionMm"),
        })
        if (Math.abs(dMm) > maxDeflectionMm) {
          maxDeflectionMm = Math.abs(dMm)
          governingSpanMm = spanEndMm - spanStartMm
        }
      }
      if (s < supports.length - 2) {
        deflection.push({ x: Number(spanEndMm.toFixed(2)), y: null })
      }
    }
  }

  return {
    shear,
    moment,
    deflection,
    maxShearN,
    maxMomentNm,
    maxDeflectionMm,
    governingSpanMm,
    supportPositionsMm: supports,
    usedMultispan: supports.length > 2,
  }
}

/** Lift-case screening: supports at lug positions only, full weight on one longitudinal beam. */
export function analyzeLiftCaseAtLugs(
  lugPositionsMm: number[],
  frameLengthMm: number,
  lineSegments: LineLoadSegment[],
  pointLoads: PointLoadOnBeam[],
  E: number,
  I: number
): { maxDeflectionMm: number; maxSpanMm: number } {
  if (lugPositionsMm.length === 0) {
    return { maxDeflectionMm: 0, maxSpanMm: 0 }
  }

  const supports = [...new Set([0, frameLengthMm, ...lugPositionsMm])].sort((a, b) => a - b)
  const fullBeamSegments = lineSegments.map((s) => ({
    ...s,
    wNPerM: s.wNPerM / LONGITUDINAL_BEAM_LOAD_SHARE,
  }))
  const fullBeamPoints = pointLoads.map((p) => ({
    ...p,
    forceN: p.forceN / LONGITUDINAL_BEAM_LOAD_SHARE,
  }))

  const result = analyzeMultispanBeam(supports, fullBeamSegments, fullBeamPoints, E, I, 30)
  let maxSpan = 0
  for (let i = 0; i < supports.length - 1; i++) {
    maxSpan = Math.max(maxSpan, supports[i + 1] - supports[i])
  }

  return { maxDeflectionMm: result.maxDeflectionMm, maxSpanMm: maxSpan }
}
