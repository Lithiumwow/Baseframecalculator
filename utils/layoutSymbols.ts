/**
 * Systemair layout drawing symbol types and weight-table name matching.
 *
 * Icon legend (cross-section view, top → bottom along unit length):
 * - fan: centrifugal fan + motor (blue)
 * - electric_heat: red lightning bolt
 * - coil: red horizontal coil lines / +/- symbols
 * - control_box: electrical switch schematic
 * - filter: filter symbol / green hatch / "I" in circle
 * - inspection: empty section / minimal content
 * - special: "+" or special-function marker
 */

import { defaultLengthInForKind } from "./layoutSegmentDefaults"

export type LayoutComponentType =
  | "fan"
  | "electric_heat"
  | "coil"
  | "control_box"
  | "filter"
  | "damper"
  | "inspection"
  | "special"
  | "heat_recovery"
  | "unknown"

export interface LayoutSegment {
  lengthIn: number
  type: LayoutComponentType
  /** Top + bottom deck types when dual-deck bays stack components */
  stackedTypes?: LayoutComponentType[]
  isStackedBay?: boolean
  typeConfidence?: number
}

export type WeightComponentKind = LayoutComponentType | "casing"

/** Map weight-table component names to layout symbol types. */
export function inferKindFromWeightName(name: string): WeightComponentKind | null {
  const n = name.toLowerCase().trim()
  if (n.includes("casing")) return "casing"
  if (n.includes("fan")) return "fan"
  if (n.includes("control")) return "control_box"
  if (n.includes("filter")) return "filter"
  if (n.includes("damper")) return "damper"
  if (n.includes("inspection")) return "inspection"
  if (n.includes("special")) return "special"
  if (n.includes("rotary") || n.includes("heat exchang") || n.includes("recuperat")) {
    return "heat_recovery"
  }
  if (n.includes("electric") && n.includes("heat")) return "electric_heat"
  if (n.includes("heating coil") || n.includes("heating")) return "coil"
  if (n.includes("cooling coil") || n.includes("coil")) return "coil"
  return null
}

/** Types present in a layout segment (primary + stacked decks). */
export function segmentLayoutTypes(seg: LayoutSegment): LayoutComponentType[] {
  const stacked = seg.stackedTypes?.filter((t) => t !== "unknown") ?? []
  if (stacked.length > 0) return stacked
  return seg.type !== "unknown" ? [seg.type] : []
}

/** Whether a layout segment type can carry this weight-table component. */
export function segmentMatchesWeightKind(
  segmentType: LayoutComponentType,
  weightKind: WeightComponentKind
): boolean {
  if (weightKind === "casing") return false
  if (weightKind === segmentType) return true
  // Damper sits in the same inlet bay as the filter section
  if (weightKind === "damper" && (segmentType === "filter" || segmentType === "damper"))
    return true
  if (weightKind === "special" && (segmentType === "special" || segmentType === "inspection"))
    return true
  return false
}

/** Match component kind against a segment (including stacked deck types). */
export function segmentMatchesComponentKind(seg: LayoutSegment, kind: WeightComponentKind): boolean {
  if (kind === "casing") return false
  return segmentLayoutTypes(seg).some((t) => segmentMatchesWeightKind(t, kind))
}

/** Human-readable label for UI preview. */
export function layoutTypeLabel(type: LayoutComponentType): string {
  switch (type) {
    case "fan":
      return "Fan"
    case "electric_heat":
      return "Electric heat"
    case "coil":
      return "Coil"
    case "control_box":
      return "Control box"
    case "filter":
      return "Filter"
    case "damper":
      return "Damper"
    case "inspection":
      return "Inspection / empty"
    case "special":
      return "Special function"
    case "heat_recovery":
      return "Heat recovery"
    default:
      return "Component"
  }
}

/**
 * Split ordered layout segments into per-casing-section groups using section lengths.
 */
export function splitSegmentsByCasingSections(
  segments: LayoutSegment[],
  casingLengthsIn: number[]
): LayoutSegment[][] {
  if (casingLengthsIn.length === 0) return [segments]

  const groups: LayoutSegment[][] = casingLengthsIn.map(() => [])
  let sectionIdx = 0
  let usedInSection = 0

  for (const seg of segments) {
    while (
      sectionIdx < casingLengthsIn.length - 1 &&
      usedInSection + seg.lengthIn > casingLengthsIn[sectionIdx] + 1.5
    ) {
      sectionIdx++
      usedInSection = 0
    }
    groups[sectionIdx].push(seg)
    usedInSection += seg.lengthIn
  }

  return groups
}

export interface SegmentAssignment {
  segmentIndex: number
  segment: LayoutSegment
  positionInSectionMm: number
}

