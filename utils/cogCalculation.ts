/**
 * Center of Gravity (COG) and Center of Mass (COM) calculations
 * for the base frame weight distribution.
 *
 * For a rigid body under uniform gravity, COG and COM coincide.
 */

export interface WeightMassItem {
  name: string
  weight: number
  weightUnit: "N" | "kg" | "lbs"
  /** Position along frame length (mm from start) */
  x: number
  /** Position along frame width (mm from top edge). Defaults to center. */
  y?: number
}

export interface COGResult {
  /** Center of gravity along length (mm from frame start) */
  cogX: number
  /** Center of gravity along width (mm from top edge) */
  cogY: number
  /** Same as COG for rigid bodies under uniform gravity */
  comX: number
  comY: number
  totalWeight: number
  totalWeightUnit: "N" | "kg" | "lbs"
  /** COG as fraction of frame length (0–1) */
  cogXRatio: number
  /** COG as fraction of frame width (0–1) */
  cogYRatio: number
}

function toKg(weight: number, unit: "N" | "kg" | "lbs"): number {
  if (unit === "N") return weight / 9.81
  if (unit === "lbs") return weight / 2.20462
  return weight
}

/**
 * Calculate 2D center of gravity from discrete weight items.
 */
export function calculateCOG(
  items: WeightMassItem[],
  frameLength: number,
  frameWidth: number,
  outputUnit: "N" | "kg" | "lbs" = "lbs"
): COGResult {
  const defaultY = frameWidth / 2
  let totalMass = 0
  let momentX = 0
  let momentY = 0

  for (const item of items) {
    const mass = toKg(item.weight, item.weightUnit)
    if (mass <= 0) continue
    const y = item.y ?? defaultY
    totalMass += mass
    momentX += mass * item.x
    momentY += mass * y
  }

  if (totalMass === 0) {
    return {
      cogX: frameLength / 2,
      cogY: frameWidth / 2,
      comX: frameLength / 2,
      comY: frameWidth / 2,
      totalWeight: 0,
      totalWeightUnit: outputUnit,
      cogXRatio: 0.5,
      cogYRatio: 0.5,
    }
  }

  const cogX = momentX / totalMass
  const cogY = momentY / totalMass

  let totalWeight = totalMass
  if (outputUnit === "N") totalWeight = totalMass * 9.81
  else if (outputUnit === "lbs") totalWeight = totalMass * 2.20462

  return {
    cogX,
    cogY,
    comX: cogX,
    comY: cogY,
    totalWeight,
    totalWeightUnit: outputUnit,
    cogXRatio: frameLength > 0 ? cogX / frameLength : 0.5,
    cogYRatio: frameWidth > 0 ? cogY / frameWidth : 0.5,
  }
}

/**
 * Build COG items from imported sections and point loads.
 */
export function buildCOGItemsFromImport(
  sections: Array<{
    name?: string
    startPosition: number
    endPosition: number
    casingWeight: number
    casingWeightUnit: "N" | "kg" | "lbs"
    baseframeWeight: number
    baseframeWeightUnit: "N" | "kg" | "lbs"
    roofWeight: number
    roofWeightUnit: "N" | "kg" | "lbs"
  }>,
  loads: Array<{
    name?: string
    magnitude: number
    unit?: "N" | "kg" | "lbs"
    startPosition: number
    type: string
    loadLength?: number
    endPosition?: number
  }>,
  frameWidth: number,
  totalRoofWeight?: number,
  totalRoofWeightUnit?: "N" | "kg" | "lbs"
): WeightMassItem[] {
  const items: WeightMassItem[] = []

  for (const section of sections) {
    const centerX = (section.startPosition + section.endPosition) / 2

    if (section.casingWeight > 0) {
      items.push({
        name: `${section.name || "Section"} Casing`,
        weight: section.casingWeight,
        weightUnit: section.casingWeightUnit,
        x: centerX,
      })
    }
    if (section.baseframeWeight > 0) {
      items.push({
        name: `${section.name || "Section"} Baseframe`,
        weight: section.baseframeWeight,
        weightUnit: section.baseframeWeightUnit,
        x: centerX,
      })
    }
  }

  if (totalRoofWeight && totalRoofWeight > 0) {
    const frameLength =
      sections.length > 0 ? Math.max(...sections.map((s) => s.endPosition)) : 0
    items.push({
      name: "Roof + Weather Hood",
      weight: totalRoofWeight,
      weightUnit: totalRoofWeightUnit || "lbs",
      x: frameLength / 2,
    })
  } else {
    for (const section of sections) {
      if (section.roofWeight > 0) {
        const centerX = (section.startPosition + section.endPosition) / 2
        items.push({
          name: `${section.name || "Section"} Roof`,
          weight: section.roofWeight,
          weightUnit: section.roofWeightUnit,
          x: centerX,
        })
      }
    }
  }

  for (const load of loads) {
    const unit = load.unit || "lbs"
    let x = load.startPosition

    if (load.type === "Distributed Load" && load.loadLength) {
      x = load.startPosition + load.loadLength / 2
    } else if (load.type === "Uniform Load" && load.endPosition) {
      x = (load.startPosition + load.endPosition) / 2
    }

    items.push({
      name: load.name || "Load",
      weight: load.magnitude,
      weightUnit: unit,
      x,
    })
  }

  return items
}
