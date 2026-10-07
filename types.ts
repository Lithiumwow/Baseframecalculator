export interface Section {
  id: string
  startPosition: number // mm
  endPosition: number // mm
  casingWeight: number // Total casing weight for this section
  casingWeightUnit: "N" | "kg" | "lbs"
  baseframeWeight: number // Baseframe weight for this section (kg)
  baseframeWeightUnit: "N" | "kg" | "lbs"
  roofWeight: number // Roof weight for this section (kg) - calculated from total roof weight
  roofWeightUnit: "N" | "kg" | "lbs"
  name?: string // Optional section name
  /** @deprecated Use hasLeg / hasLug — kept for imported sessions */
  supportType?: "leg" | "hook" | "none"
  /** Ground support beam at this section's start boundary (index > 0) */
  hasLeg?: boolean
  /** Lifting lug at this section's start boundary — implies hasLeg */
  hasLug?: boolean
  /** Optional rated lug capacity (N) for lift screening */
  lugCapacityN?: number
}

export interface LugPointSummary {
  positionMm: number
  sectionName: string
  shareForceN: number
  nearestLegMm: number
  distanceToLegMm: number
  lugCapacityN?: number
  capacityUtilization?: number
}

export interface LiftingAnalysis {
  lugPoints: LugPointSummary[]
  lugCount: number
  liftCaseMaxDeflectionMm: number
  maxLiftSpanMm: number
  equalSharePerLugN: number
}

export interface Load {
  type: "Point Load" | "Uniform Load" | "Distributed Load"
  magnitude: number
  startPosition: number
  endPosition?: number
  area?: number // For backward compatibility and simple beam
  loadLength?: number // Length of distributed load component (mm) - for baseframe
  loadWidth?: number // Width of distributed load component (mm) - for baseframe
  unit?: "N" | "kg" | "lbs" // Add unit field
  name?: string // Name/label for the load to display in diagrams
  sectionId?: string // Optional: associate load with a section
}

export interface MaterialProperties {
  yieldStrength: number
  elasticModulus: number
  density: number
  poissonsRatio: number
  thermalExpansion: number
}

export interface Results {
  maxShearForce: number
  maxBendingMoment: number
  maxNormalStress: number
  maxShearStress: number
  /** Governing yield-based safety factor = min(bending, shear) */
  safetyFactor: number
  /** Fy / σ_bending */
  safetyFactorBending?: number
  /** (Fy/√3) / τ */
  safetyFactorShear?: number
  /** Which limit state governs the reported safety factor */
  safetyFactorGoverning?: "bending" | "shear" | "none"
  totalBeams: number
  loadPerBeam: number
  momentOfInertia: number
  sectionModulus: number
  cornerReactionForce: number
  cornerReactions: { R1: number; R2: number; R3: number; R4: number }
  maxDeflection: number
  totalAppliedLoad: number
  /** Bending moment in longitudinal (length-direction) perimeter beams */
  longitudinalBendingMoment: number
  /** Bending moment in transverse (width-direction) perimeter beams */
  transverseBendingMoment: number
  /** Which perimeter beam direction governs stress/deflection */
  governingBeamDirection: "longitudinal" | "transverse"
  governingBeamSpanMm: number
  /** Leg support positions used for multi-span beam model (mm) */
  legSupportPositionsMm?: number[]
  /** True when V/M/deflection use multi-span model between legs */
  usedMultispanAnalysis?: boolean
  liftingAnalysis?: LiftingAnalysis | null
}

