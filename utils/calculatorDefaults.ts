import type { Load } from "../types"
import { standardMaterials } from "../constants"

export const CALCULATOR_STORAGE_KEY = "beamLoadCalculatorState"

export const DEFAULT_SIMPLE_BEAM_LOADS: Load[] = [
  { type: "Point Load", magnitude: 1000, startPosition: 500, unit: "N", name: "Load 1" },
]

export function getDefaultBaseFrameLoads(frameWidth: number): Load[] {
  return [
    {
      type: "Distributed Load",
      magnitude: 1000,
      startPosition: 0,
      loadLength: 500,
      loadWidth: frameWidth,
      unit: "N",
      name: "Load 1",
    },
  ]
}

export const DEFAULT_CALCULATOR_VALUES = {
  analysisType: "Simple Beam" as const,
  beamType: "Simple Beam",
  beamCrossSection: "C Channel",
  beamLength: 1000,
  frameLength: 2000,
  frameWidth: 1000,
  leftSupport: 0,
  rightSupport: 1000,
  material: "ASTM A36 Structural Steel" as keyof typeof standardMaterials,
  customMaterial: { ...standardMaterials["Custom"] },
  width: 100,
  height: 218,
  flangeWidth: 66,
  flangeThickness: 3,
  webThickness: 44.8,
  diameter: 100,
  beamDensity: 7850,
  totalRoofWeight: 0,
  totalRoofWeightUnit: "kg" as const,
}

export function clearCalculatorStorage(): void {
  try {
    localStorage.removeItem(CALCULATOR_STORAGE_KEY)
  } catch {
    // ignore storage errors
  }
}
