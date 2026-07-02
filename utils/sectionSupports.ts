import type { Section } from "../types"

/** One of two longitudinal beams carries this share of gravity along the frame length. */
export const LONGITUDINAL_BEAM_LOAD_SHARE = 0.5

/** Migrate legacy `supportType` to `hasLeg` / `hasLug`. */
export function sectionBoundaryHasLeg(section: Section): boolean {
  if (section.hasLeg !== undefined) return section.hasLeg
  if (section.supportType === "leg" || section.supportType === "hook") return true
  return false
}

export function sectionBoundaryHasLug(section: Section): boolean {
  if (section.hasLug !== undefined) return section.hasLug
  return section.supportType === "hook"
}

/** Sorted unique leg support positions (mm) including frame ends. */
export function collectLegSupportPositionsMm(sections: Section[], frameLengthMm: number): number[] {
  const positions = new Set<number>([0, frameLengthMm])

  sections.forEach((section, index) => {
    if (index > 0 && sectionBoundaryHasLeg(section)) {
      positions.add(section.startPosition)
    }
  })

  return [...positions].sort((a, b) => a - b)
}

/** Lifting lug positions at section boundaries (mm). */
export function collectLugPositionsMm(sections: Section[]): Array<{ positionMm: number; section: Section }> {
  const lugs: Array<{ positionMm: number; section: Section }> = []

  sections.forEach((section, index) => {
    if (index > 0 && sectionBoundaryHasLug(section)) {
      lugs.push({ positionMm: section.startPosition, section })
    }
  })

  return lugs
}

export function normalizeSectionSupports(section: Section): Section {
  const hasLug = sectionBoundaryHasLug(section)
  const hasLeg = hasLug ? true : sectionBoundaryHasLeg(section)
  return { ...section, hasLeg, hasLug }
}