/**
 * Assign weight-table components to layout segments within one casing section.
 */
export function matchComponentsToSegments(
  sectionSegments: LayoutSegment[],
  components: Array<{ name: string; weightLb: number }>,
  sectionLengthMm: number,
  inchesToMm: (inches: number) => number
): Map<number, SegmentAssignment> {
  const assignments = new Map<number, SegmentAssignment>()
  const usedSegments = new Set<number>()
  /** Kinds already placed on a stacked bay segment */
  const segmentAssignedKinds = new Map<number, Set<WeightComponentKind>>()
  /** Damper + filter share the same inlet bay segment */
  let filterBaySegment: number | null = null

  let segmentCursor = 0
  const segmentPositionsMm = sectionSegments.map((seg, i) => {
    const start = sectionSegments.slice(0, i).reduce((s, x) => s + inchesToMm(x.lengthIn), 0)
    return start
  })

  const maxSlotsOnSegment = (seg: LayoutSegment): number => {
    if (seg.isStackedBay && seg.stackedTypes) {
      return seg.stackedTypes.filter((t) => t !== "unknown").length
    }
    return 1
  }

  const canUseSegment = (segIdx: number, kind: WeightComponentKind, seg: LayoutSegment): boolean => {
    if (!segmentMatchesComponentKind(seg, kind)) return false

    const slots = maxSlotsOnSegment(seg)
    if (slots > 1 || seg.isStackedBay) {
      const assigned = segmentAssignedKinds.get(segIdx) ?? new Set()
      if (assigned.has(kind)) return false
      return assigned.size < slots
    }

    return !usedSegments.has(segIdx)
  }

  const markSegmentUsed = (segIdx: number, kind: WeightComponentKind, seg: LayoutSegment) => {
    const slots = maxSlotsOnSegment(seg)
    if (slots > 1 || seg.isStackedBay) {
      const assigned = segmentAssignedKinds.get(segIdx) ?? new Set()
      assigned.add(kind)
      segmentAssignedKinds.set(segIdx, assigned)
      if (assigned.size >= slots) usedSegments.add(segIdx)
    } else {
      usedSegments.add(segIdx)
    }
  }

  const findSegment = (
    kind: WeightComponentKind,
    startAt: number
  ): number | null => {
    if (kind === "filter" && filterBaySegment !== null) return filterBaySegment

    for (let i = startAt; i < sectionSegments.length; i++) {
      if (!canUseSegment(i, kind, sectionSegments[i])) continue
      if (segmentMatchesComponentKind(sectionSegments[i], kind)) {
        if (kind === "damper" || kind === "filter") filterBaySegment = i
        return i
      }
    }
    const targetIn = defaultLengthInForKind(kind)
    for (let i = startAt; i < sectionSegments.length; i++) {
      if (!canUseSegment(i, kind, sectionSegments[i])) continue
      if (Math.abs(sectionSegments[i].lengthIn - targetIn) < 1.5) {
        if (kind === "damper" || kind === "filter") filterBaySegment = i
        return i
      }
    }
    for (let i = 0; i < sectionSegments.length; i++) {
      if (!canUseSegment(i, kind, sectionSegments[i])) continue
      if (kind === "coil" && sectionSegments[i].type === "coil") return i
    }
    return null
  }

  for (let compIdx = 0; compIdx < components.length; compIdx++) {
    const comp = components[compIdx]
    if (comp.weightLb <= 0) continue

    const kind = inferKindFromWeightName(comp.name)
    if (kind === "casing") {
      assignments.set(compIdx, {
        segmentIndex: -1,
        segment: { lengthIn: sectionLengthMm / inchesToMm(1), type: "unknown" },
        positionInSectionMm: 0,
      })
      continue
    }

    let segIdx = kind ? findSegment(kind, segmentCursor) : null
    if (segIdx === null) {
      while (segmentCursor < sectionSegments.length && usedSegments.has(segmentCursor)) {
        segmentCursor++
      }
      segIdx = segmentCursor < sectionSegments.length ? segmentCursor : null
    }

    if (segIdx !== null && segIdx >= 0) {
      const seg = sectionSegments[segIdx]
      const stackedSlot = maxSlotsOnSegment(seg) > 1 || seg.isStackedBay
      const sharedInletBay =
        (kind === "filter" || kind === "damper") && filterBaySegment === segIdx

      if (kind) {
        if (!sharedInletBay) {
          markSegmentUsed(segIdx, kind, seg)
          if (!stackedSlot) segmentCursor = segIdx + 1
        }
      }

      assignments.set(compIdx, {
        segmentIndex: segIdx,
        segment: seg,
        positionInSectionMm: segmentPositionsMm[segIdx],
      })
    }
  }

  return assignments
}
