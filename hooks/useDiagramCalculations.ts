import { useCallback } from "react"
import type { Load, Results, Section } from "../types"
import type { MaterialProperties } from "../types"
import { standardMaterials } from "../constants"
import { validatePositive } from "../utils/validation"
import { collectLegSupportPositionsMm } from "../utils/sectionSupports"
import { analyzeMultispanBeam, buildLongitudinalBeamLoads } from "../utils/multispanBeam"
import { analyzeSimpleBeam } from "../utils/simpleBeamAnalysis"

interface UseDiagramCalculationsParams {
  analysisType: "Simple Beam" | "Base Frame"
  beamLength: number
  frameLength: number
  frameWidth: number
  leftSupport: number
  rightSupport: number
  loads: Load[]
  sections: Section[]
  results: Results
  material: keyof typeof standardMaterials
  customMaterial: MaterialProperties
  totalRoofWeight: number
  totalRoofWeightUnit: "N" | "kg" | "lbs"
  otherComponentsWeight: number
  otherComponentsWeightUnit: "N" | "kg" | "lbs"
  setShearForceData: (data: Array<{ x: number; y: number | null }>) => void
  setBendingMomentData: (data: Array<{ x: number; y: number | null }>) => void
  setDeflectionData: (data: Array<{ x: number; y: number | null }>) => void
}

export function useDiagramCalculations(params: UseDiagramCalculationsParams) {
  const {
    analysisType,
    beamLength,
    frameLength,
    frameWidth,
    leftSupport,
    rightSupport,
    loads,
    sections,
    results,
    material,
    customMaterial,
    totalRoofWeight,
    totalRoofWeightUnit,
    otherComponentsWeight,
    otherComponentsWeightUnit,
    setShearForceData,
    setBendingMomentData,
    setDeflectionData,
  } = params

  const calculateDiagrams = useCallback(() => {
    const numPoints = 100
    const validBeamLength = validatePositive(beamLength, 1000)
    const validFrameLength = validatePositive(frameLength, 1000)
    const validFrameWidth = validatePositive(frameWidth, 1000)
    const criticalLength =
      analysisType === "Simple Beam" ? validBeamLength : Math.max(validFrameLength, validFrameWidth)
    const dx = criticalLength / (numPoints - 1)
    const shearForce: Array<{ x: number; y: number }> = []
    const bendingMoment: Array<{ x: number; y: number }> = []
    const deflection: Array<{ x: number; y: number }> = []

    const materialProps = material === "Custom" ? customMaterial : standardMaterials[material]
    const E = materialProps.elasticModulus * 1e9
    const I = results.momentOfInertia

    if (analysisType === "Simple Beam") {
      // Shared solver: Point / Uniform / Distributed + M/EI deflection
      const simpleBeam = analyzeSimpleBeam(
        validBeamLength,
        leftSupport,
        rightSupport,
        loads,
        E,
        I,
        120
      )
      shearForce.push(...simpleBeam.shear)
      bendingMoment.push(...simpleBeam.moment)
      deflection.push(...simpleBeam.deflection)
    } else {
      const legPositions = collectLegSupportPositionsMm(sections, validFrameLength)

      const beamLoads = buildLongitudinalBeamLoads(
        loads,
        sections,
        validFrameLength,
        totalRoofWeight,
        totalRoofWeightUnit,
        otherComponentsWeight,
        otherComponentsWeightUnit
      )

      const multispan = analyzeMultispanBeam(
        legPositions,
        beamLoads.lineSegments,
        beamLoads.pointLoads,
        E,
        I,
        80
      )

      if (multispan.shear.length > 0) {
        shearForce.push(...multispan.shear)
        bendingMoment.push(...multispan.moment)
        deflection.push(...multispan.deflection)
      } else {
        const criticalLengthM = criticalLength / 1000
        const uniformLoadPerMeter = results.totalAppliedLoad / 4 / criticalLengthM
        for (let i = 0; i < numPoints; i++) {
          const x = i * dx
          const xM = x / 1000
          const shear = (uniformLoadPerMeter * criticalLengthM) / 2 - uniformLoadPerMeter * xM
          const moment = (uniformLoadPerMeter * xM * (criticalLengthM - xM)) / 2
          let delta = 0
          if (E > 0 && I > 0) {
            delta =
              (uniformLoadPerMeter * xM * (Math.pow(criticalLengthM, 3) - 2 * criticalLengthM * xM * xM + Math.pow(xM, 3))) /
              (24 * E * I)
          }
          shearForce.push({ x: Number(x.toFixed(2)), y: Number(shear.toFixed(2)) })
          bendingMoment.push({ x: Number(x.toFixed(2)), y: Number(moment.toFixed(2)) })
          deflection.push({ x: Number(x.toFixed(2)), y: Number((delta * 1000).toFixed(4)) })
        }
      }
    }

    setShearForceData(shearForce)
    setBendingMomentData(bendingMoment)
    setDeflectionData(deflection)
  }, [
    analysisType,
    beamLength,
    frameLength,
    frameWidth,
    leftSupport,
    rightSupport,
    loads,
    sections,
    results.totalAppliedLoad,
    results.momentOfInertia,
    material,
    customMaterial,
    totalRoofWeight,
    totalRoofWeightUnit,
    otherComponentsWeight,
    otherComponentsWeightUnit,
    setShearForceData,
    setBendingMomentData,
    setDeflectionData,
  ])

  return { calculateDiagrams }
}
