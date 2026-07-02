import type { Load, Section, Results } from "../types"
import type { MaterialProperties } from "../types"
import { standardMaterials } from "../constants"
import { getLoadMagnitudeInN } from "./conversions"

interface LaTeXGenerationParams {
  analysisType: "Simple Beam" | "Base Frame"
  beamLength: number
  frameLength: number
  frameWidth: number
  leftSupport: number
  rightSupport: number
  beamCrossSection: string
  material: keyof typeof standardMaterials
  customMaterial: MaterialProperties
  loads: Load[]
  sections: Section[]
  results: Results
}

export function generateLaTeX(params: LaTeXGenerationParams): string {
  const {
    analysisType,
    beamLength,
    frameLength,
    frameWidth,
    leftSupport,
    rightSupport,
    beamCrossSection,
    material,
    customMaterial,
    loads,
    sections,
    results,
  } = params

  const now = new Date()
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })

  const materialProps = material === "Custom" ? customMaterial : standardMaterials[material]

  // Escape LaTeX special characters
  const escapeLaTeX = (text: string): string => {
    return text
      .replace(/\\/g, "\\textbackslash{}")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}")
      .replace(/\$/g, "\\$")
      .replace(/\&/g, "\\&")
      .replace(/\#/g, "\\#")
      .replace(/\^/g, "\\textasciicircum{}")
      .replace(/\_/g, "\\_")
      .replace(/\~/g, "\\textasciitilde{}")
      .replace(/\%/g, "\\%")
  }

  // Format numbers for LaTeX
  const formatNumber = (num: number, decimals: number = 1): string => {
    return num.toFixed(decimals)
  }

  let latex = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{geometry}
\\usepackage{booktabs}
\\usepackage{tabularx}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage{siunitx}
\\usepackage{fancyhdr}
\\usepackage{lastpage}

\\geometry{margin=2.5cm}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\small Structural Load Analysis Report}
\\fancyhead[R]{\\small ${escapeLaTeX(analysisType)}}
\\fancyfoot[C]{\\small Page \\thepage\\ of \\pageref{LastPage}}
\\fancyfoot[R]{\\small Generated: ${escapeLaTeX(dateStr)}}

\\title{${escapeLaTeX(analysisType === "Simple Beam" ? "Beam Analysis Report" : "Baseframe Analysis Report")}}
\\author{Structural Engineering Analysis \\& Design}
\\date{${escapeLaTeX(dateStr)}}

\\begin{document}

\\maketitle

\\section*{Report Information}
\\begin{tabular}{ll}
Date: & ${escapeLaTeX(dateStr)} \\\\
Time: & ${escapeLaTeX(timeStr)} \\\\
Prepared by: & hbradroc@uwo.ca \\\\
Analysis Type: & ${escapeLaTeX(analysisType)} \\\\
\\end{tabular}

\\section{Configuration}

\\begin{table}[h]
\\centering
\\begin{tabular}{ll}
\\toprule
\\textbf{Property} & \\textbf{Value} \\\\
\\midrule
`

  if (analysisType === "Simple Beam") {
    latex += `Beam Length & \\SI{${formatNumber(beamLength, 0)}}{\\milli\\meter} \\\\
Span Length & \\SI{${formatNumber(rightSupport - leftSupport, 0)}}{\\milli\\meter} \\\\
`
  } else {
    latex += `Frame Length & \\SI{${formatNumber(frameLength, 0)}}{\\milli\\meter} \\\\
Frame Width & \\SI{${formatNumber(frameWidth, 0)}}{\\milli\\meter} \\\\
`
  }

  latex += `Cross Section & ${escapeLaTeX(beamCrossSection)} \\\\
Material & ${escapeLaTeX(material)} \\\\
`

  if (materialProps.yieldStrength > 0) {
    latex += `Yield Strength & \\SI{${formatNumber(materialProps.yieldStrength, 1)}}{\\mega\\pascal} \\\\
`
  }

  latex += `\\bottomrule
\\end{tabular}
\\end{table}

\\section{Loading Conditions}

Total Applied Load: \\SI{${formatNumber(results.totalAppliedLoad, 1)}}{\\newton}

