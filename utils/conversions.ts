import type { Load } from "../types"

// Unit conversion functions
export const kgToN = (kg: number): number => kg * 9.81
export const lbsToN = (lbs: number): number => lbs * 4.44822 // 1 pound-force = 4.44822 Newtons

// Helper function to get load magnitude in N
export const getLoadMagnitudeInN = (load: Load): number => {
  if (load.unit === "kg") {
    return kgToN(load.magnitude)
  } else if (load.unit === "lbs") {
    return lbsToN(load.magnitude)
  }
  return load.magnitude // Default to N
}

/**
 * Total weight (N) for a distributed load.
 * - unit kg/lbs: magnitude is total component weight
 * - unit N: magnitude is pressure (N/m²) × footprint area
 */
export const getDistributedLoadTotalWeightN = (load: Load): number => {
  if (load.type !== "Distributed Load") {
    return getLoadMagnitudeInN(load)
  }

  const magnitudeInN = getLoadMagnitudeInN(load)

  if (load.unit === "kg" || load.unit === "lbs") {
    return magnitudeInN
  }

  if (load.loadLength && load.loadWidth) {
    const areaM2 = (load.loadLength * load.loadWidth) / 1_000_000
    return magnitudeInN * areaM2
  }

  if (load.area) {
    return magnitudeInN * load.area
  }

  return magnitudeInN
}

// Convert N to kg
export const nToKg = (n: number): number => n / 9.81

// Convert N to lbs
export const nToLbs = (n: number): number => n / 4.44822

// Convert section weight to N
export const convertSectionWeightToN = (weight: number, unit: "N" | "kg" | "lbs"): number => {
  if (unit === "kg") {
    return weight * 9.81
  } else if (unit === "lbs") {
    return weight * 4.44822
  }
  return weight
}

