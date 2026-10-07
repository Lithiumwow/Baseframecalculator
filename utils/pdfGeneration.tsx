import React from "react"
import { jsPDF } from "jspdf"
import type { Load, Section, Results } from "../types"
import type { MaterialProperties } from "../types"
import { standardMaterials } from "../constants"
import { getLoadMagnitudeInN, getDistributedLoadTotalWeightN } from "./conversions"
import type { COGResult } from "./cogCalculation"
import { renderAreaChartToPng } from "./chartToPng"
import { renderDiagramSvg, renderDiagramToPng } from "./renderDiagramToPng"
import { ensureNotoSansForCanvas, registerNotoSansPdfFonts, setPdfFont, type PdfFontStyle } from "./notoFonts"
import { svg2pdf } from "svg2pdf.js"
import { BeamDiagram, FrameDiagram, CornerLoadsDiagram } from "../components/diagrams"

interface PDFGenerationParams {
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
  cogResult?: COGResult
  shearForceData: Array<{ x: number; y: number }>
  bendingMomentData: Array<{ x: number; y: number }>
  deflectionData: Array<{ x: number; y: number }>
}

export async function generatePDF(params: PDFGenerationParams): Promise<void> {
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
    cogResult,
    shearForceData,
    bendingMomentData,
    deflectionData,
  } = params

  const pdf = new jsPDF()
  await ensureNotoSansForCanvas()
  await registerNotoSansPdfFonts(pdf)
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 25 // Increased margin for LaTeX style
  const contentWidth = pageWidth - 2 * margin

  // Noto Sans throughout the PDF report
  setPdfFont(pdf, "normal")

  // Helper function to add wrapped text
  const addWrappedText = (
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    fontSize = 10,
    fontStyle: PdfFontStyle = "normal",
  ): number => {
    pdf.setFontSize(fontSize)
    setPdfFont(pdf, fontStyle)
    const lines = pdf.splitTextToSize(text, maxWidth)
    pdf.text(lines, x, y)
    return y + lines.length * lineHeight
  }

  // LaTeX-style section headers (clean, minimal)
  const addSectionHeader = (title: string, x: number, y: number): number => {
    // Subtle underline instead of colored bar
    pdf.setDrawColor(0, 0, 0)
    pdf.setLineWidth(0.5)
    pdf.line(x, y + 2, x + contentWidth, y + 2)
    
    // Title text in sans-serif, bold
    pdf.setFontSize(12)
    setPdfFont(pdf, "bold")
    pdf.setTextColor(0, 0, 0)
    pdf.text(title, x, y)
    
    setPdfFont(pdf, "normal")
    return y + 8
  }

  // LaTeX-style subsection headers
  const addSubsectionHeader = (title: string, x: number, y: number): number => {
    pdf.setFontSize(11)
    setPdfFont(pdf, "bold")
    pdf.setTextColor(0, 0, 0)
    pdf.text(title, x, y)
    setPdfFont(pdf, "normal")
    return y + 6
  }

  // Helper to add a professional table with borders
  const addTable = (
    headers: string[],
    rows: string[][],
    startX: number,
    startY: number,
    colWidths: number[],
    rowHeight: number = 8,
  ): number => {
    const tableWidth = colWidths.reduce((a, b) => a + b, 0)
    
    // Draw table borders
    pdf.setDrawColor(0, 0, 0)
    pdf.setLineWidth(0.5)
    
    // Top border
    pdf.line(startX, startY, startX + tableWidth, startY)
    // Bottom border
    pdf.line(startX, startY + rowHeight * (rows.length + 1), startX + tableWidth, startY + rowHeight * (rows.length + 1))
    // Left and right borders
    pdf.line(startX, startY, startX, startY + rowHeight * (rows.length + 1))
    pdf.line(startX + tableWidth, startY, startX + tableWidth, startY + rowHeight * (rows.length + 1))
    
    // Header row
    setPdfFont(pdf, "bold")
    pdf.setFontSize(10)
    let currentX = startX
    headers.forEach((header, i) => {
      pdf.line(currentX, startY, currentX, startY + rowHeight * (rows.length + 1)) // Vertical line
      pdf.text(header, currentX + 3, startY + rowHeight - 3)
      currentX += colWidths[i]
    })
    
    // Header separator line
    pdf.line(startX, startY + rowHeight, startX + tableWidth, startY + rowHeight)
    
    // Data rows
    setPdfFont(pdf, "normal")
    pdf.setFontSize(9)
    rows.forEach((row, rowIndex) => {
      currentX = startX
      row.forEach((cell, colIndex) => {
        pdf.line(currentX, startY + rowHeight * (rowIndex + 1), currentX, startY + rowHeight * (rowIndex + 2)) // Vertical line
        pdf.text(cell, currentX + 3, startY + rowHeight * (rowIndex + 2) - 3)
        currentX += colWidths[colIndex]
      })
    })
    
    return startY + rowHeight * (rows.length + 1) + 10
  }

  /** Size diagrams to fill page width; shrink height if needed to fit remaining space */
  const computeDiagramSize = (origWidth: number, origHeight: number, yPos: number) => {
    const aspect = origHeight / origWidth
    let diagramWidth = contentWidth * 0.95
    let diagramHeight = diagramWidth * aspect
    const maxHeight = pageHeight - yPos - 45
    if (diagramHeight > maxHeight && maxHeight > 40) {
      diagramHeight = maxHeight
      diagramWidth = diagramHeight / aspect
    }
    return { width: diagramWidth, height: diagramHeight }
  }

  const embedDiagramImage = (
    img: string,
    origWidth: number,
    origHeight: number,
    yPos: number,
  ): { y: number; width: number; height: number } => {
    const { width: diagramWidth, height: diagramHeight } = computeDiagramSize(origWidth, origHeight, yPos)
    const diagramX = (pageWidth - diagramWidth) / 2
    pdf.setDrawColor(0, 0, 0)
    pdf.setLineWidth(0.5)
    pdf.rect(diagramX - 3, yPos - 3, diagramWidth + 6, diagramHeight + 6)
    pdf.addImage(img, "PNG", diagramX, yPos, diagramWidth, diagramHeight)
    return { y: yPos + diagramHeight + 12, width: diagramWidth, height: diagramHeight }
  }

  const embedChartImage = (
    img: string,
    yPos: number,
    origWidth = 900,
    origHeight = 320,
  ): number => {
    return embedDiagramImage(img, origWidth, origHeight, yPos).y
  }

  const embedSvgDiagram = async (
    element: React.ReactElement,
    origWidth: number,
    origHeight: number,
    yPos: number,
  ): Promise<number> => {
    const { width: diagramWidth, height: diagramHeight } = computeDiagramSize(origWidth, origHeight, yPos)
    const diagramX = (pageWidth - diagramWidth) / 2

    const host = document.createElement("div")
    host.style.position = "fixed"
    host.style.left = "0"
    host.style.top = "0"
    host.style.opacity = "0"
    host.style.pointerEvents = "none"
    host.style.zIndex = "-1"
    document.body.appendChild(host)

    try {
      const svg = await renderDiagramSvg(element)
      host.appendChild(svg)
      pdf.setDrawColor(0, 0, 0)
      pdf.setLineWidth(0.5)
      pdf.rect(diagramX - 3, yPos - 3, diagramWidth + 6, diagramHeight + 6)
      await svg2pdf(svg, pdf, {
        x: diagramX,
        y: yPos,
        width: diagramWidth,
        height: diagramHeight,
      })
      return yPos + diagramHeight + 12
    } catch (error) {
      console.warn("SVG embed failed, falling back to PNG rasterization:", error)
      const png = await renderDiagramToPng(element, origWidth, origHeight)
      return embedDiagramImage(png, origWidth, origHeight, yPos).y
    } finally {
      host.remove()
    }
  }

  // LaTeX-style Title Page - Clean and minimal
  // Title in large serif font
  pdf.setFontSize(18)
  setPdfFont(pdf, "bold")
  pdf.setTextColor(0, 0, 0)
  pdf.text(analysisType === "Simple Beam" ? "Beam Analysis Report" : "Baseframe Analysis Report", pageWidth / 2, 50, { align: "center" })
  
  // Subtitle
  pdf.setFontSize(12)
  setPdfFont(pdf, "normal")
  pdf.setTextColor(60, 60, 60)
  pdf.text("Structural Engineering Analysis", pageWidth / 2, 65, { align: "center" })
  
  // Horizontal rule
  pdf.setDrawColor(0, 0, 0)
  pdf.setLineWidth(0.5)
  pdf.line(margin, 80, pageWidth - margin, 80)
  
  // Date and time
  pdf.setFontSize(10)
  setPdfFont(pdf, "normal")
  pdf.setTextColor(0, 0, 0)
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
  
  // Information in a clean table format
  const infoY = 100
  setPdfFont(pdf, "bold")
  pdf.setFontSize(10)
  pdf.text("Report Information", margin, infoY)
  setPdfFont(pdf, "normal")
  pdf.setFontSize(9)
  pdf.text(`Date: ${dateStr}`, margin, infoY + 10)
  pdf.text(`Time: ${timeStr}`, margin, infoY + 18)
  pdf.text(`Prepared by: hbradroc@uwo.ca`, margin, infoY + 26)
  pdf.text(`Analysis Type: ${analysisType}`, margin, infoY + 34)
  
  // Footer line
  pdf.setDrawColor(0, 0, 0)
  pdf.setLineWidth(0.5)
  pdf.line(margin, pageHeight - 30, pageWidth - margin, pageHeight - 30)

  // Add a new page for the first section
  pdf.addPage()
  let yOffset = 40

  // 1. CONFIGURATION SECTION
  yOffset = addSectionHeader("1. Configuration", margin, yOffset)
  yOffset += 8

  // Configuration data in table format
  const configData: string[][] = []
  if (analysisType === "Simple Beam") {
    configData.push(["Beam Length", `${beamLength} mm`])
    configData.push(["Span Length", `${rightSupport - leftSupport} mm`])
  } else {
    configData.push(["Frame Length", `${frameLength} mm`])
    configData.push(["Frame Width", `${frameWidth} mm`])
  }
  configData.push(["Cross Section", beamCrossSection])
  configData.push(["Material", material])
  
  const materialProps = material === "Custom" ? customMaterial : standardMaterials[material]
  if (materialProps.yieldStrength > 0) {
    configData.push(["Yield Strength", `${materialProps.yieldStrength} MPa`])
  }

  const configColWidths = [contentWidth * 0.4, contentWidth * 0.6]
  yOffset = addTable(
    ["Property", "Value"],
    configData,
    margin,
    yOffset,
    configColWidths,
    7
  )

  // 2. LOADING CONDITIONS
  if (yOffset > pageHeight - 80) {
    pdf.addPage()
    yOffset = 40
  }
  yOffset += 5
  yOffset = addSectionHeader("2. Loading Conditions", margin, yOffset)
  yOffset += 8

  setPdfFont(pdf, "normal")
  pdf.setFontSize(10)
  pdf.text(`Total Applied Load: ${results.totalAppliedLoad.toFixed(1)} N`, margin, yOffset)
  yOffset += 10

  // Loads table
  const loadTableData: string[][] = []
  loads.forEach((load, index) => {
    let loadValue = 0
    let loadDescription = ""
    let loadType = load.type

    if (load.type === "Distributed Load") {
      loadValue = getDistributedLoadTotalWeightN(load)
      if (analysisType === "Base Frame" && load.loadLength && load.loadWidth) {
        loadDescription = `${load.loadLength} mm x ${load.loadWidth} mm`
        if (load.unit === "lbs" || load.unit === "kg") {
          loadType = `Distributed (${load.magnitude} ${load.unit})`
        } else {
          loadType = `Distributed (${load.magnitude} N/m2)`
        }
      } else if (load.area) {
        loadDescription = `${load.area} m2`
        loadType = `Distributed (${load.magnitude} N/m2)`
      }
    } else if (load.type === "Uniform Load" && load.endPosition) {
      const loadLength = (load.endPosition - load.startPosition) / 1000
      loadValue = load.magnitude * loadLength
      loadDescription = `${loadLength.toFixed(2)} m`
      loadType = `Uniform (${load.magnitude} N/m)`
    } else {
      loadValue = getLoadMagnitudeInN(load)
      loadDescription = `${load.startPosition} mm`
      loadType = `Point Load`
    }

    loadTableData.push([
      `${index + 1}`,
      loadType,
      loadDescription,
      `${loadValue.toFixed(1)} N`
    ])
  })

  const loadColWidths = [contentWidth * 0.1, contentWidth * 0.35, contentWidth * 0.25, contentWidth * 0.3]
  yOffset = addTable(
    ["#", "Type", "Description", "Total Load (N)"],
    loadTableData,
    margin,
    yOffset,
    loadColWidths,
    8
  )

  if (analysisType === "Base Frame") {
    setPdfFont(pdf, "normal")
    pdf.setFontSize(9)
    pdf.text(`Load per Member: ${results.loadPerBeam.toFixed(1)} N (distributed equally among 4 members)`, margin, yOffset)
    yOffset += 8
  }

  if (yOffset > pageHeight - 60) {
    pdf.addPage()
    yOffset = 40
  }

  // 3. ANALYSIS RESULTS
  yOffset += 10
  yOffset = addSectionHeader("3. Analysis Results", margin, yOffset)
  yOffset += 8

  const resultsData: string[][] = [
    ["Maximum Shear Force", `${results.maxShearForce.toFixed(1)}`, "N"],
    ["Maximum Bending Moment", `${results.maxBendingMoment.toFixed(1)}`, "N·m"],
    ["Maximum Normal Stress", `${results.maxNormalStress.toFixed(1)}`, "MPa"],
    ["Maximum Shear Stress", `${results.maxShearStress.toFixed(1)}`, "MPa"],
    [
      "Safety Factor (governing)",
      `${results.safetyFactor.toFixed(2)}${
        results.safetyFactorGoverning && results.safetyFactorGoverning !== "none"
          ? ` [${results.safetyFactorGoverning}]`
          : ""
      }`,
      "-",
    ],
    [
      "SF bending / shear",
      `${(results.safetyFactorBending ?? 0).toFixed(2)} / ${(results.safetyFactorShear ?? 0).toFixed(2)}`,
      "-",
    ],
    ["Maximum Deflection", `${(results.maxDeflection * 1000).toFixed(2)}`, "mm"],
  ]

  if (analysisType === "Base Frame") {
    resultsData.push(["Maximum Corner Reaction", `${results.cornerReactionForce.toFixed(1)}`, "N"])
  }

  // Better column widths to fit within page
  const resultsColWidths = [contentWidth * 0.55, contentWidth * 0.25, contentWidth * 0.2]
  yOffset = addTable(
    ["Parameter", "Value", "Unit"],
    resultsData,
    margin,
    yOffset,
    resultsColWidths,
    7
  )

  if (analysisType === "Base Frame" && cogResult) {
    if (yOffset + 40 > pageHeight - 60) {
      pdf.addPage()
      yOffset = 40
    }
    yOffset += 5
    yOffset = addSubsectionHeader("Center of Gravity (COG)", margin, yOffset)
    yOffset += 5

    const cogData: string[][] = [
      ["COG X (length)", `${cogResult.cogX.toFixed(0)} mm`, `${(cogResult.cogXRatio * 100).toFixed(1)}%`],
      ["COG Y (width)", `${cogResult.cogY.toFixed(0)} mm`, `${(cogResult.cogYRatio * 100).toFixed(1)}%`],
      [
        "Total weight (COG basis)",
        `${cogResult.totalWeight.toFixed(1)} ${cogResult.totalWeightUnit}`,
        "-",
      ],
    ]
    yOffset = addTable(
      ["Parameter", "Value", "Ratio / Unit"],
      cogData,
      margin,
      yOffset,
      [contentWidth * 0.45, contentWidth * 0.35, contentWidth * 0.2],
      7,
    )
  }

  // Corner reactions table for Base Frame
  if (analysisType === "Base Frame" && results.cornerReactions) {
    if (yOffset + 50 > pageHeight - 60) {
      pdf.addPage()
      yOffset = 40
    }
    
    yOffset += 5
    yOffset = addSubsectionHeader("Corner Reaction Forces", margin, yOffset)
    yOffset += 5
    
    // Format corner reactions with proper labels
    const cornerData: string[][] = [
      [
        `R1 (Top-Left): ${results.cornerReactions.R1.toFixed(1)} N`,
        `R2 (Top-Right): ${results.cornerReactions.R2.toFixed(1)} N`,
      ],
      [
        `R3 (Bottom-Left): ${results.cornerReactions.R3.toFixed(1)} N`,
        `R4 (Bottom-Right): ${results.cornerReactions.R4.toFixed(1)} N`,
      ],
    ]
    
    // Use 2 columns instead of 4 to fit better
    const cornerColWidths = [contentWidth * 0.5, contentWidth * 0.5]
    yOffset = addTable(
      ["Corner", "Corner"],
      cornerData,
      margin,
      yOffset,
      cornerColWidths,
      8
    )
  }

  // 4. STRUCTURAL DIAGRAMS (rendered off-screen — not scraped from the page)
  pdf.addPage()
  yOffset = 40
  yOffset = addSectionHeader("4. Structural Diagrams", margin, yOffset)
  yOffset += 10

  yOffset = addSubsectionHeader("4.1 Structure Layout", margin, yOffset)
  yOffset += 8

  try {
    if (analysisType === "Simple Beam") {
      if (yOffset + 80 > pageHeight - 40) {
        pdf.addPage()
        yOffset = 40
      }
      yOffset = await embedSvgDiagram(
        <BeamDiagram
          beamLength={beamLength}
          leftSupport={leftSupport}
          rightSupport={rightSupport}
          loads={loads}
        />,
        500,
        250,
        yOffset,
      )
    } else {
      if (yOffset + 80 > pageHeight - 40) {
        pdf.addPage()
        yOffset = 40
      }
      yOffset = await embedSvgDiagram(
        <FrameDiagram
          frameLength={frameLength}
          frameWidth={frameWidth}
          loads={loads}
          sections={sections}
          cogX={cogResult?.cogX}
          cogY={cogResult?.cogY}
        />,
        500,
        450,
        yOffset,
      )
    }
  } catch (error) {
    console.error("Error rendering structure diagram:", error)
    yOffset = addWrappedText(
      `[Structure Diagram Error: ${error instanceof Error ? error.message : "Unknown error"}]`,
      margin,
      yOffset,
      contentWidth,
      6,
      9,
    )
    yOffset += 10
  }

  if (analysisType === "Base Frame") {
    try {
      const requiredHeight = (contentWidth * 0.95 * 520) / 700 + 30
      if (yOffset + requiredHeight > pageHeight - 40) {
        pdf.addPage()
        yOffset = 40
      }
      yOffset = addSubsectionHeader("4.2 Corner Loads Analysis", margin, yOffset)
      yOffset += 8

      yOffset = await embedSvgDiagram(
        <CornerLoadsDiagram
          frameLength={frameLength}
          frameWidth={frameWidth}
          loads={loads}
          cornerReactionForce={results.cornerReactionForce}
          cornerReactions={results.cornerReactions}
          sections={sections}
        />,
        700,
        520,
        yOffset,
      )
    } catch (error) {
      console.error("Error rendering corner loads diagram:", error)
      yOffset = addWrappedText(
        `[Corner Loads Diagram Error: ${error instanceof Error ? error.message : "Unknown error"}]`,
        margin,
        yOffset,
        contentWidth,
        6,
        9,
      )
      yOffset += 10
    }
  }

  // 5. FORCE DIAGRAMS (rendered from chart data — not scraped from Recharts DOM)
  pdf.addPage()
  yOffset = 40
  yOffset = addSectionHeader("5. Force Diagrams", margin, yOffset)
  yOffset += 10

  const addForceChart = async (
    title: string,
    data: Array<{ x: number; y: number }>,
    color: string,
    yLabel: string,
  ) => {
    yOffset = addSubsectionHeader(title, margin, yOffset)
    yOffset += 8

    if (yOffset + 80 > pageHeight - 40) {
      pdf.addPage()
      yOffset = 40
      yOffset = addSubsectionHeader(title, margin, yOffset)
      yOffset += 8
    }

    const chartImg = await renderAreaChartToPng(data, {
      width: 900,
      height: 320,
      xLabel: "Position (mm)",
      yLabel,
      color,
    })
    yOffset = embedChartImage(chartImg, yOffset, 900, 320) + 3
  }

  await addForceChart("5.1 Shear Force Diagram", shearForceData, "#6366f1", "Shear Force (N)")

  if (yOffset > pageHeight - 100) {
    pdf.addPage()
    yOffset = 40
  }
  await addForceChart("5.2 Bending Moment Diagram", bendingMomentData, "#16a34a", "Bending Moment (N·m)")

  if (yOffset > pageHeight - 100) {
    pdf.addPage()
    yOffset = 40
  }
  await addForceChart("5.3 Deflection Diagram", deflectionData, "#ea580c", "Deflection (mm)")

  // LaTeX-style headers and footers on all pages
  const pageCount = pdf.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i)
    
    // Header line (subtle)
    pdf.setDrawColor(0, 0, 0)
    pdf.setLineWidth(0.3)
    pdf.line(margin, 20, pageWidth - margin, 20)
    
    // Header text
    pdf.setFontSize(8)
    setPdfFont(pdf, "normal")
    pdf.setTextColor(0, 0, 0)
    pdf.text("Structural Load Analysis Report", margin, 16)
    pdf.text(analysisType, pageWidth - margin, 16, { align: "right" })
    
    // Footer line (subtle)
    pdf.setDrawColor(0, 0, 0)
    pdf.setLineWidth(0.3)
    pdf.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15)
    
    // Footer text
    pdf.setFontSize(8)
    setPdfFont(pdf, "italic")
    pdf.setTextColor(0, 0, 0)
    pdf.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: "center" })
    pdf.text(`Generated: ${now.toLocaleDateString()}`, pageWidth - margin, pageHeight - 10, { align: "right" })
    
    // Reset text color
    pdf.setTextColor(0, 0, 0)
  }

  // Save the PDF
  const fileName = `${analysisType.toLowerCase().replace(" ", "_")}_analysis_report_${new Date().toISOString().split("T")[0]}.pdf`
  pdf.save(fileName)
}
