/**
 * Cross-section properties, bending/shear stress, and yield-based safety factors.
 */

export type BeamCrossSectionKind = "Rectangular" | "I Beam" | "C Channel" | "Circular" | string

export interface SectionDimensionsM {
  widthM: number
  heightM: number
  flangeWidthM: number
  flangeThicknessM: number
  webThicknessM: number
  diameterM: number
}

export interface SectionProperties {
  area: number
  momentOfInertia: number
  sectionModulus: number
  /** Clear web height between flanges (I / C), else overall height */
  webHeightM: number
}

export interface StressSafetyResult {
  maxNormalStressMPa: number
  maxShearStressMPa: number
  safetyFactorBending: number
  safetyFactorShear: number
  /** Governing (minimum) yield-based safety factor */
  safetyFactor: number
  safetyFactorGoverning: "bending" | "shear" | "none"
}

/** Von Mises shear yield ≈ Fy / √3 */
export const SHEAR_YIELD_FACTOR = 1 / Math.sqrt(3)

export function computeSectionProperties(
  beamCrossSection: BeamCrossSectionKind,
  dims: SectionDimensionsM
): SectionProperties {
  const { widthM, heightM, flangeWidthM, flangeThicknessM, webThicknessM, diameterM } = dims

  switch (beamCrossSection) {
    case "Rectangular": {
      const area = widthM * heightM
      const momentOfInertia = (widthM * Math.pow(heightM, 3)) / 12
      const sectionModulus = heightM > 0 ? momentOfInertia / (heightM / 2) : 0
      return { area, momentOfInertia, sectionModulus, webHeightM: heightM }
    }
    case "I Beam": {
      const webHeightM = Math.max(0, heightM - 2 * flangeThicknessM)
      const area = 2 * flangeWidthM * flangeThicknessM + webHeightM * webThicknessM
      const I_flange =
        (flangeWidthM * Math.pow(flangeThicknessM, 3)) / 12 +
        flangeWidthM * flangeThicknessM * Math.pow((heightM - flangeThicknessM) / 2, 2)
      const I_web = (webThicknessM * Math.pow(webHeightM, 3)) / 12
      const momentOfInertia = 2 * I_flange + I_web
      const sectionModulus = heightM > 0 ? momentOfInertia / (heightM / 2) : 0
      return { area, momentOfInertia, sectionModulus, webHeightM }
    }
    case "C Channel": {
      // Strong-axis Ixx matches I-beam form when bf = overall flange width (incl. web)
      const webHeightM = Math.max(0, heightM - 2 * flangeThicknessM)
      const area = 2 * flangeWidthM * flangeThicknessM + webHeightM * webThicknessM
      const I_flange =
        (flangeWidthM * Math.pow(flangeThicknessM, 3)) / 12 +
        flangeWidthM * flangeThicknessM * Math.pow((heightM - flangeThicknessM) / 2, 2)
      const I_web = (webThicknessM * Math.pow(webHeightM, 3)) / 12
      const momentOfInertia = 2 * I_flange + I_web
      const sectionModulus = heightM > 0 ? momentOfInertia / (heightM / 2) : 0
      return { area, momentOfInertia, sectionModulus, webHeightM }
    }
    case "Circular": {
      const area = Math.PI * Math.pow(diameterM / 2, 2)
      const momentOfInertia = (Math.PI * Math.pow(diameterM, 4)) / 64
      const sectionModulus = diameterM > 0 ? momentOfInertia / (diameterM / 2) : 0
      return { area, momentOfInertia, sectionModulus, webHeightM: diameterM }
    }
    default: {
      const area = widthM * heightM
      const momentOfInertia = (widthM * Math.pow(heightM, 3)) / 12
      const sectionModulus = heightM > 0 ? momentOfInertia / (heightM / 2) : 0
      return { area, momentOfInertia, sectionModulus, webHeightM: heightM }
    }
  }
}

/**
 * Maximum shear stress (Pa) for the section type.
 * - Rectangular: τ_max = 1.5 V / A
 * - Circular: τ_max = 4/3 V / A
 * - I / C channel: average web shear τ = V / (tw · h_web)
 */
export function computeMaxShearStressPa(
  beamCrossSection: BeamCrossSectionKind,
  maxShearForceN: number,
  props: SectionProperties,
  webThicknessM: number
): number {
  const V = Math.abs(maxShearForceN)
  if (V <= 0) return 0

  switch (beamCrossSection) {
    case "Circular":
      return props.area > 0 ? ((4 / 3) * V) / props.area : 0
    case "I Beam":
    case "C Channel": {
      const webArea = webThicknessM * props.webHeightM
      return webArea > 0 ? V / webArea : props.area > 0 ? (1.5 * V) / props.area : 0
    }
    case "Rectangular":
    default:
      return props.area > 0 ? (1.5 * V) / props.area : 0
  }
}

export function computeStressAndSafety(
  maxBendingMomentNm: number,
  maxShearForceN: number,
  yieldStrengthMPa: number,
  beamCrossSection: BeamCrossSectionKind,
  props: SectionProperties,
  webThicknessM: number
): StressSafetyResult {
  const maxNormalStressMPa =
    props.sectionModulus > 0 ? maxBendingMomentNm / props.sectionModulus / 1e6 : 0
  const maxShearStressMPa =
    computeMaxShearStressPa(beamCrossSection, maxShearForceN, props, webThicknessM) / 1e6

  const safetyFactorBending =
    yieldStrengthMPa > 0 && maxNormalStressMPa > 0 ? yieldStrengthMPa / maxNormalStressMPa : 0

  const shearYieldMPa = yieldStrengthMPa * SHEAR_YIELD_FACTOR
  const safetyFactorShear =
    shearYieldMPa > 0 && maxShearStressMPa > 0 ? shearYieldMPa / maxShearStressMPa : 0

  const candidates: Array<{ kind: "bending" | "shear"; value: number }> = []
  if (safetyFactorBending > 0) candidates.push({ kind: "bending", value: safetyFactorBending })
  if (safetyFactorShear > 0) candidates.push({ kind: "shear", value: safetyFactorShear })

  if (candidates.length === 0) {
    return {
      maxNormalStressMPa,
      maxShearStressMPa,
      safetyFactorBending,
      safetyFactorShear,
      safetyFactor: 0,
      safetyFactorGoverning: "none",
    }
  }

  candidates.sort((a, b) => a.value - b.value)
  return {
    maxNormalStressMPa,
    maxShearStressMPa,
    safetyFactorBending,
    safetyFactorShear,
    safetyFactor: candidates[0].value,
    safetyFactorGoverning: candidates[0].kind,
  }
}
