import { useCallback } from "react"
import type { Load, Section, Results } from "../types"
import type { MaterialProperties } from "../types"
import { standardMaterials } from "../constants"
import { validateNumber, validatePositive } from "../utils/validation"
import { getLoadMagnitudeInN, convertSectionWeightToN, getDistributedLoadTotalWeightN } from "../utils/conversions"

interface UseBeamCalculationsParams {
  analysisType: "Simple Beam" | "Base Frame"
  beamLength: number
  frameLength: number
  frameWidth: number
  leftSupport: number
  rightSupport: number
  loads: Load[]
  sections: Section[]
  material: keyof typeof standardMaterials
  customMaterial: MaterialProperties
  width: number
  height: number
  flangeWidth: number
  flangeThickness: number
  webThickness: number
  diameter: number
  beamDensity: number
  beamCrossSection: string
  frameWeight: number // User-provided frame weight in N (for Base Frame) or calculated (for Simple Beam)
  setFrameWeight: (weight: number) => void
  setResults: (results: Results) => void
  totalRoofWeight: number // Total roof weight for entire frame
  totalRoofWeightUnit: "N" | "kg" | "lbs"
}

export function useBeamCalculations(params: UseBeamCalculationsParams) {
  const {
    analysisType,
    beamLength,
    frameLength,
    frameWidth,
    leftSupport,
    rightSupport,
    loads,
    sections,
    material,
    customMaterial,
    width,
    height,
    flangeWidth,
    flangeThickness,
    webThickness,
    diameter,
    beamDensity,
    beamCrossSection,
    frameWeight: providedFrameWeight,
    setFrameWeight,
    setResults,
    totalRoofWeight,
    totalRoofWeightUnit,
  } = params

  const calculateResults = useCallback(() => {
    // Validate inputs
    const validFrameLength = validatePositive(frameLength, 1000)
    const validFrameWidth = validatePositive(frameWidth, 1000)
    const validBeamLength = validatePositive(beamLength, 1000)

    // Convert mm to m for calculations
    const frameLengthM = validFrameLength / 1000
    const frameWidthM = validFrameWidth / 1000
    const beamLengthM = validBeamLength / 1000
    const widthM = validatePositive(width, 100) / 1000
    const heightM = validatePositive(height, 218) / 1000
    const flangeWidthM = validatePositive(flangeWidth, 66) / 1000
    const flangeThicknessM = validatePositive(flangeThickness, 3) / 1000
    const webThicknessM = validatePositive(webThickness, 44.8) / 1000
    const diameterM = validatePositive(diameter, 100) / 1000

    // Calculate cross-sectional properties
    let beamVolume: number
    switch (beamCrossSection) {
      case "Rectangular":
        beamVolume = widthM * heightM
        break
      case "I Beam":
        beamVolume = 2 * flangeWidthM * flangeThicknessM + (heightM - 2 * flangeThicknessM) * webThicknessM
        break
      case "C Channel":
        beamVolume = 2 * flangeWidthM * flangeThicknessM + (heightM - 2 * flangeThicknessM) * webThicknessM
        break
      case "Circular":
        beamVolume = Math.PI * Math.pow(diameterM / 2, 2)
        break
      default:
        beamVolume = widthM * heightM
    }

    // Calculate total applied loads (convert to N if needed)
    let totalAppliedLoad = 0
    loads.forEach((load) => {
      if (load.type === "Distributed Load") {
        totalAppliedLoad += getDistributedLoadTotalWeightN(load)
      } else if (load.type === "Uniform Load" && load.endPosition) {
        const magnitudeInN = getLoadMagnitudeInN(load)
        const loadLength = (load.endPosition - load.startPosition) / 1000
        totalAppliedLoad += magnitudeInN * loadLength
      } else {
        totalAppliedLoad += getLoadMagnitudeInN(load)
      }
    })

    let maxShearForce = 0
    let maxBendingMoment = 0
    let frameWeightN = 0
    let totalBeams = 0
    let loadPerBeam = 0
    let cornerReactionForce = 0
    let cornerReactions = { R1: 0, R2: 0, R3: 0, R4: 0 }

    if (analysisType === "Simple Beam") {
      // Single beam analysis
      totalBeams = 1
      loadPerBeam = totalAppliedLoad
      frameWeightN = beamVolume * beamLengthM * beamDensity * 9.81

      // Calculate reactions for simple beam
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

      maxShearForce = Math.max(Math.abs(R1), Math.abs(R2))

      // Calculate maximum bending moment
      const numPoints = 100
      const dx = beamLengthM / (numPoints - 1)

      for (let i = 0; i < numPoints; i++) {
        const x = i * dx
        let moment = 0

        if (x >= leftSupportM) {
          moment = R1 * (x - leftSupportM)
        }
        if (x >= rightSupportM) {
          moment -= R2 * (x - rightSupportM)
        }

        loads.forEach((load) => {
          const magnitudeInN = getLoadMagnitudeInN(load)
          if (load.type === "Point Load" && x > load.startPosition / 1000) {
            moment -= magnitudeInN * (x - load.startPosition / 1000)
          } else if (load.type === "Uniform Load") {
            const loadStartM = load.startPosition / 1000
            const loadEndM = load.endPosition! / 1000
            if (x > loadStartM) {
              const loadedLength = Math.min(x - loadStartM, loadEndM - loadStartM)
              const loadCentroid = loadStartM + loadedLength / 2
              moment -= magnitudeInN * loadedLength * (x - loadCentroid)
            }
          }
        })

        maxBendingMoment = Math.max(maxBendingMoment, Math.abs(moment))
      }
    } else {
      // Base frame analysis - Calculate corner reactions based on load positions
      totalBeams = 4
      // For Base Frame: Use user-provided frame weight (from actual measurement)
      // If not provided (0), calculate from beam profile as fallback
      if (providedFrameWeight > 0) {
        frameWeightN = providedFrameWeight
      } else {
        // Fallback: Calculate from beam profile (not recommended - use actual measurement)
        const framePerimeter = 2 * (frameLengthM + frameWidthM)
        const frameVolumeM3 = beamVolume * framePerimeter
        frameWeightN = frameVolumeM3 * beamDensity * 9.81
      }

      // Initialize corner reactions (R1=top-left, R2=top-right, R3=bottom-left, R4=bottom-right)
      let R1 = 0, R2 = 0, R3 = 0, R4 = 0

      // Distribute each load to corners based on its position
      loads.forEach((load) => {
        let loadWeight = 0
        let loadCenterX = 0
        let loadCenterY = frameWidthM / 2 // Default to center in width

        if (load.type === "Distributed Load") {
          let loadLengthMM = 0
          let loadWidthMM = 0
          
          if (load.loadLength && load.loadWidth) {
            loadLengthMM = validatePositive(load.loadLength, 100)
            loadWidthMM = validatePositive(load.loadWidth, 100)
            loadWeight = getDistributedLoadTotalWeightN(load)
            loadCenterX = (load.startPosition + loadLengthMM / 2) / 1000
            loadCenterY = (frameWidth - loadWidthMM / 2) / 1000
          } else if (load.area) {
            const sideLengthMM = Math.sqrt(validatePositive(load.area, 1)) * 1000
            loadWeight = getDistributedLoadTotalWeightN(load)
            loadCenterX = (load.startPosition + sideLengthMM / 2) / 1000
            loadCenterY = frameWidthM / 2
          } else {
            return // Skip invalid load
          }
        } else if (load.type === "Point Load") {
          loadWeight = getLoadMagnitudeInN(load)
          loadCenterX = load.startPosition / 1000
          loadCenterY = frameWidthM / 2
        } else if (load.type === "Uniform Load" && load.endPosition) {
          const magnitudeInN = getLoadMagnitudeInN(load)
          const loadLengthM = (load.endPosition - load.startPosition) / 1000
          loadWeight = magnitudeInN * loadLengthM
          loadCenterX = (load.startPosition + load.endPosition) / 2000
          loadCenterY = frameWidthM / 2
        } else {
          return // Skip invalid load
        }

        // Distribute load to corners based on position using area method
        // Each corner gets load proportional to the area of rectangle from load center to OPPOSITE corner
        // This ensures loads on the left give more reaction to left corners, etc.
        // R1 (top-left at 0,0): area from load center to bottom-right corner
        const areaR1 = (frameLengthM - loadCenterX) * (frameWidthM - loadCenterY)
        // R2 (top-right at frameLengthM, 0): area from load center to bottom-left corner
        const areaR2 = loadCenterX * (frameWidthM - loadCenterY)
        // R3 (bottom-left at 0, frameWidthM): area from load center to top-right corner
        const areaR3 = (frameLengthM - loadCenterX) * loadCenterY
        // R4 (bottom-right at frameLengthM, frameWidthM): area from load center to top-left corner
        const areaR4 = loadCenterX * loadCenterY

        const totalArea = frameLengthM * frameWidthM

        if (totalArea > 0) {
          R1 += loadWeight * (areaR1 / totalArea)
          R2 += loadWeight * (areaR2 / totalArea)
          R3 += loadWeight * (areaR3 / totalArea)
          R4 += loadWeight * (areaR4 / totalArea)
        }
      })

      // Calculate total frame weight from all sections
      let totalFrameWeightFromSections = 0
      sections.forEach((section) => {
        const baseframeWeightN = convertSectionWeightToN(section.baseframeWeight || 0, section.baseframeWeightUnit || "kg")
        totalFrameWeightFromSections += baseframeWeightN
      })

      // Use total frame weight from sections if available, otherwise use provided frame weight
      if (totalFrameWeightFromSections > 0) {
        frameWeightN = totalFrameWeightFromSections
      }

      // Calculate roof weight per unit length from total roof weight
      const totalRoofWeightN = convertSectionWeightToN(totalRoofWeight, totalRoofWeightUnit)
      const roofWeightPerMM = frameLength > 0 ? totalRoofWeightN / frameLength : 0

      // Process section-level loads (casing weight, baseframe weight, and roof weight)
      sections.forEach((section) => {
        const sectionLengthM = (section.endPosition - section.startPosition) / 1000
        const sectionLengthMM = section.endPosition - section.startPosition
        const sectionStartM = section.startPosition / 1000
        const sectionEndM = section.endPosition / 1000
        const sectionCenterX = (sectionStartM + sectionEndM) / 2
        const sectionCenterY = frameWidthM / 2

        // Convert all section weights to N
        const casingWeightN = convertSectionWeightToN(section.casingWeight, section.casingWeightUnit)
        const baseframeWeightN = convertSectionWeightToN(section.baseframeWeight || 0, section.baseframeWeightUnit || "kg")
        
        // Calculate roof weight for this section based on total roof weight and section length
        const sectionRoofWeightN = roofWeightPerMM * sectionLengthMM

        // Distribute all section weights (casing + baseframe + roof) to corners using area method
        const totalSectionLoad = casingWeightN + baseframeWeightN + sectionRoofWeightN

        // Use area method to distribute to corners
        const areaR1 = (frameLengthM - sectionCenterX) * (frameWidthM - sectionCenterY)
        const areaR2 = sectionCenterX * (frameWidthM - sectionCenterY)
        const areaR3 = (frameLengthM - sectionCenterX) * sectionCenterY
        const areaR4 = sectionCenterX * sectionCenterY
        const totalArea = frameLengthM * frameWidthM

        if (totalArea > 0) {
          R1 += totalSectionLoad * (areaR1 / totalArea)
          R2 += totalSectionLoad * (areaR2 / totalArea)
          R3 += totalSectionLoad * (areaR3 / totalArea)
          R4 += totalSectionLoad * (areaR4 / totalArea)
        }

        // Add all section weights to totalAppliedLoad
        totalAppliedLoad += casingWeightN
        totalAppliedLoad += baseframeWeightN
        totalAppliedLoad += sectionRoofWeightN
      })

      // Add frame weight distributed equally to all corners
      const frameWeightPerCorner = frameWeightN / 4
      R1 += frameWeightPerCorner
      R2 += frameWeightPerCorner
      R3 += frameWeightPerCorner
      R4 += frameWeightPerCorner

      // Add frame weight to total applied load for stress/deflection calculations
      totalAppliedLoad += frameWeightN

      // Calculate critical beam length (longer of the two sides)
      const criticalBeamLength = Math.max(frameLengthM, frameWidthM)

      // For analysis, use the maximum corner reaction
      const maxCornerReaction = Math.max(R1, R2, R3, R4)
      
      // Calculate equivalent uniform load for critical beam analysis
      // This is used for stress calculations
      // Note: Each beam carries 1/4 of the total load
      loadPerBeam = totalAppliedLoad / 4
      const uniformLoadPerMeter = loadPerBeam / criticalBeamLength
      maxShearForce = (uniformLoadPerMeter * criticalBeamLength) / 2
      maxBendingMoment = (uniformLoadPerMeter * Math.pow(criticalBeamLength, 2)) / 8

      // Store individual corner reactions
      cornerReactionForce = maxCornerReaction
      cornerReactions = { R1, R2, R3, R4 }
      
      // Debug logging (can be removed in production)
      if (process.env.NODE_ENV === 'development') {
        console.log('Frame Weight Calculation:', {
          beamVolume: beamVolume,
          framePerimeter: framePerimeter,
          frameVolumeM3: frameVolumeM3,
          beamDensity: beamDensity,
          frameWeightN: frameWeightN,
          frameWeightKg: frameWeightN / 9.81,
          totalAppliedLoad: totalAppliedLoad,
          cornerReactions: { R1, R2, R3, R4 }
        })
      }
    }

    setFrameWeight(Number(frameWeightN.toFixed(2)))

    // Calculate cross-sectional properties for stress analysis
    const materialProps = material === "Custom" ? customMaterial : standardMaterials[material]
    let area: number, momentOfInertia: number, sectionModulus: number

    switch (beamCrossSection) {
      case "Rectangular":
        area = widthM * heightM
        momentOfInertia = (widthM * Math.pow(heightM, 3)) / 12
        sectionModulus = momentOfInertia / (heightM / 2)
        break
      case "I Beam":
        area = 2 * flangeWidthM * flangeThicknessM + (heightM - 2 * flangeThicknessM) * webThicknessM
        const I_total_flange = (flangeWidthM * Math.pow(flangeThicknessM, 3)) / 12
        const I_flange_parallel = flangeWidthM * flangeThicknessM * Math.pow((heightM - flangeThicknessM) / 2, 2)
        const I_web = (webThicknessM * Math.pow(heightM - 2 * flangeThicknessM, 3)) / 12
        momentOfInertia = 2 * (I_total_flange + I_flange_parallel) + I_web
        sectionModulus = momentOfInertia / (heightM / 2)
        break
      case "C Channel":
        area = 2 * flangeWidthM * flangeThicknessM + (heightM - 2 * flangeThicknessM) * webThicknessM
        const I_flange_c =
          (flangeWidthM * Math.pow(flangeThicknessM, 3)) / 12 +
          flangeWidthM * flangeThicknessM * Math.pow((heightM - flangeThicknessM) / 2, 2)
        const I_web_c = (webThicknessM * Math.pow(heightM - 2 * flangeThicknessM, 3)) / 12
        momentOfInertia = 2 * I_flange_c + I_web_c
        sectionModulus = momentOfInertia / (heightM / 2)
        break
      case "Circular":
        area = Math.PI * Math.pow(diameterM / 2, 2)
        momentOfInertia = (Math.PI * Math.pow(diameterM, 4)) / 64
        sectionModulus = momentOfInertia / (diameterM / 2)
        break
      default:
        area = widthM * heightM
        momentOfInertia = (widthM * Math.pow(heightM, 3)) / 12
        sectionModulus = momentOfInertia / (heightM / 2)
    }

    // Calculate stresses
    const maxNormalStress = maxBendingMoment / sectionModulus / 1e6 // Convert to MPa
    const maxShearStress = (1.5 * maxShearForce) / area / 1e6 // Convert to MPa

    // Calculate safety factor
    const safetyFactor = materialProps.yieldStrength > 0 ? materialProps.yieldStrength / maxNormalStress : 0

    // Calculate deflection
    const E = materialProps.elasticModulus * 1e9 // Convert GPa to Pa
    const criticalLength = analysisType === "Simple Beam" ? beamLengthM : Math.max(frameLengthM, frameWidthM)
    const maxDeflection = E > 0 ? (5 * totalAppliedLoad * Math.pow(criticalLength, 4)) / (384 * E * momentOfInertia) : 0

    setResults({
      maxShearForce: Number(maxShearForce.toFixed(2)),
      maxBendingMoment: Number(maxBendingMoment.toFixed(2)),
      maxNormalStress: Number(maxNormalStress.toFixed(2)),
      maxShearStress: Number(maxShearStress.toFixed(2)),
      safetyFactor: Number(safetyFactor.toFixed(2)),
      totalBeams: totalBeams,
      loadPerBeam: Number(loadPerBeam.toFixed(2)),
      momentOfInertia: Number(momentOfInertia.toFixed(6)),
      sectionModulus: Number(sectionModulus.toFixed(6)),
      cornerReactionForce: Number(cornerReactionForce.toFixed(2)),
      cornerReactions: {
        R1: Number(cornerReactions.R1.toFixed(2)),
        R2: Number(cornerReactions.R2.toFixed(2)),
        R3: Number(cornerReactions.R3.toFixed(2)),
        R4: Number(cornerReactions.R4.toFixed(2)),
      },
      maxDeflection: Number(maxDeflection.toFixed(6)),
      totalAppliedLoad: Number(totalAppliedLoad.toFixed(2)),
    })
  }, [
    analysisType,
    beamLength,
    frameLength,
    frameWidth,
    leftSupport,
    rightSupport,
    loads,
    sections,
    material,
    customMaterial,
    width,
    height,
    flangeWidth,
    flangeThickness,
    webThickness,
    diameter,
    beamDensity,
    beamCrossSection,
    providedFrameWeight,
    setFrameWeight,
    setResults,
    totalRoofWeight,
    totalRoofWeightUnit,
  ])

  return { calculateResults }
}

