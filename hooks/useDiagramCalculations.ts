import { useCallback } from "react"
import type { Load, Results, Section } from "../types"
import type { MaterialProperties } from "../types"
import { standardMaterials } from "../constants"
import { validatePositive } from "../utils/validation"
import { getLoadMagnitudeInN } from "../utils/conversions"
import { collectLegSupportPositionsMm } from "../utils/sectionSupports"
import { analyzeMultispanBeam, buildLongitudinalBeamLoads } from "../utils/multispanBeam"

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
  setShearForceData: (data: Array<{ x: number; y: number }>) => void
  setBendingMomentData: (data: Array<{ x: number; y: number }>) => void
  setDeflectionData: (data: Array<{ x: number; y: number }>) => void
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
      const beamLengthM = beamLength / 1000
      const leftSupportM = leftSupport / 1000
      const rightSupportM = rightSupport / 1000
      const spanLength = rightSupportM - leftSupportM

      let R1 = 0,
        R2 = 0
      loads.forEach((load) => {
        const loadStartPositionM = load.startPosition / 1000
        const magnitudeInN = getLoadMagnitudeInN(load)
        if (load.type === "Point Load") {
          const a = loadStartPositionM - leftSupportM
          const b = rightSupportM - loadStartPositionM
          if (spanLength > 0) {
            R1 += (magnitudeInN * b) / spanLength
            R2 += (magnitudeInN * a) / spanLength
          }
        } else if (load.type === "Uniform Load") {
          const loadEndPositionM = load.endPosition! / 1000
          const loadStartM = Math.max(loadStartPositionM, leftSupportM)
          const loadEndM = Math.min(loadEndPositionM, rightSupportM)
          if (loadEndM > loadStartM) {
            const loadLengthM = loadEndM - loadStartM
            const totalLoad = magnitudeInN * loadLengthM
            const loadCentroidM = (loadStartM + loadEndM) / 2
            const a = loadCentroidM - leftSupportM
            const b = rightSupportM - loadCentroidM
            if (spanLength > 0) {
              R1 += (totalLoad * b) / spanLength
              R2 += (totalLoad * a) / spanLength
            }
          }
        }
      })

      for (let i = 0; i < numPoints; i++) {
        const x = i * dx
        const xM = x / 1000
        let shear = 0
        let moment = 0
        let delta = 0
        if (xM >= leftSupportM) shear += R1
        if (xM >= rightSupportM) shear -= R2
        loads.forEach((load) => {
          const magnitudeInN = getLoadMagnitudeInN(load)
          if (load.type === "Point Load") {
            const loadPosM = load.startPosition / 1000
            if (xM > loadPosM) shear -= magnitudeInN
          } else if (load.type === "Uniform Load" && load.endPosition) {
            const loadStartM = load.startPosition / 1000
            const loadEndM = load.endPosition / 1000
            if (xM > loadStartM) {
              const loadedLength = Math.min(xM - loadStartM, loadEndM - loadStartM)
              shear -= magnitudeInN * loadedLength
            }
          }
        })
        if (xM >= leftSupportM) moment = R1 * (xM - leftSupportM)
        if (xM >= rightSupportM) moment -= R2 * (xM - rightSupportM)
        loads.forEach((load) => {
          const magnitudeInN = getLoadMagnitudeInN(load)
          if (load.type === "Point Load") {
            const loadPosM = load.startPosition / 1000
            if (xM > loadPosM) moment -= magnitudeInN * (xM - loadPosM)
          } else if (load.type === "Uniform Load" && load.endPosition) {
            const loadStartM = load.startPosition / 1000
            const loadEndM = load.endPosition / 1000
            if (xM > loadStartM) {
              const loadedLength = Math.min(xM - loadStartM, loadEndM - loadStartM)
              const loadCentroid = loadStartM + loadedLength / 2
              moment -= magnitudeInN * loadedLength * (xM - loadCentroid)
            }
          }
        })
        if (E > 0 && I > 0) {
          loads.forEach((load) => {
            const magnitudeInN = getLoadMagnitudeInN(load)
            if (load.type === "Point Load") {
              const P = magnitudeInN
              const a = (load.startPosition - leftSupport) / 1000
              const L = spanLength
              const xLocal = xM - leftSupportM
              if (xLocal <= a) {
                const b = L - a
                delta +=
                  (P * b * xLocal * (L * L - b * b - xLocal * xLocal)) / (6 * L * E * I)
              } else {
                delta +=
                  (P * a * (L - xLocal) * (2 * L * xLocal - xLocal * xLocal - a * a)) /
                  (6 * L * E * I)
              }
            } else if (load.type === "Uniform Load" && load.endPosition) {
              const w = magnitudeInN
              const a = (load.startPosition - leftSupport) / 1000
              const b = (load.endPosition - leftSupport) / 1000
              const L = spanLength
              const xLocal = xM - leftSupportM
              if (a === 0 && b === L) {
                delta += (w * xLocal * (Math.pow(L, 3) - 2 * L * xLocal * xLocal + Math.pow(xLocal, 3))) / (24 * E * I)
              }
            }
          })
        }
        shearForce.push({ x: Number(x.toFixed(2)), y: Number(shear.toFixed(2)) })
        bendingMoment.push({ x: Number(x.toFixed(2)), y: Number(moment.toFixed(2)) })
        deflection.push({ x: Number(x.toFixed(2)), y: Number((delta * 1000).toFixed(4)) })
      }
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
        50
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
