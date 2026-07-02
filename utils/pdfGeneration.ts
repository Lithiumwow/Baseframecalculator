import { jsPDF } from "jspdf"
import type { Load, Section, Results } from "../types"
import type { MaterialProperties } from "../types"
import { standardMaterials } from "../constants"
import { svgToPngDataUrl } from "./svgToPng"
import { getLoadMagnitudeInN, getDistributedLoadTotalWeightN } from "./conversions"
import type { COGResult } from "./cogCalculation"

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
  } = params

  // Initial wait to ensure page is fully loaded
  await new Promise(resolve => setTimeout(resolve, 500))

  const pdf = new jsPDF()
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 25 // Increased margin for LaTeX style
  const contentWidth = pageWidth - 2 * margin

  // LaTeX-style fonts: Times Roman for body, Helvetica for headers
  pdf.setFont("times", "normal") // Serif font for body text

  // Helper function to add wrapped text with LaTeX-style formatting
  const addWrappedText = (
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    fontSize = 10,
    fontStyle: "normal" | "bold" | "italic" = "normal",
  ): number => {
    pdf.setFontSize(fontSize)
    pdf.setFont("times", fontStyle)
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
    pdf.setFont("helvetica", "bold")
    pdf.setTextColor(0, 0, 0)
    pdf.text(title, x, y)
    
    // Reset to serif for body
    pdf.setFont("times", "normal")
    return y + 8
  }

  // LaTeX-style subsection headers
  const addSubsectionHeader = (title: string, x: number, y: number): number => {
    pdf.setFontSize(11)
    pdf.setFont("helvetica", "bold")
    pdf.setTextColor(0, 0, 0)
    pdf.text(title, x, y)
    pdf.setFont("times", "normal")
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
    pdf.setFont("helvetica", "bold")
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
    pdf.setFont("times", "normal")
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

  // Helper to capture a DOM node as PNG using svgToPngDataUrl
  const captureSVGAsImage = async (svgId: string, fallbackWidth: number, fallbackHeight: number) => {
    // Wait a bit for any pending renders
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Try to find the SVG element - multiple strategies
    let svg = document.getElementById(svgId) as SVGSVGElement | null
    
    // Strategy 1: Direct ID lookup
    if (!svg) {
      svg = document.querySelector(`svg#${svgId}`) as SVGSVGElement | null
    }
    
    // Strategy 2: Search all SVGs
    if (!svg) {
      const allSvgs = document.querySelectorAll('svg')
      for (const s of allSvgs) {
        if (s.id === svgId || s.getAttribute('id') === svgId) {
          svg = s as SVGSVGElement
          break
        }
      }
    }
    
    // Strategy 3: Find by partial ID match
    if (!svg) {
      const allSvgs = document.querySelectorAll('svg[id]')
      for (const s of allSvgs) {
        const id = s.getAttribute('id') || ''
        if (id.includes(svgId.replace('-', '')) || svgId.includes(id.replace('-', ''))) {
          svg = s as SVGSVGElement
          break
        }
      }
    }
    
    if (!svg) {
      console.error(`SVG with id '${svgId}' not found in DOM. Available SVGs:`, 
        Array.from(document.querySelectorAll('svg[id]')).map(s => s.id))
      throw new Error(`SVG with id '${svgId}' not found in DOM. Make sure the diagram is visible before generating PDF.`)
    }
    
    // Ensure SVG and all parents are visible
    let element: HTMLElement | null = svg
    while (element) {
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        element.style.display = 'block'
        element.style.visibility = 'visible'
        element.style.opacity = '1'
      }
      element = element.parentElement
    }
    
    // Scroll into view and wait for render
    svg.scrollIntoView({ behavior: 'instant', block: 'center' })
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Force multiple reflows to ensure rendering
    void svg.offsetHeight
    void svg.offsetWidth
    await new Promise(resolve => setTimeout(resolve, 300))
    void svg.getBoundingClientRect()
    await new Promise(resolve => setTimeout(resolve, 300))
    
    // Prefer explicit SVG attributes for capture resolution (CSS scaling can distort)
    let width = fallbackWidth
    let height = fallbackHeight

    if (svg.hasAttribute("width")) {
      const attrWidth = Number(svg.getAttribute("width"))
      if (!isNaN(attrWidth) && attrWidth > 0) width = attrWidth
    }
    if (svg.hasAttribute("height")) {
      const attrHeight = Number(svg.getAttribute("height"))
      if (!isNaN(attrHeight) && attrHeight > 0) height = attrHeight
    }

    if (width <= 0 || height <= 0) {
      const rect = svg.getBoundingClientRect()
      if (rect.width > 0) width = rect.width
      if (rect.height > 0) height = rect.height
    }

    if (width <= 0) width = fallbackWidth
    if (height <= 0) height = fallbackHeight
    
    try {
      const dataUrl = await svgToPngDataUrl(svg, width, height)
      if (!dataUrl || dataUrl.length === 0) {
        throw new Error("Empty data URL returned from SVG conversion")
      }
      console.log(`Successfully captured SVG ${svgId}, data URL length: ${dataUrl.length}`)
      return dataUrl
    } catch (error) {
      console.error(`Failed to convert SVG ${svgId} to PNG:`, error)
      throw error
    }
  }

  // LaTeX-style Title Page - Clean and minimal
  // Title in large serif font
  pdf.setFontSize(18)
  pdf.setFont("times", "bold")
  pdf.setTextColor(0, 0, 0)
  pdf.text(analysisType === "Simple Beam" ? "Beam Analysis Report" : "Baseframe Analysis Report", pageWidth / 2, 50, { align: "center" })
  
  // Subtitle
  pdf.setFontSize(12)
  pdf.setFont("times", "normal")
  pdf.setTextColor(60, 60, 60)
  pdf.text("Structural Engineering Analysis", pageWidth / 2, 65, { align: "center" })
  
  // Horizontal rule
  pdf.setDrawColor(0, 0, 0)
  pdf.setLineWidth(0.5)
  pdf.line(margin, 80, pageWidth - margin, 80)
  
  // Date and time
  pdf.setFontSize(10)
  pdf.setFont("times", "normal")
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
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(10)
  pdf.text("Report Information", margin, infoY)
  pdf.setFont("times", "normal")
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

  pdf.setFont("times", "normal")
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
    pdf.setFont("times", "normal")
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
    ["Safety Factor", `${results.safetyFactor.toFixed(2)}`, "-"],
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

  // 4. STRUCTURAL DIAGRAMS
  // Find and scroll to diagrams section to ensure they're rendered
  // First, try to find the Structural Diagrams heading
  const allHeadings = Array.from(document.querySelectorAll('h2, h3'))
  const diagramsHeading = allHeadings.find(el => 
    el.textContent?.toLowerCase().includes('structural') || 
    el.textContent?.toLowerCase().includes('diagram')
  )
  
  if (diagramsHeading) {
    (diagramsHeading as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'start' })
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  // Also try to find and scroll to the actual SVG elements
  const targetSvgIds = analysisType === "Simple Beam" 
    ? ["beam-structure-diagram"]
    : ["frame-structure-diagram", "corner-loads-diagram"]
  
  for (const svgId of targetSvgIds) {
    const svg = document.getElementById(svgId) || 
                document.querySelector(`svg#${svgId}`) ||
                Array.from(document.querySelectorAll('svg')).find(s => s.id === svgId)
    if (svg) {
      (svg as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' })
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  
  // Final wait to ensure everything is rendered
  await new Promise(resolve => setTimeout(resolve, 500))
  
  pdf.addPage()
  yOffset = 40
  yOffset = addSectionHeader("4. Structural Diagrams", margin, yOffset)
  yOffset += 10

  // Structure Diagram
  yOffset = addSubsectionHeader("4.1 Structure Layout", margin, yOffset)
  yOffset += 8
  let structureImg: string | null = null
  try {
    if (analysisType === "Simple Beam") {
      // Wait a bit to ensure page is ready
      await new Promise(resolve => setTimeout(resolve, 200))
      
      let svg = document.getElementById("beam-structure-diagram") as SVGSVGElement | null
      if (!svg) {
        // Try alternative search
        const allSvgs = document.querySelectorAll('svg[id="beam-structure-diagram"]')
        if (allSvgs.length > 0) {
          svg = allSvgs[0] as SVGSVGElement
        }
      }
      
      if (!svg) {
        console.warn("Beam Structure Diagram not found, adding placeholder text")
        yOffset = addWrappedText("[Beam Structure Diagram - Not found in DOM. Please ensure the diagram is visible before generating PDF.]", margin, yOffset, contentWidth, 6, 9)
        yOffset += 10
      } else {
        const origWidth = svg.hasAttribute("width") ? Number(svg.getAttribute("width")) : 500
        const origHeight = svg.hasAttribute("height") ? Number(svg.getAttribute("height")) : 250
        structureImg = await captureSVGAsImage("beam-structure-diagram", origWidth, origHeight)
        if (!structureImg) {
          yOffset = addWrappedText("[Beam Structure Diagram - Unable to capture]", margin, yOffset, contentWidth, 6, 9)
          yOffset += 10
        } else {
          if (yOffset + 80 > pageHeight - 40) {
            pdf.addPage()
            yOffset = 40
          }
          yOffset = embedDiagramImage(structureImg, origWidth, origHeight, yOffset).y
        }
      }
    } else {
      // Wait a bit to ensure page is ready
      await new Promise(resolve => setTimeout(resolve, 200))
      
      let frameSvg = document.getElementById("frame-structure-diagram") as SVGSVGElement | null
      if (!frameSvg) {
        // Try alternative search
        const allSvgs = document.querySelectorAll('svg[id="frame-structure-diagram"]')
        if (allSvgs.length > 0) {
          frameSvg = allSvgs[0] as SVGSVGElement
        }
      }
      
      if (!frameSvg) {
        console.warn("Frame Structure Diagram not found, adding placeholder text")
        yOffset = addWrappedText("[Frame Structure Diagram - Not found in DOM. Please ensure the diagram is visible before generating PDF.]", margin, yOffset, contentWidth, 6, 9)
        yOffset += 10
      } else {
        // Use the improved capture function
        const origWidth = frameSvg.hasAttribute("width") ? Number(frameSvg.getAttribute("width")) : 500
        const origHeight = frameSvg.hasAttribute("height") ? Number(frameSvg.getAttribute("height")) : 450
        structureImg = await captureSVGAsImage("frame-structure-diagram", origWidth, origHeight)
        if (!structureImg) {
          yOffset = addWrappedText("[Frame Structure Diagram - Unable to capture]", margin, yOffset, contentWidth, 6, 9)
          yOffset += 10
        } else {
          if (yOffset + 80 > pageHeight - 40) {
            pdf.addPage()
            yOffset = 40
          }
          yOffset = embedDiagramImage(structureImg, origWidth, origHeight, yOffset).y
        }
      }
    }
  } catch (error) {
    console.error("Error capturing structure diagram:", error)
    yOffset = addWrappedText(`[Structure Diagram Error: ${error instanceof Error ? error.message : 'Unknown error'}]`, margin, yOffset, contentWidth, 6, 9)
    yOffset += 10
  }

  // Corner Loads Diagram (for Base Frame only)
  if (analysisType === "Base Frame") {
    try {
      // Wait a bit to ensure page is ready
      await new Promise(resolve => setTimeout(resolve, 200))
      
      let svg = document.getElementById("corner-loads-diagram") as SVGSVGElement | null
      if (!svg) {
        // Try alternative search
        const allSvgs = document.querySelectorAll('svg[id="corner-loads-diagram"]')
        if (allSvgs.length > 0) {
          svg = allSvgs[0] as SVGSVGElement
        }
      }
      
      if (!svg) {
        console.warn("Corner Loads Diagram not found, adding placeholder text")
        yOffset = addWrappedText("[Corner Loads Diagram - Not found in DOM. Please ensure the diagram is visible before generating PDF.]", margin, yOffset, contentWidth, 6, 9)
        yOffset += 10
      } else {
        const origWidth = svg.hasAttribute("width") ? Number(svg.getAttribute("width")) : 700
        const origHeight = svg.hasAttribute("height") ? Number(svg.getAttribute("height")) : 520
        const requiredHeight = (contentWidth * 0.95 * origHeight) / origWidth + 30
        if (yOffset + requiredHeight > pageHeight - 40) {
          pdf.addPage()
          yOffset = 40
        }
        yOffset = addSubsectionHeader("4.2 Corner Loads Analysis", margin, yOffset)
        yOffset += 8
        const cornerImg = await captureSVGAsImage("corner-loads-diagram", origWidth, origHeight)
        if (cornerImg) {
          yOffset = embedDiagramImage(cornerImg, origWidth, origHeight, yOffset).y
        } else {
          yOffset = addWrappedText("[Corner Loads Diagram - Unable to capture]", margin, yOffset, contentWidth, 6, 9)
          yOffset += 10
        }
      }
    } catch (error) {
      console.error("Error capturing corner loads diagram:", error)
      yOffset = addWrappedText(`[Corner Loads Diagram Error: ${error instanceof Error ? error.message : 'Unknown error'}]`, margin, yOffset, contentWidth, 6, 9)
      yOffset += 10
    }
  }

  // 5. FORCE DIAGRAMS
  pdf.addPage()
  yOffset = 40
  yOffset = addSectionHeader("5. Force Diagrams", margin, yOffset)
  yOffset += 10

  // Helper function for force diagrams
  const addForceDiagram = async (diagramId: string, title: string, yPos: number): Promise<number> => {
    yPos = addSubsectionHeader(title, margin, yPos)
    yPos += 8
    try {
      const container = document.getElementById(diagramId)
      if (!container) throw new Error(`${title} container not found in DOM`)
      container.scrollIntoView({ behavior: "instant", block: "center" })
      await new Promise(resolve => setTimeout(resolve, 800))
      const svg =
        (container.querySelector("svg") as SVGSVGElement | null) ||
        (container.querySelector("div > svg") as SVGSVGElement | null)
      if (!svg) throw new Error(`${title} SVG not found in DOM`)

      const origWidth = svg.hasAttribute("width")
        ? Number(svg.getAttribute("width"))
        : svg.getBoundingClientRect().width || 1248
      const origHeight = svg.hasAttribute("height")
        ? Number(svg.getAttribute("height"))
        : svg.getBoundingClientRect().height || 300

      if (yPos + 80 > pageHeight - 40) {
        pdf.addPage()
        yPos = 40
        yPos = addSubsectionHeader(title, margin, yPos)
        yPos += 8
      }

      const img = await svgToPngDataUrl(svg, origWidth, origHeight)
      if (!img || img.length === 0) throw new Error("Failed to convert SVG to PNG")
      return embedDiagramImage(img, origWidth, origHeight, yPos).y + 3
    } catch (err) {
      console.error(`Error capturing ${title}:`, err)
      return addWrappedText(`[${title} Error: ${err instanceof Error ? err.message : "Could not be captured"}]`, margin, yPos, contentWidth, 6, 9) + 10
    }
  }

  // Shear Force Diagram
  yOffset = await addForceDiagram("shear-force-diagram", "5.1 Shear Force Diagram", yOffset)
  
  // Bending Moment Diagram
  if (yOffset > pageHeight - 100) {
    pdf.addPage()
    yOffset = 40
  }
  yOffset = await addForceDiagram("bending-moment-diagram", "5.2 Bending Moment Diagram", yOffset)
  
  // Deflection Diagram
  if (yOffset > pageHeight - 100) {
    pdf.addPage()
    yOffset = 40
  }
  yOffset = await addForceDiagram("deflection-diagram", "5.3 Deflection Diagram", yOffset)

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
    pdf.setFont("times", "normal")
    pdf.setTextColor(0, 0, 0)
    pdf.text("Structural Load Analysis Report", margin, 16)
    pdf.text(analysisType, pageWidth - margin, 16, { align: "right" })
    
    // Footer line (subtle)
    pdf.setDrawColor(0, 0, 0)
    pdf.setLineWidth(0.3)
    pdf.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15)
    
    // Footer text
    pdf.setFontSize(8)
    pdf.setFont("times", "italic")
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