\\begin{table}[h]
\\centering
\\begin{tabular}{cccc}
\\toprule
\\textbf{Load \\#} & \\textbf{Type} & \\textbf{Description} & \\textbf{Total Load (N)} \\\\
\\midrule
`

  loads.forEach((load, index) => {
    let loadValue = 0
    let loadDescription = ""
    let loadType = load.type

    if (load.type === "Distributed Load") {
      if (analysisType === "Base Frame" && load.loadLength && load.loadWidth) {
        const loadArea = (load.loadLength * load.loadWidth) / 1_000_000
        loadValue = load.magnitude * loadArea
        loadDescription = `${formatNumber(load.loadLength, 0)}mm × ${formatNumber(load.loadWidth, 0)}mm`
      } else if (load.area) {
        loadValue = load.magnitude * load.area
        loadDescription = `\\SI{${formatNumber(load.area, 4)}}{\\meter\\squared} area`
      }
      loadType = `Distributed (\\SI{${formatNumber(load.magnitude, 1)}}{\\newton\\per\\meter\\squared})`
    } else if (load.type === "Uniform Load" && load.endPosition) {
      const loadLength = (load.endPosition - load.startPosition) / 1000
      loadValue = load.magnitude * loadLength
      loadDescription = `\\SI{${formatNumber(loadLength, 2)}}{\\meter} length`
      loadType = `Uniform (\\SI{${formatNumber(load.magnitude, 1)}}{\\newton\\per\\meter})`
    } else {
      loadValue = getLoadMagnitudeInN(load)
      loadDescription = `Position: \\SI{${formatNumber(load.startPosition, 0)}}{\\milli\\meter}`
      loadType = `Point Load`
    }

    latex += `${index + 1} & ${escapeLaTeX(loadType)} & ${escapeLaTeX(loadDescription)} & ${formatNumber(loadValue, 1)} \\\\
`
  })

  latex += `\\bottomrule
\\end{tabular}
\\end{table}
`

  if (analysisType === "Base Frame") {
    latex += `Load per Member: \\SI{${formatNumber(results.loadPerBeam, 1)}}{\\newton} (distributed equally among 4 members)

`
  }

  latex += `\\section{Analysis Results}

\\begin{table}[h]
\\centering
\\begin{tabular}{lcc}
\\toprule
\\textbf{Parameter} & \\textbf{Value} & \\textbf{Unit} \\\\
\\midrule
Maximum Shear Force & ${formatNumber(results.maxShearForce, 1)} & \\si{\\newton} \\\\
Maximum Bending Moment & ${formatNumber(results.maxBendingMoment, 1)} & \\si{\\newton\\meter} \\\\
Maximum Normal Stress & ${formatNumber(results.maxNormalStress, 1)} & \\si{\\mega\\pascal} \\\\
Safety Factor & ${formatNumber(results.safetyFactor, 2)} & -- \\\\
Maximum Deflection & ${formatNumber(results.maxDeflection * 1000, 2)} & \\si{\\milli\\meter} \\\\
`

  if (analysisType === "Base Frame") {
    latex += `Maximum Corner Reaction & ${formatNumber(results.cornerReactionForce, 1)} & \\si{\\newton} \\\\
`
  }

  latex += `\\bottomrule
\\end{tabular}
\\end{table}
`

  if (analysisType === "Base Frame" && results.cornerReactions) {
    latex += `\\subsection{Corner Reaction Forces}

\\begin{table}[h]
\\centering
\\begin{tabular}{cccc}
\\toprule
\\textbf{R$_1$ (Top-Left)} & \\textbf{R$_2$ (Top-Right)} & \\textbf{R$_3$ (Bottom-Left)} & \\textbf{R$_4$ (Bottom-Right)} \\\\
\\midrule
\\SI{${formatNumber(results.cornerReactions.R1, 2)}}{\\newton} & \\SI{${formatNumber(results.cornerReactions.R2, 2)}}{\\newton} & \\SI{${formatNumber(results.cornerReactions.R3, 2)}}{\\newton} & \\SI{${formatNumber(results.cornerReactions.R4, 2)}}{\\newton} \\\\
\\bottomrule
\\end{tabular}
\\end{table}

`
  }

  if (sections.length > 0) {
    latex += `\\section{Sections}

\\begin{table}[h]
\\centering
\\begin{tabular}{cccccc}
\\toprule
\\textbf{Section} & \\textbf{Start (mm)} & \\textbf{End (mm)} & \\textbf{Length (mm)} & \\textbf{Baseframe (kg)} & \\textbf{Roof (kg)} \\\\
\\midrule
`

    sections.forEach((section, index) => {
      const sectionLength = section.endPosition - section.startPosition
      const baseframe = section.baseframeWeight || 0
      const roof = section.roofWeight || 0
      const baseframeUnit = section.baseframeWeightUnit || "kg"
      const roofUnit = section.roofWeightUnit || "kg"
      
      // Convert to kg for display
      let baseframeKg = baseframe
      if (baseframeUnit === "N") {
        baseframeKg = baseframe / 9.81
      } else if (baseframeUnit === "lbs") {
        baseframeKg = baseframe / 2.20462
      }
      
      let roofKg = roof
      if (roofUnit === "N") {
        roofKg = roof / 9.81
      } else if (roofUnit === "lbs") {
        roofKg = roof / 2.20462
      }

      latex += `${escapeLaTeX(section.name || `Section ${index + 1}`)} & ${formatNumber(section.startPosition, 0)} & ${formatNumber(section.endPosition, 0)} & ${formatNumber(sectionLength, 0)} & ${formatNumber(baseframeKg, 1)} & ${formatNumber(roofKg, 1)} \\\\
`
    })

    latex += `\\bottomrule
\\end{tabular}
\\end{table}

`
  }

  latex += `\\section*{Notes}

\\begin{itemize}
\\item All calculations are based on linear elastic theory.
\\item Safety factor is calculated as the ratio of yield strength to maximum stress.
\\item For base frame analysis, corner reactions are calculated using the area method.
\\item Force diagrams show equivalent uniform load per beam for visualization purposes.
`

  if (sections.length > 0) {
    latex += `\\item Leg supports at section boundaries define multi-span beam spans for service-case V/M/deflection.
\\item Lifting lugs are screened separately (equal static share per lug; optional rated capacity).
`
  }

  latex += `\\end{itemize}

\\end{document}
`

  return latex
}

export function downloadLaTeX(latex: string, filename: string): void {
  const blob = new Blob([latex], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

