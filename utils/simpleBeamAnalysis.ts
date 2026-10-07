/**
 * Simply-supported beam analysis (reactions, shear, moment, deflection)
 * for Point, Uniform, and Distributed loads.
 */

import type { Load } from "../types"
import { getDistributedLoadTotalWeightN, getLoadMagnitudeInN } from "./conversions"

export interface BeamDiagramPoint {
  x: number
  y: number
}

export interface SimpleBeamAnalysisResult {
  rLeft: number
  rRight: number
  maxShearN: number
  maxMomentNm: number
  maxDeflectionM: number
  shear: BeamDiagramPoint[]
  moment: BeamDiagramPoint[]
  deflection: BeamDiagramPoint[]
}

interface PointLoad {
  positionM: number
  forceN: number
}

interface UdlSegment {
  startM: number
  endM: number
  wNPerM: number
}

/** Along-beam extent (mm) for a distributed footprint / patch load. */
export function getDistributedLoadExtentMm(
  load: Load
): { startMm: number; endMm: number } | null {
  if (load.type !== "Distributed Load") return null

  if (load.loadLength && load.loadLength > 0) {
    return {
      startMm: load.startPosition,
      endMm: load.startPosition + load.loadLength,
    }
  }

  if (load.area && load.area > 0) {
    const sideMm = Math.sqrt(load.area) * 1000
    return {
      startMm: load.startPosition,
      endMm: load.startPosition + sideMm,
    }
  }

  if (load.endPosition != null && load.endPosition > load.startPosition) {
    return { startMm: load.startPosition, endMm: load.endPosition }
  }

  return null
}

function normalizeLoads(loads: Load[]): { points: PointLoad[]; udls: UdlSegment[] } {
  const points: PointLoad[] = []
  const udls: UdlSegment[] = []

  for (const load of loads) {
    if (load.type === "Point Load") {
      points.push({
        positionM: load.startPosition / 1000,
        forceN: getLoadMagnitudeInN(load),
      })
      continue
    }

    if (load.type === "Uniform Load" && load.endPosition != null) {
      const startM = load.startPosition / 1000
      const endM = load.endPosition / 1000
      if (endM > startM) {
        udls.push({ startM, endM, wNPerM: getLoadMagnitudeInN(load) })
      }
      continue
    }

    if (load.type === "Distributed Load") {
      const extent = getDistributedLoadExtentMm(load)
      if (!extent) continue
      const startM = extent.startMm / 1000
      const endM = extent.endMm / 1000
      const lengthM = endM - startM
      if (lengthM <= 0) continue
      const totalN = getDistributedLoadTotalWeightN(load)
      udls.push({ startM, endM, wNPerM: totalN / lengthM })
    }
  }

  return { points, udls }
}

function spanReactions(
  leftSupportM: number,
  rightSupportM: number,
  points: PointLoad[],
  udls: UdlSegment[]
): { rLeft: number; rRight: number } {
  const span = rightSupportM - leftSupportM
  if (span <= 0) return { rLeft: 0, rRight: 0 }

  let rLeft = 0
  let rRight = 0

  for (const p of points) {
    const a = p.positionM - leftSupportM
    const b = rightSupportM - p.positionM
    rLeft += (p.forceN * b) / span
    rRight += (p.forceN * a) / span
  }

  for (const u of udls) {
    const startM = Math.max(u.startM, leftSupportM)
    const endM = Math.min(u.endM, rightSupportM)
    if (endM <= startM) continue
    const lengthM = endM - startM
    const totalLoad = u.wNPerM * lengthM
    const centroidM = (startM + endM) / 2
    const a = centroidM - leftSupportM
    const b = rightSupportM - centroidM
    rLeft += (totalLoad * b) / span
    rRight += (totalLoad * a) / span
  }

  return { rLeft, rRight }
}

function shearAt(
  xM: number,
  leftSupportM: number,
  rightSupportM: number,
  rLeft: number,
  rRight: number,
  points: PointLoad[],
  udls: UdlSegment[]
): number {
  let v = 0
  if (xM >= leftSupportM) v += rLeft
  if (xM >= rightSupportM) v -= rRight

  for (const p of points) {
    if (xM > p.positionM) v -= p.forceN
  }
  for (const u of udls) {
    if (xM > u.startM) {
      const loadedTo = Math.min(xM, u.endM)
      v -= u.wNPerM * (loadedTo - u.startM)
    }
  }
  return v
}

