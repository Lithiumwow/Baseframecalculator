import { useCallback } from "react"
import type { Load, Section, Results } from "../types"
import type { MaterialProperties } from "../types"
import { standardMaterials } from "../constants"
import { validatePositive } from "../utils/validation"
import { getLoadMagnitudeInN, convertSectionWeightToN, getDistributedLoadTotalWeightN } from "../utils/conversions"
import { collectLegSupportPositionsMm } from "../utils/sectionSupports"
import { analyzeMultispanBeam, buildLongitudinalBeamLoads } from "../utils/multispanBeam"
import { analyzeSimpleBeam } from "../utils/simpleBeamAnalysis"
import { computeLiftingAnalysis } from "../utils/liftingAnalysis"
import { computeSectionProperties, computeStressAndSafety } from "../utils/sectionStress"

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
  otherComponentsWeight: number
  otherComponentsWeightUnit: "N" | "kg" | "lbs"
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
    otherComponentsWeight,
    otherComponentsWeightUnit,
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
    let longitudinalBendingMoment = 0
    let transverseBendingMoment = 0
    let governingBeamDirection: "longitudinal" | "transverse" = "longitudinal"
    let governingBeamSpanMm = 0
    let legSupportPositionsMm: number[] = []
    let usedMultispanAnalysis = false
    let liftingAnalysis: import("../types").LiftingAnalysis | null = null
    let multispanLineSegments: import("../utils/multispanBeam").LineLoadSegment[] = []
    let multispanPointLoads: import("../utils/multispanBeam").PointLoadOnBeam[] = []
    let longitudinalSpanM = 0
    let transverseSpanM = 0

    // Simple-beam peaks/deflection filled after section I is known
    let simpleBeamMaxDeflectionM = 0

    if (analysisType === "Simple Beam") {
      totalBeams = 1
      loadPerBeam = totalAppliedLoad
      frameWeightN = beamVolume * beamLengthM * beamDensity * 9.81
      governingBeamDirection = "longitudinal"
      governingBeamSpanMm = beamLengthM * 1000
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
          
          if (load.loadLength && load.loadWidth) {
            loadLengthMM = validatePositive(load.loadLength, 100)
            loadWeight = getDistributedLoadTotalWeightN(load)
            loadCenterX = (load.startPosition + loadLengthMM / 2) / 1000
            // Match diagram: footprint centered on frame width
            loadCenterY = frameWidthM / 2
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
        
        // Calculate roof weight for this section based on total roof weight and section length
        const sectionRoofWeightN = roofWeightPerMM * sectionLengthMM

        // Casing + roof at section centroid; baseframe handled once below as frame self-weight
        const totalSectionLoad = casingWeightN + sectionRoofWeightN

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

        totalAppliedLoad += casingWeightN
        totalAppliedLoad += sectionRoofWeightN
      })

      // Baseframe steel self-weight: once at section centroids for corners, once in total load
      if (totalFrameWeightFromSections > 0) {
        sections.forEach((section) => {
          const baseframeWeightN = convertSectionWeightToN(
            section.baseframeWeight || 0,
            section.baseframeWeightUnit || "kg"
          )
          if (baseframeWeightN <= 0) return

          const sectionStartM = section.startPosition / 1000
          const sectionEndM = section.endPosition / 1000
          const sectionCenterX = (sectionStartM + sectionEndM) / 2
          const sectionCenterY = frameWidthM / 2

          const areaR1 = (frameLengthM - sectionCenterX) * (frameWidthM - sectionCenterY)
          const areaR2 = sectionCenterX * (frameWidthM - sectionCenterY)
          const areaR3 = (frameLengthM - sectionCenterX) * sectionCenterY
          const areaR4 = sectionCenterX * sectionCenterY
          const totalArea = frameLengthM * frameWidthM

          if (totalArea > 0) {
            R1 += baseframeWeightN * (areaR1 / totalArea)
            R2 += baseframeWeightN * (areaR2 / totalArea)
            R3 += baseframeWeightN * (areaR3 / totalArea)
            R4 += baseframeWeightN * (areaR4 / totalArea)
          }
        })
      } else {
        const frameWeightPerCorner = frameWeightN / 4
        R1 += frameWeightPerCorner
        R2 += frameWeightPerCorner
        R3 += frameWeightPerCorner
        R4 += frameWeightPerCorner
      }

      totalAppliedLoad += frameWeightN

      // Other components (weather hood, connections, etc.) — lump at frame center
      const otherComponentsN = convertSectionWeightToN(
        otherComponentsWeight,
        otherComponentsWeightUnit
      )
      if (otherComponentsN > 0) {
        const centerX = frameLengthM / 2
        const centerY = frameWidthM / 2
        const areaR1 = (frameLengthM - centerX) * (frameWidthM - centerY)
        const areaR2 = centerX * (frameWidthM - centerY)
        const areaR3 = (frameLengthM - centerX) * centerY
        const areaR4 = centerX * centerY
        const totalArea = frameLengthM * frameWidthM
        if (totalArea > 0) {
          R1 += otherComponentsN * (areaR1 / totalArea)
          R2 += otherComponentsN * (areaR2 / totalArea)
          R3 += otherComponentsN * (areaR3 / totalArea)
          R4 += otherComponentsN * (areaR4 / totalArea)
        }
        totalAppliedLoad += otherComponentsN
      }

      longitudinalSpanM = frameLengthM
      transverseSpanM = frameWidthM

      // Each of 4 perimeter beams carries ~1/4 of total load (simplified frame model)
      loadPerBeam = totalAppliedLoad / 4

      longitudinalBendingMoment =
        (loadPerBeam / longitudinalSpanM) * Math.pow(longitudinalSpanM, 2) / 8
      transverseBendingMoment =
        (loadPerBeam / transverseSpanM) * Math.pow(transverseSpanM, 2) / 8

      governingBeamDirection =
        transverseBendingMoment > longitudinalBendingMoment ? "transverse" : "longitudinal"
      governingBeamSpanMm =
        (governingBeamDirection === "transverse" ? transverseSpanM : longitudinalSpanM) * 1000

      maxBendingMoment = Math.max(longitudinalBendingMoment, transverseBendingMoment)
      maxShearForce = loadPerBeam / 2

      const maxCornerReaction = Math.max(R1, R2, R3, R4)
      cornerReactionForce = maxCornerReaction
      cornerReactions = { R1, R2, R3, R4 }

      legSupportPositionsMm = collectLegSupportPositionsMm(sections, validFrameLength)
      const beamLoads = buildLongitudinalBeamLoads(
        loads,
        sections,
        validFrameLength,
        totalRoofWeight,
        totalRoofWeightUnit,
        otherComponentsWeight,
        otherComponentsWeightUnit
      )
      multispanLineSegments = beamLoads.lineSegments
      multispanPointLoads = beamLoads.pointLoads
      
      // Debug logging (can be removed in production)
      if (process.env.NODE_ENV === 'development') {
        console.log('Frame Weight Calculation:', {
          frameWeightN: frameWeightN,
          frameWeightKg: frameWeightN / 9.81,
          totalAppliedLoad: totalAppliedLoad,
          frameWidthM,
          frameLengthM,
          longitudinalBendingMoment,
          transverseBendingMoment,
          governingBeamDirection,
          cornerReactions: { R1, R2, R3, R4 }
        })
      }
    }

    setFrameWeight(Number(frameWeightN.toFixed(2)))

    // Calculate cross-sectional properties for stress analysis
    const materialProps = material === "Custom" ? customMaterial : standardMaterials[material]
    const sectionProps = computeSectionProperties(beamCrossSection, {
      widthM,
      heightM,
      flangeWidthM,
      flangeThicknessM,
      webThicknessM,
      diameterM,
    })
    const { momentOfInertia, sectionModulus } = sectionProps

    // Calculate deflection
    const E = materialProps.elasticModulus * 1e9 // Convert GPa to Pa
    let maxDeflection = 0
    if (analysisType === "Simple Beam") {
      if (momentOfInertia > 0) {
        const simpleBeam = analyzeSimpleBeam(
          validBeamLength,
          leftSupport,
          rightSupport,
          loads,
          E,
          momentOfInertia
        )
        simpleBeamMaxDeflectionM = simpleBeam.maxDeflectionM
        maxShearForce = simpleBeam.maxShearN
        maxBendingMoment = simpleBeam.maxMomentNm
        longitudinalBendingMoment = maxBendingMoment
      }
      maxDeflection = simpleBeamMaxDeflectionM
    } else if (E > 0) {
      const multispan =
        multispanLineSegments.length > 0
          ? analyzeMultispanBeam(
              legSupportPositionsMm,
              multispanLineSegments,
              multispanPointLoads,
              E,
              momentOfInertia
            )
          : null

      if (multispan) {
        usedMultispanAnalysis = true
        longitudinalBendingMoment = multispan.maxMomentNm
        maxShearForce = Math.max(maxShearForce, multispan.maxShearN)
        maxBendingMoment = Math.max(longitudinalBendingMoment, transverseBendingMoment)
        governingBeamDirection =
          transverseBendingMoment > longitudinalBendingMoment ? "transverse" : "longitudinal"
        governingBeamSpanMm =
          governingBeamDirection === "transverse"
            ? transverseSpanM * 1000
            : multispan.governingSpanMm || longitudinalSpanM * 1000

        liftingAnalysis = computeLiftingAnalysis(
          sections,
          validFrameLength,
          totalAppliedLoad,
          multispanLineSegments,
          multispanPointLoads,
          E,
          momentOfInertia
        )
      }

      const deflectionLong =
        (5 * loadPerBeam * Math.pow(frameLengthM, 3)) / (384 * E * momentOfInertia)
      const deflectionTrans =
        (5 * loadPerBeam * Math.pow(frameWidthM, 3)) / (384 * E * momentOfInertia)
      const uniformDeflection = Math.max(deflectionLong, deflectionTrans)
      maxDeflection = multispan
        ? Math.max(multispan.maxDeflectionMm / 1000, uniformDeflection)
        : uniformDeflection
    }

    const stressSafety = computeStressAndSafety(
      maxBendingMoment,
      maxShearForce,
      materialProps.yieldStrength,
      beamCrossSection,
      sectionProps,
      webThicknessM
    )

    setResults({
      maxShearForce: Number(maxShearForce.toFixed(2)),
      maxBendingMoment: Number(maxBendingMoment.toFixed(2)),
      maxNormalStress: Number(stressSafety.maxNormalStressMPa.toFixed(2)),
      maxShearStress: Number(stressSafety.maxShearStressMPa.toFixed(2)),
      safetyFactor: Number(stressSafety.safetyFactor.toFixed(2)),
      safetyFactorBending: Number(stressSafety.safetyFactorBending.toFixed(2)),
      safetyFactorShear: Number(stressSafety.safetyFactorShear.toFixed(2)),
      safetyFactorGoverning: stressSafety.safetyFactorGoverning,
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
      longitudinalBendingMoment: Number(longitudinalBendingMoment.toFixed(2)),
      transverseBendingMoment: Number(transverseBendingMoment.toFixed(2)),
      governingBeamDirection,
      governingBeamSpanMm: Number(governingBeamSpanMm.toFixed(1)),
      legSupportPositionsMm,
      usedMultispanAnalysis,
      liftingAnalysis,
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
    otherComponentsWeight,
    otherComponentsWeightUnit,
  ])

  return { calculateResults }
}