function momentAt(
  xM: number,
  leftSupportM: number,
  rightSupportM: number,
  rLeft: number,
  rRight: number,
  points: PointLoad[],
  udls: UdlSegment[]
): number {
  let m = 0
  if (xM >= leftSupportM) m += rLeft * (xM - leftSupportM)
  if (xM >= rightSupportM) m -= rRight * (xM - rightSupportM)

  for (const p of points) {
    if (xM > p.positionM) m -= p.forceN * (xM - p.positionM)
  }
  for (const u of udls) {
    if (xM > u.startM) {
      const loadedTo = Math.min(xM, u.endM)
      const loadedLen = loadedTo - u.startM
      const centroid = u.startM + loadedLen / 2
      m -= u.wNPerM * loadedLen * (xM - centroid)
    }
  }
  return m
}

/** Double-integrate M/EI; enforce zero deflection at first and last sample (supports). */
function integrateDeflection(xs: number[], moments: number[], E: number, I: number): number[] {
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
  return deltaRaw.map((d, i) => d - ((xs[i] - xs[0]) / L) * end)
}

function buildSamplePositionsM(
  beamLengthM: number,
  leftSupportM: number,
  rightSupportM: number,
  points: PointLoad[],
  udls: UdlSegment[],
  numPoints: number
): number[] {
  const set = new Set<number>()
  for (let i = 0; i < numPoints; i++) {
    set.add((beamLengthM * i) / (numPoints - 1))
  }
  set.add(0)
  set.add(beamLengthM)
  set.add(leftSupportM)
  set.add(rightSupportM)
  for (const p of points) set.add(p.positionM)
  for (const u of udls) {
    set.add(u.startM)
    set.add(u.endM)
    set.add((u.startM + u.endM) / 2)
  }

  return [...set]
    .filter((x) => x >= 0 && x <= beamLengthM + 1e-12)
    .sort((a, b) => a - b)
}

/**
 * Analyze a simply-supported beam along [0, beamLengthMm].
 * Supports may be inset from the ends; overhangs are included in diagrams.
 */
export function analyzeSimpleBeam(
  beamLengthMm: number,
  leftSupportMm: number,
  rightSupportMm: number,
  loads: Load[],
  E: number,
  I: number,
  numPoints: number = 120
): SimpleBeamAnalysisResult {
  const beamLengthM = beamLengthMm / 1000
  const leftSupportM = leftSupportMm / 1000
  const rightSupportM = rightSupportMm / 1000
  const { points, udls } = normalizeLoads(loads)
  const { rLeft, rRight } = spanReactions(leftSupportM, rightSupportM, points, udls)

  const xs = buildSamplePositionsM(
    beamLengthM,
    leftSupportM,
    rightSupportM,
    points,
    udls,
    numPoints
  )

  const moments: number[] = []
  const shear: BeamDiagramPoint[] = []
  const moment: BeamDiagramPoint[] = []

  let maxShearN = Math.max(Math.abs(rLeft), Math.abs(rRight))
  let maxMomentNm = 0

  for (const xM of xs) {
    const v = shearAt(xM, leftSupportM, rightSupportM, rLeft, rRight, points, udls)
    const m = momentAt(xM, leftSupportM, rightSupportM, rLeft, rRight, points, udls)
    moments.push(m)
    maxShearN = Math.max(maxShearN, Math.abs(v))
    maxMomentNm = Math.max(maxMomentNm, Math.abs(m))

    const xMm = xM * 1000
    shear.push({ x: Number(xMm.toFixed(2)), y: Number(v.toFixed(2)) })
    moment.push({ x: Number(xMm.toFixed(2)), y: Number(m.toFixed(2)) })
  }

  // Deflection samples between supports (boundary zeros at support ends)
  const spanXs = xs.filter((x) => x >= leftSupportM - 1e-12 && x <= rightSupportM + 1e-12)
  const spanMoments = spanXs.map((x) =>
    momentAt(x, leftSupportM, rightSupportM, rLeft, rRight, points, udls)
  )
  const spanDeltas =
    E > 0 && I > 0 ? integrateDeflection(spanXs, spanMoments, E, I) : spanXs.map(() => 0)

  const deltaByX = new Map<number, number>()
  for (let i = 0; i < spanXs.length; i++) {
    deltaByX.set(spanXs[i], spanDeltas[i])
  }

  let maxDeflectionM = 0
  const deflection: BeamDiagramPoint[] = []
  for (const xM of xs) {
    const d = deltaByX.get(xM) ?? 0
    maxDeflectionM = Math.max(maxDeflectionM, Math.abs(d))
    deflection.push({
      x: Number((xM * 1000).toFixed(2)),
      y: Number((d * 1000).toFixed(4)),
    })
  }

  return {
    rLeft,
    rRight,
    maxShearN,
    maxMomentNm,
    maxDeflectionM,
    shear,
    moment,
    deflection,
  }
}
