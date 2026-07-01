"use client"

import { useEffect, useState } from "react"
import type React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import Head from "next/head"
import { Download, Loader2, Calculator, Mail, BarChart3, Ruler, Package, Tag, Info } from "lucide-react"

// Import from modules
import type { Load, Section, Results } from "./types"
import { standardMaterials } from "./constants"
import { validateNumber, validatePositive } from "./utils/validation"
import { BeamDiagram, FrameDiagram, CornerLoadsDiagram } from "./components/diagrams"
import { HelpDialog } from "./components/HelpDialog"
import { BeamCrossSectionImage } from "./components/BeamCrossSectionImage"
import { WeightImportDialog, type WeightImportResult } from "./components/WeightImportDialog"
import type { COGResult } from "./utils/cogCalculation"
import { calculateCOG, buildCOGItemsFromImport } from "./utils/cogCalculation"
import { useBeamCalculations } from "./hooks/useBeamCalculations"
import { useDiagramCalculations } from "./hooks/useDiagramCalculations"
import { generatePDF } from "./utils/pdfGeneration"
import { generateLaTeX, downloadLaTeX } from "./utils/latexGeneration"

// All components are now imported from modules - no local definitions needed

export default function BeamLoadCalculator() {
  const [analysisType, setAnalysisType] = useState("Simple Beam")
  const [beamType, setBeamType] = useState("Simple Beam")
  const [beamCrossSection, setBeamCrossSection] = useState("C Channel")
  const [beamLength, setBeamLength] = useState(1000)
  const [frameLength, setFrameLength] = useState(2000)
  const [frameWidth, setFrameWidth] = useState(1000)
  const [leftSupport, setLeftSupport] = useState(0)
  const [rightSupport, setRightSupport] = useState(1000)
  const [loads, setLoads] = useState<Load[]>([{ type: "Point Load", magnitude: 1000, startPosition: 500, unit: "N" }])
  const [sections, setSections] = useState<Section[]>([])
  const [shearForceData, setShearForceData] = useState<Array<{ x: number; y: number }>>([])
  const [bendingMomentData, setBendingMomentData] = useState<Array<{ x: number; y: number }>>([])
  const [deflectionData, setDeflectionData] = useState<Array<{ x: number; y: number }>>([])
  const [material, setMaterial] = useState<keyof typeof standardMaterials>("ASTM A36 Structural Steel")
  const [customMaterial, setCustomMaterial] = useState({ ...standardMaterials["Custom"] })
  const [width, setWidth] = useState(100)
  const [height, setHeight] = useState(218)
  const [flangeWidth, setFlangeWidth] = useState(66)
  const [flangeThickness, setFlangeThickness] = useState(3)
  const [webThickness, setWebThickness] = useState(44.8)
  const [diameter, setDiameter] = useState(100)
  const [beamDensity, setBeamDensity] = useState(7850)
  const [frameWeight, setFrameWeight] = useState(0) // Calculated total frame weight in N (sum of all section baseframe weights)
  const [totalRoofWeight, setTotalRoofWeight] = useState(0) // Total roof weight for entire frame (kg)
  const [totalRoofWeightUnit, setTotalRoofWeightUnit] = useState<"N" | "kg" | "lbs">("kg")
  const [results, setResults] = useState({
    maxShearForce: 0,
    maxBendingMoment: 0,
    maxNormalStress: 0,
    maxShearStress: 0,
    safetyFactor: 0,
    totalBeams: 0,
    loadPerBeam: 0,
    momentOfInertia: 0,
    sectionModulus: 0,
    cornerReactionForce: 0,
    cornerReactions: { R1: 0, R2: 0, R3: 0, R4: 0 }, // Individual corner reactions
    maxDeflection: 0,
    totalAppliedLoad: 0,
  })
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false)
  const [cogResult, setCogResult] = useState<COGResult | null>(null)

  // Use calculation hooks
  const { calculateResults } = useBeamCalculations({
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
    frameWeight,
    setFrameWeight,
    setResults,
    totalRoofWeight,
    totalRoofWeightUnit,
  })

  const { calculateDiagrams } = useDiagramCalculations({
    analysisType,
    beamLength,
    frameLength,
    frameWidth,
    leftSupport,
    rightSupport,
    loads,
    results,
    material,
    customMaterial,
    setShearForceData,
    setBendingMomentData,
    setDeflectionData,
  })

  // Reset loads when analysis type changes
  useEffect(() => {
    if (analysisType === "Simple Beam") {
      setLoads([{ type: "Point Load", magnitude: 1000, startPosition: 500, unit: "N", name: "Load 1" }])
    } else {
      // For base frame, start first load at position 0
      setLoads([{ type: "Distributed Load", magnitude: 1000, startPosition: 0, loadLength: 500, loadWidth: frameWidth, unit: "N", name: "Load 1" }])
    }
  }, [analysisType, frameWidth])

  const addLoad = () => {
    if (loads.length < 10) {
      // Calculate the end position of the last load to set as start position for new load
      let nextStartPosition = 0
      
      if (loads.length > 0) {
        const lastLoad = loads[loads.length - 1]
        
        if (lastLoad.type === "Distributed Load") {
          if (analysisType === "Base Frame" && lastLoad.loadLength) {
            // For base frame: end position = startPosition + loadLength
            nextStartPosition = lastLoad.startPosition + lastLoad.loadLength
          } else if (lastLoad.area) {
            // For simple beam: calculate length from area (assuming square)
            const sideLengthMM = Math.sqrt(lastLoad.area) * 1000
            nextStartPosition = lastLoad.startPosition + sideLengthMM
          } else {
            // Fallback: use startPosition + default length
            nextStartPosition = lastLoad.startPosition + 500
          }
        } else if (lastLoad.type === "Uniform Load" && lastLoad.endPosition) {
          // For uniform load: end position is explicitly defined
          nextStartPosition = lastLoad.endPosition
        } else {
          // For point load: use startPosition (point loads have no length)
          // But for sequential loads, we'll add a small offset
          nextStartPosition = lastLoad.startPosition + 100
        }
      } else {
        // First load starts at 0
        nextStartPosition = 0
      }
      
      // Ensure the start position doesn't exceed the frame/beam length
      const maxLength = analysisType === "Simple Beam" ? beamLength : frameLength
      nextStartPosition = Math.min(nextStartPosition, maxLength)
      
      const newLoad: Load =
        analysisType === "Simple Beam"
          ? { type: "Point Load", magnitude: 1000, startPosition: nextStartPosition, unit: "N", name: `Load ${loads.length + 1}` }
          : analysisType === "Base Frame"
          ? { type: "Distributed Load", magnitude: 1000, startPosition: nextStartPosition, loadLength: 500, loadWidth: frameWidth, unit: "N", name: `Load ${loads.length + 1}` }
          : { type: "Distributed Load", magnitude: 1000, startPosition: nextStartPosition, area: 0.5, unit: "N", name: `Load ${loads.length + 1}` }
      setLoads([...loads, newLoad])
    }
  }

  const removeLoad = (index: number) => {
    setLoads(loads.filter((_load: Load, i: number) => i !== index))
  }

  const updateLoad = (index: number, updatedLoad: Partial<Load>) => {
    setLoads(
      loads.map((load: Load, i: number) => {
        if (i === index) {
          const newLoad = { ...load, ...updatedLoad }
          if (newLoad.type === "Uniform Load" && !newLoad.endPosition) {
            newLoad.endPosition = newLoad.startPosition + 100
          }
          if (newLoad.type === "Distributed Load") {
            // For baseframe, use length and width; for simple beam, use area
            if (analysisType === "Base Frame") {
              if (!newLoad.loadLength) {
                newLoad.loadLength = 500 // Default 500mm length
              }
              if (!newLoad.loadWidth) {
                newLoad.loadWidth = frameWidth // Default to frame width
              }
            } else {
              // For simple beam, use area
              if (!newLoad.area) {
                newLoad.area = 0.5
              }
            }
          }
          if (!newLoad.unit) {
            newLoad.unit = "N"
          }
          return newLoad
        }
        return load
      }),
    )
  }

  // Section management functions
  const addSection = () => {
    const maxLength = analysisType === "Simple Beam" ? beamLength : frameLength
    let newStartPosition = 0
    const updatedSections = [...sections]
    
    if (sections.length > 0) {
      const lastSection = sections[sections.length - 1]
      newStartPosition = lastSection.endPosition
      // Automatically add leg support to previous section at its end position (if not already set)
      const lastIndex = sections.length - 1
      if (!updatedSections[lastIndex].supportType) {
        updatedSections[lastIndex] = { ...updatedSections[lastIndex], supportType: "leg" }
      }
    }
    
    const newSection: Section = {
      id: `section-${Date.now()}`,
      startPosition: newStartPosition,
      endPosition: Math.min(newStartPosition + 1000, maxLength),
      casingWeight: 0,
      casingWeightUnit: "N",
      baseframeWeight: 0,
      baseframeWeightUnit: "kg",
      roofWeight: 0,
      roofWeightUnit: "kg",
      name: `Section ${sections.length + 1}`,
      supportType: sections.length > 0 ? "leg" : undefined, // Add support at start if not first section
    }
    
    setSections([...updatedSections, newSection])
  }

  const removeSection = (id: string) => {
    setSections(sections.filter((s: Section) => s.id !== id))
    // Remove sectionId from loads that reference this section
    setLoads(loads.map((load: Load) => (load.sectionId === id ? { ...load, sectionId: undefined } : load)))
  }

  const updateSection = (id: string, updatedSection: Partial<Section>) => {
    setSections(
      sections.map((section: Section) => {
        if (section.id === id) {
          return { ...section, ...updatedSection }
        }
        return section
      }),
    )
  }


  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const savedState = localStorage.getItem("beamLoadCalculatorState")
      if (savedState) {
        const state = JSON.parse(savedState)
        if (state.analysisType) setAnalysisType(state.analysisType)
        if (state.beamLength) setBeamLength(state.beamLength)
        if (state.frameLength) setFrameLength(state.frameLength)
        if (state.frameWidth) setFrameWidth(state.frameWidth)
        if (state.leftSupport !== undefined) setLeftSupport(state.leftSupport)
        if (state.rightSupport !== undefined) setRightSupport(state.rightSupport)
        if (state.loads) setLoads(state.loads)
        if (state.sections) setSections(state.sections)
        if (state.material) setMaterial(state.material)
        if (state.customMaterial) setCustomMaterial(state.customMaterial)
        if (state.width) setWidth(state.width)
        if (state.height) setHeight(state.height)
        if (state.flangeWidth) setFlangeWidth(state.flangeWidth)
        if (state.flangeThickness) setFlangeThickness(state.flangeThickness)
        if (state.webThickness) setWebThickness(state.webThickness)
        if (state.diameter) setDiameter(state.diameter)
        if (state.beamDensity) setBeamDensity(state.beamDensity)
        if (state.beamCrossSection) setBeamCrossSection(state.beamCrossSection)
        if (state.totalRoofWeight !== undefined) setTotalRoofWeight(state.totalRoofWeight)
        if (state.totalRoofWeightUnit) setTotalRoofWeightUnit(state.totalRoofWeightUnit)
      }
    } catch (error) {
      console.error("Failed to load state from localStorage:", error)
    }
  }, [])

  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      const stateToSave = {
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
        totalRoofWeight,
        totalRoofWeightUnit,
      }
      localStorage.setItem("beamLoadCalculatorState", JSON.stringify(stateToSave))
    } catch (error) {
      console.error("Failed to save state to localStorage:", error)
    }
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
    totalRoofWeight,
    totalRoofWeightUnit,
  ])

  // Update section roof weights when total roof weight or frame length changes
  // Only update if sections exist and we're in Base Frame mode
  useEffect(() => {
    if (analysisType === "Base Frame" && frameLength > 0 && sections.length > 0) {
      setSections((prevSections) => {
        return prevSections.map((section) => {
          const sectionLength = section.endPosition - section.startPosition
          const sectionLengthRatio = sectionLength / frameLength
          
          // Convert total roof weight to kg for calculation
          let totalRoofWeightKg = totalRoofWeight
          if (totalRoofWeightUnit === "N") {
            totalRoofWeightKg = totalRoofWeight / 9.81
          } else if (totalRoofWeightUnit === "lbs") {
            totalRoofWeightKg = totalRoofWeight / 2.20462
          }
          
          // Calculate section roof weight
          const sectionRoofWeightKg = totalRoofWeightKg * sectionLengthRatio
          
          return {
            ...section,
            roofWeight: sectionRoofWeightKg,
            roofWeightUnit: "kg",
          }
        })
      })
    }
  }, [totalRoofWeight, totalRoofWeightUnit, frameLength, analysisType, sections.length])

  useEffect(() => {
    calculateResults()
    calculateDiagrams()
  }, [calculateResults, calculateDiagrams])

  const handleDownloadPDF = async () => {
    setIsGeneratingPDF(true)
    try {
      await generatePDF({
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
      })
    } catch (error) {
      console.error("Error generating PDF:", error)
      alert("Error generating PDF report. Please try again.\n" + (error instanceof Error ? error.message : String(error)))
    } finally {
      setIsGeneratingPDF(false)
    }
  }

  const handleDownloadLaTeX = () => {
    try {
      const latex = generateLaTeX({
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
      })
      const fileName = `${analysisType.toLowerCase().replace(" ", "_")}_analysis_report_${new Date().toISOString().split("T")[0]}.tex`
      downloadLaTeX(latex, fileName)
    } catch (error) {
      console.error("Error generating LaTeX:", error)
      alert("Error generating LaTeX file. Please try again.\n" + (error instanceof Error ? error.message : String(error)))
    }
  }
  return (
    <div className="container mx-auto p-4 bg-gradient-to-br from-slate-50 to-blue-50 min-h-screen" style={{ fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif' }}>
      <Head>
        <title>Enhanced Load Calculator</title>
        <link rel="icon" href="/placeholder-logo.png" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      
      {/* Header */}
      <div className="flex justify-between items-center mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Calculator className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Enhanced Load Calculator</h1>
            <p className="text-sm text-gray-600">Structural Engineering Analysis Tool</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a 
            href="mailto:hbradroc@uwo.ca" 
            title="Email hbradroc@uwo.ca" 
            className="flex items-center gap-2 px-3 py-2 text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
          >
            <Mail className="w-4 h-4" />
            <span className="text-sm font-medium hidden sm:inline">hbradroc@uwo.ca</span>
          </a>
          <Button 
            onClick={handleDownloadPDF} 
            disabled={isGeneratingPDF} 
            size="sm"
            className="flex items-center gap-2"
          >
            {isGeneratingPDF ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Download PDF
              </>
            )}
          </Button>
          <Button 
            onClick={handleDownloadLaTeX} 
            size="sm"
            variant="outline"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download LaTeX
          </Button>
          <HelpDialog />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration Card */}
        <Card className="shadow-sm border-gray-200">
          <CardHeader className="pb-4 border-b border-gray-100">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              Configuration
            </CardTitle>
            <CardDescription className="text-sm">Select analysis type and enter beam properties.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-6">
            <div className="grid grid-cols-2 gap-4">
              <Label htmlFor="analysis-type" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-500" />
                Analysis Type
              </Label>
              <Select value={analysisType} onValueChange={setAnalysisType}>
                <SelectTrigger id="analysis-type">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Simple Beam">Simple Beam</SelectItem>
                  <SelectItem value="Base Frame">Base Frame</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {analysisType === "Simple Beam" ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="beam-length" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Beam Length (mm)
                  </Label>
                  <Input
                    type="number"
                    id="beam-length"
                    value={beamLength}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBeamLength(validatePositive(Number(e.target.value), 1000))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="left-support" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Left Support (mm)
                  </Label>
                  <Input
                    type="number"
                    id="left-support"
                    value={leftSupport}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLeftSupport(validateNumber(Number(e.target.value), 0))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="right-support" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Right Support (mm)
                  </Label>
                  <Input
                    type="number"
                    id="right-support"
                    value={rightSupport}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRightSupport(validatePositive(Number(e.target.value), beamLength))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="frame-length" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Frame Length (mm)
                  </Label>
                  <Input
                    type="number"
                    id="frame-length"
                    value={frameLength}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrameLength(validatePositive(Number(e.target.value), 2000))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="frame-width" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Frame Width (mm)
                  </Label>
                  <Input
                    type="number"
                    id="frame-width"
                    value={frameWidth}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrameWidth(validatePositive(Number(e.target.value), 1000))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="total-roof-weight" className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-gray-500" />
                    Total Roof Weight
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      id="total-roof-weight"
                      value={totalRoofWeight}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setTotalRoofWeight(validateNumber(Number(e.target.value), 0))
                      }
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 flex-1"
                      placeholder="Enter total roof weight"
                    />
                    <Select
                      value={totalRoofWeightUnit}
                      onValueChange={(value: string) => setTotalRoofWeightUnit(value as "N" | "kg" | "lbs")}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="kg">kg</SelectItem>
                        <SelectItem value="N">N</SelectItem>
                        <SelectItem value="lbs">lbs</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="text-xs text-gray-500 bg-blue-50 p-2 rounded">
                  <Info className="w-3 h-3 inline mr-1" />
                  <strong>Total roof weight</strong> will be automatically distributed to sections based on their length.
                  <strong> Frame weight should be entered per section</strong> in the Sections Management section below.
                  The total frame weight will be automatically calculated as the sum of all section baseframe weights.
                </div>
                {sections.length > 0 && (
                  <div className="text-xs text-gray-600 bg-green-50 p-2 rounded border border-green-200">
                    <div className="font-semibold mb-1">Current Totals (from {sections.length} section{sections.length !== 1 ? "s" : ""}):</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-gray-600">Total Baseframe: </span>
                        <span className="font-mono font-semibold">
                          {sections
                            .reduce((sum, s) => {
                              const baseframe = s.baseframeWeight || 0
                              const unit = s.baseframeWeightUnit || "kg"
                              // Convert all to kg for display
                              if (unit === "N") {
                                return sum + baseframe / 9.81
                              } else if (unit === "lbs") {
                                return sum + baseframe / 2.20462
                              }
                              return sum + baseframe
                            }, 0)
                            .toFixed(1)}{" "}
                          kg
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Total Roof: </span>
                        <span className="font-mono font-semibold">
                          {(() => {
                            // Convert total roof weight to kg for display
                            if (totalRoofWeightUnit === "N") {
                              return (totalRoofWeight / 9.81).toFixed(1)
                            } else if (totalRoofWeightUnit === "lbs") {
                              return (totalRoofWeight / 2.20462).toFixed(1)
                            }
                            return totalRoofWeight.toFixed(1)
                          })()}{" "}
                          kg
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Sections Management Card (for Base Frame only) */}
        {analysisType === "Base Frame" && (
          <Card className="shadow-sm border-gray-200">
            <CardHeader className="pb-4 border-b border-gray-100">
              <CardTitle className="text-lg flex items-center gap-2">
                <Ruler className="w-5 h-5 text-purple-600" />
                Sections Management
              </CardTitle>
              <CardDescription className="text-sm">
                Define sections with casing weight and baseframe weight. Roof weight is automatically calculated from total roof weight.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 p-6">
              <div className="flex justify-between items-center mb-4">
                <span className="text-sm text-gray-600">
                  {sections.length} section{sections.length !== 1 ? "s" : ""} defined
                </span>
                <div className="flex gap-2">
                  <WeightImportDialog
                    onImport={(result: WeightImportResult) => {
                      if (result.frameLength) setFrameLength(result.frameLength)
                      if (result.frameWidth) setFrameWidth(result.frameWidth)
                      if (result.totalRoofWeight !== undefined) {
                        setTotalRoofWeight(result.totalRoofWeight)
                        if (result.totalRoofWeightUnit) {
                          setTotalRoofWeightUnit(result.totalRoofWeightUnit)
                        }
                      }
                      setSections(result.sections)
                      setLoads(result.loads)
                      if (result.cog) {
                        setCogResult(result.cog)
                      } else {
                        const fl = result.frameLength || frameLength
                        const fw = result.frameWidth || frameWidth
                        setCogResult(
                          calculateCOG(
                            buildCOGItemsFromImport(
                              result.sections,
                              result.loads,
                              fw,
                              result.totalRoofWeight,
                              result.totalRoofWeightUnit
                            ),
                            fl,
                            fw,
                            result.totalRoofWeightUnit || "lbs"
                          )
                        )
                      }
                    }}
                    frameLength={frameLength}
                    frameWidth={frameWidth}
                    existingSections={sections}
                    existingLoads={loads}
                  />
                  <Button onClick={addSection} variant="outline" size="sm" disabled={sections.length >= 10}>
                    <Package className="w-4 h-4 mr-2" />
                    Add Section
                  </Button>
                </div>
              </div>

              {sections.map((section: Section, index: number) => (
                <div key={section.id} className="border border-gray-200 rounded-lg p-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="font-semibold text-gray-700">{section.name || `Section ${index + 1}`}</h4>
                    <Button
                      onClick={() => removeSection(section.id)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                    >
                      Remove
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor={`section-name-${section.id}`}>Section Name</Label>
                      <Input
                        id={`section-name-${section.id}`}
                        value={section.name || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSection(section.id, { name: e.target.value })}
                        placeholder={`Section ${index + 1}`}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`section-start-${section.id}`}>Start Position (mm)</Label>
                      <Input
                        type="number"
                        id={`section-start-${section.id}`}
                        value={section.startPosition}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateSection(section.id, {
                            startPosition: validateNumber(Number(e.target.value), 0),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`section-end-${section.id}`}>End Position (mm)</Label>
                      <Input
                        type="number"
                        id={`section-end-${section.id}`}
                        value={section.endPosition}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          updateSection(section.id, {
                            endPosition: validatePositive(Number(e.target.value), section.startPosition + 100),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`section-length-${section.id}`}>Length (mm)</Label>
                      <Input
                        type="number"
                        id={`section-length-${section.id}`}
                        value={section.endPosition - section.startPosition}
                        disabled
                        className="bg-gray-50"
                      />
                    </div>
                    {index > 0 && (
                      <div className="col-span-2">
                        <Label htmlFor={`section-support-${section.id}`}>
                          Support at Start Position ({section.startPosition} mm)
                        </Label>
                        <Select
                          value={section.supportType || "leg"}
                          onValueChange={(value: string) => {
                            updateSection(section.id, { supportType: value as "leg" | "hook" | "none" })
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="leg">Leg Support (Ground Support)</SelectItem>
                            <SelectItem value="hook">Hook Support (Lifting Prevention)</SelectItem>
                            <SelectItem value="none">No Support</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="text-xs text-gray-500 mt-1">
                          {section.supportType === "leg" && "✓ Supports frame on ground at this position"}
                          {section.supportType === "hook" && "✓ Prevents frame from lifting at this position"}
                          {(!section.supportType || section.supportType === "none") && "No support at this boundary"}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                    <div>
                      <Label htmlFor={`section-casing-${section.id}`}>Casing Weight</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          id={`section-casing-${section.id}`}
                          value={section.casingWeight}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateSection(section.id, {
                              casingWeight: validateNumber(Number(e.target.value), 0),
                            })
                          }
                          className="flex-1"
                        />
                        <Select
                          value={section.casingWeightUnit}
                          onValueChange={(value: string) =>
                            updateSection(section.id, { casingWeightUnit: value as "N" | "kg" | "lbs" })
                          }
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="N">N</SelectItem>
                            <SelectItem value="kg">kg</SelectItem>
                            <SelectItem value="lbs">lbs</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label htmlFor={`section-baseframe-${section.id}`}>
                        Baseframe Weight ({section.baseframeWeightUnit || "kg"})
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          id={`section-baseframe-${section.id}`}
                          value={section.baseframeWeight || 0}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateSection(section.id, {
                              baseframeWeight: validateNumber(Number(e.target.value), 0),
                            })
                          }
                          className="flex-1"
                          placeholder="Enter baseframe weight"
                        />
                        <Select
                          value={section.baseframeWeightUnit || "kg"}
                          onValueChange={(value: string) =>
                            updateSection(section.id, { baseframeWeightUnit: value as "N" | "kg" | "lbs" })
                          }
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="kg">kg</SelectItem>
                            <SelectItem value="N">N</SelectItem>
                            <SelectItem value="lbs">lbs</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Baseframe weight for this section length (e.g., 62 kg for 941 mm)
                      </div>
                    </div>
                    <div>
                      <Label htmlFor={`section-roof-${section.id}`}>Roof Weight (calculated)</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          id={`section-roof-${section.id}`}
                          value={(() => {
                            // Calculate roof weight for this section based on total roof weight and section length
                            if (totalRoofWeight === 0 || frameLength === 0) return 0
                            const sectionLength = section.endPosition - section.startPosition
                            const sectionLengthRatio = sectionLength / frameLength
                            
                            // Convert total roof weight to kg for calculation
                            let totalRoofWeightKg = totalRoofWeight
                            if (totalRoofWeightUnit === "N") {
                              totalRoofWeightKg = totalRoofWeight / 9.81
                            } else if (totalRoofWeightUnit === "lbs") {
                              totalRoofWeightKg = totalRoofWeight / 2.20462
                            }
                            
                            // Calculate section roof weight
                            const sectionRoofWeightKg = totalRoofWeightKg * sectionLengthRatio
                            return sectionRoofWeightKg.toFixed(2)
                          })()}
                          readOnly
                          className="flex-1 bg-gray-50"
                        />
                        <Select
                          value={section.roofWeightUnit || "kg"}
                          disabled
                        >
                          <SelectTrigger className="w-24 bg-gray-50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="kg">kg</SelectItem>
                            <SelectItem value="N">N</SelectItem>
                            <SelectItem value="lbs">lbs</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Automatically calculated from total roof weight based on section length
                      </div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gray-100 bg-blue-50 p-3 rounded">
                    <div className="text-sm font-semibold text-gray-700 mb-2">Section Summary</div>
                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="text-gray-600">Length: </span>
                        <span className="font-mono font-semibold">{(section.endPosition - section.startPosition).toFixed(0)} mm</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Baseframe: </span>
                        <span className="font-mono font-semibold">
                          {section.baseframeWeight || 0} {section.baseframeWeightUnit || "kg"}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Roof: </span>
                        <span className="font-mono font-semibold">
                          {(() => {
                            // Calculate roof weight for this section
                            if (totalRoofWeight === 0 || frameLength === 0) return "0 kg"
                            const sectionLength = section.endPosition - section.startPosition
                            const sectionLengthRatio = sectionLength / frameLength
                            
                            // Convert total roof weight to kg for calculation
                            let totalRoofWeightKg = totalRoofWeight
                            if (totalRoofWeightUnit === "N") {
                              totalRoofWeightKg = totalRoofWeight / 9.81
                            } else if (totalRoofWeightUnit === "lbs") {
                              totalRoofWeightKg = totalRoofWeight / 2.20462
                            }
                            
                            // Calculate section roof weight
                            const sectionRoofWeightKg = totalRoofWeightKg * sectionLengthRatio
                            return `${sectionRoofWeightKg.toFixed(2)} kg`
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {sections.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No sections defined. Click "Add Section" to create one.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Cross-Section Dimensions Card */}
        <Card className="shadow-sm border-gray-200">
          <CardHeader className="pb-4 border-b border-gray-100">
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="w-5 h-5 text-green-600" />
              Cross-Section Dimensions
            </CardTitle>
            <CardDescription className="text-sm">Enter the dimensions of the beam cross-section.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-6">
            <div className="grid grid-cols-2 gap-4">
              <Label htmlFor="beam-cross-section" className="flex items-center gap-2">
                <Package className="w-4 h-4 text-gray-500" />
                Cross Section
              </Label>
              <Select value={beamCrossSection} onValueChange={setBeamCrossSection}>
                <SelectTrigger id="beam-cross-section">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Rectangular">Rectangular</SelectItem>
                  <SelectItem value="I Beam">I-Beam</SelectItem>
                  <SelectItem value="C Channel">C-Channel</SelectItem>
                  <SelectItem value="Circular">Circular</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-center p-4 bg-gray-50 rounded-lg">
              <BeamCrossSectionImage type={beamCrossSection} />
            </div>

            {beamCrossSection === "Rectangular" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="width" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Width (mm)
                  </Label>
                  <Input
                    type="number"
                    id="width"
                    value={width}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWidth(validatePositive(Number(e.target.value), 100))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="height" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Height (mm)
                  </Label>
                  <Input
                    type="number"
                    id="height"
                    value={height}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHeight(validatePositive(Number(e.target.value), 218))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </>
            )}

            {(beamCrossSection === "I Beam" || beamCrossSection === "C Channel") && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="height" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Height (H, mm)
                  </Label>
                  <Input
                    type="number"
                    id="height"
                    value={height}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHeight(validatePositive(Number(e.target.value), 218))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="flange-width" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Flange Width (bf, mm)
                  </Label>
                  <Input
                    type="number"
                    id="flange-width"
                    value={flangeWidth}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFlangeWidth(validatePositive(Number(e.target.value), 66))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="flange-thickness" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Flange Thickness (tf, mm)
                  </Label>
                  <Input
                    type="number"
                    id="flange-thickness"
                    value={flangeThickness}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFlangeThickness(validatePositive(Number(e.target.value), 3))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="web-thickness" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Web Thickness (tw, mm)
                  </Label>
                  <Input
                    type="number"
                    id="web-thickness"
                    value={webThickness}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWebThickness(validatePositive(Number(e.target.value), 44.8))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </>
            )}

            {beamCrossSection === "Circular" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="diameter" className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Diameter (D, mm)
                  </Label>
                  <Input
                    type="number"
                    id="diameter"
                    value={diameter}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDiameter(validatePositive(Number(e.target.value), 100))}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Loads Card */}
        <Card className="shadow-sm border-gray-200">
          <CardHeader className="pb-4 border-b border-gray-100">
            <CardTitle className="text-lg flex items-center gap-2">
              <Loader2 className="w-5 h-5 text-orange-600" />
              Loads
            </CardTitle>
            <CardDescription className="text-sm">Add and manage loads applied to the beam.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-6">
            {loads.map((load: Load, index: number) => (
              <div key={index} className="border border-gray-200 p-4 rounded-lg bg-gray-50">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <Label htmlFor={`load-name-${index}`} className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-gray-500" />
                    Load Name
                  </Label>
                  <Input
                    type="text"
                    id={`load-name-${index}`}
                    value={load.name || `Load ${index + 1}`}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLoad(index, { name: e.target.value })}
                    placeholder={`Load ${index + 1}`}
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <Label htmlFor={`load-type-${index}`} className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-gray-500" />
                    Load Type
                  </Label>
                  <Select
                    value={load.type}
                    onValueChange={(value: string) => updateLoad(index, { type: value as Load["type"] })}
                  >
                    <SelectTrigger id={`load-type-${index}`}>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Point Load">Point Load</SelectItem>
                      <SelectItem value="Uniform Load">Uniform Load</SelectItem>
                      <SelectItem value="Distributed Load">Distributed Load</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <Label htmlFor={`load-magnitude-${index}`} className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-gray-500" />
                    {load.type === "Distributed Load" && (load.unit === "kg" || load.unit === "lbs")
                      ? "Total Weight"
                      : "Magnitude"}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      id={`load-magnitude-${index}`}
                      value={load.magnitude}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLoad(index, { magnitude: validateNumber(Number(e.target.value), 1000) })}
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                    <Select
                      value={load.unit || "N"}
                      onValueChange={(value: string) => updateLoad(index, { unit: value as "N" | "kg" | "lbs" })}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="N">N</SelectItem>
                        <SelectItem value="kg">kg</SelectItem>
                        <SelectItem value="lbs">lbs</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Conversion tooltip */}
                <div className="mb-4 p-2 bg-blue-50 rounded border border-blue-200">
                  <div className="text-xs text-blue-700">
                    <div className="flex items-center gap-2">
                      <Info className="w-3 h-3" />
                      <span className="font-medium">Load Conversion:</span>
                    </div>
                    <div className="mt-1">
                      {load.unit === "kg" ? (
                        <>
                          <span className="font-mono">{load.magnitude} kg</span> = <span className="font-mono">{(load.magnitude * 9.81).toFixed(1)} N</span> = <span className="font-mono">{(load.magnitude * 2.20462).toFixed(1)} lbs</span>
                        </>
                      ) : load.unit === "lbs" ? (
                        <>
                          <span className="font-mono">{load.magnitude} lbs</span> = <span className="font-mono">{(load.magnitude * 4.44822).toFixed(1)} N</span> = <span className="font-mono">{(load.magnitude / 2.20462).toFixed(1)} kg</span>
                        </>
                      ) : (
                        <>
                          <span className="font-mono">{load.magnitude} N</span> = <span className="font-mono">{(load.magnitude / 9.81).toFixed(1)} kg</span> = <span className="font-mono">{(load.magnitude / 4.44822).toFixed(1)} lbs</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <Label htmlFor={`load-position-${index}`} className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-gray-500" />
                    Start Position (mm)
                  </Label>
                  <Input
                    type="number"
                    id={`load-position-${index}`}
                    value={load.startPosition}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateLoad(index, {
                        startPosition: validateNumber(
                          Number(e.target.value),
                          analysisType === "Simple Beam" ? beamLength / 2 : frameLength / 2,
                        ),
                      })
                    }
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                {load.type === "Uniform Load" && (
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <Label htmlFor={`load-end-position-${index}`} className="flex items-center gap-2">
                      <Ruler className="w-4 h-4 text-gray-500" />
                      End Position (mm)
                    </Label>
                    <Input
                      type="number"
                      id={`load-end-position-${index}`}
                      value={load.endPosition || load.startPosition + 100}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateLoad(index, {
                          endPosition: validateNumber(Number(e.target.value), load.startPosition + 100),
                        })
                      }
                      className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                )}
                {load.type === "Distributed Load" && (
                  <>
                    {analysisType === "Base Frame" ? (
                      <>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <Label htmlFor={`load-length-${index}`} className="flex items-center gap-2">
                            <Ruler className="w-4 h-4 text-gray-500" />
                            Component Length (mm)
                          </Label>
                          <Input
                            type="number"
                            id={`load-length-${index}`}
                            min={1}
                            step={1}
                            max={frameLength}
                            value={load.loadLength || 500}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              let val = Math.max(1, Number(e.target.value));
                              if (val > frameLength) val = frameLength;
                              updateLoad(index, { loadLength: val });
                            }}
                            className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <Label htmlFor={`load-width-${index}`} className="flex items-center gap-2">
                            <Ruler className="w-4 h-4 text-gray-500" />
                            Component Width (mm)
                          </Label>
                          <Input
                            type="number"
                            id={`load-width-${index}`}
                            min={1}
                            step={1}
                            max={frameWidth}
                            value={load.loadWidth || frameWidth}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              let val = Math.max(1, Number(e.target.value));
                              if (val > frameWidth) val = frameWidth;
                              updateLoad(index, { loadWidth: val });
                            }}
                            className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                          />
                        </div>
                      </>
                    ) : (
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <Label htmlFor={`load-area-${index}`} className="flex items-center gap-2">
                          <Ruler className="w-4 h-4 text-gray-500" />
                          Area (m²)
                        </Label>
                        <Input
                          type="number"
                          id={`load-area-${index}`}
                          min={0.1}
                          step={0.1}
                          max={((beamLength * width) / 1_000_000).toFixed(2)}
                          value={load.area || 0.5}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            let val = Math.max(0.1, Number(e.target.value));
                            const maxArea = (beamLength * width) / 1_000_000;
                            if (val > maxArea) val = maxArea;
                            updateLoad(index, { area: val });
                          }}
                          className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>
                    )}
                  </>
                )}
                <Button variant="destructive" size="sm" onClick={() => removeLoad(index)} className="w-full">
                  Remove Load
                </Button>
              </div>
            ))}
            <Button onClick={addLoad} disabled={loads.length >= 10} className="w-full">
              Add Load
            </Button>
          </CardContent>
        </Card>

        {/* Material Properties Card */}
        <Card className="shadow-sm border-gray-200">
          <CardHeader className="pb-4 border-b border-gray-100">
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="w-5 h-5 text-purple-600" />
              Material Properties
            </CardTitle>
            <CardDescription className="text-sm">Select material and view its properties.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-6">
            <div className="grid grid-cols-2 gap-4">
              <Label htmlFor="material" className="flex items-center gap-2">
                <Package className="w-4 h-4 text-gray-500" />
                Material
              </Label>
              <Select value={material} onValueChange={setMaterial}>
                <SelectTrigger id="material">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(standardMaterials).map((key) => (
                    <SelectItem key={key} value={key}>
                      {key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {material === "Custom" ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="yield-strength" className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-gray-500" />
                    Yield Strength (MPa)
                  </Label>
                  <Input
                    type="number"
                    id="yield-strength"
                    value={customMaterial.yieldStrength}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setCustomMaterial({ ...customMaterial, yieldStrength: validateNumber(Number(e.target.value), 0) })
                    }
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="elastic-modulus" className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-gray-500" />
                    Elastic Modulus (GPa)
                  </Label>
                  <Input
                    type="number"
                    id="elastic-modulus"
                    value={customMaterial.elasticModulus}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setCustomMaterial({
                        ...customMaterial,
                        elasticModulus: validateNumber(Number(e.target.value), 0),
                      })
                    }
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label htmlFor="density" className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-gray-500" />
                    Density (kg/m³)
                  </Label>
                  <Input
                    type="number"
                    id="density"
                    value={customMaterial.density}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setCustomMaterial({ ...customMaterial, density: validateNumber(Number(e.target.value), 0) })
                    }
                    className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Label className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-gray-500" />
                    Yield Strength (MPa)
                  </Label>
                  <Input type="text" value={standardMaterials[material].yieldStrength} readOnly className="bg-gray-50" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-gray-500" />
                    Elastic Modulus (GPa)
                  </Label>
                  <Input type="text" value={standardMaterials[material].elasticModulus} readOnly className="bg-gray-50" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Label className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-gray-500" />
                    Density (kg/m³)
                  </Label>
                  <Input type="text" value={standardMaterials[material].density} readOnly className="bg-gray-50" />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Results Card */}
        <Card className="shadow-sm border-gray-200 lg:col-span-2">
          <CardHeader className="pb-4 border-b border-gray-100">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-green-600" />
              Analysis Results
            </CardTitle>
            <CardDescription className="text-sm">View the calculated results and safety factors.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-2xl font-bold text-blue-600">{results.maxShearForce}</div>
                <div className="text-sm text-gray-600">Max Shear Force (N)</div>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="text-2xl font-bold text-green-600">{results.maxBendingMoment}</div>
                <div className="text-sm text-gray-600">Max Bending Moment (N·m)</div>
              </div>
              <div className="text-center p-4 bg-orange-50 rounded-lg border border-orange-200">
                <div className="text-2xl font-bold text-orange-600">{results.maxNormalStress}</div>
                <div className="text-sm text-gray-600">Max Normal Stress (MPa)</div>
              </div>
              <div className="text-center p-4 bg-purple-50 rounded-lg border border-purple-200">
                <div className="text-2xl font-bold text-purple-600">{results.maxShearStress}</div>
                <div className="text-sm text-gray-600">Max Shear Stress (MPa)</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg border border-red-200">
                <div className="text-2xl font-bold text-red-600">{results.safetyFactor}</div>
                <div className="text-sm text-gray-600">Safety Factor</div>
              </div>
              <div className="text-center p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                <div className="text-2xl font-bold text-indigo-600">{(results.maxDeflection * 1000).toFixed(3)}</div>
                <div className="text-sm text-gray-600">Max Deflection (mm)</div>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-gray-600">
                  {analysisType === "Base Frame" && sections.length > 0
                    ? (() => {
                        const totalBaseframe = sections.reduce((sum, s) => {
                          const baseframeN = s.baseframeWeight
                            ? s.baseframeWeightUnit === "kg"
                              ? s.baseframeWeight * 9.81
                              : s.baseframeWeightUnit === "lbs"
                              ? s.baseframeWeight * 4.44822
                              : s.baseframeWeight
                            : 0
                          return sum + baseframeN
                        }, 0)
                        return (totalBaseframe / 9.81).toFixed(1)
                      })()
                    : (frameWeight / 9.81).toFixed(1)}{" "}
                  kg
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  ({analysisType === "Base Frame" && sections.length > 0
                    ? (() => {
                        const totalBaseframe = sections.reduce((sum, s) => {
                          const baseframeN = s.baseframeWeight
                            ? s.baseframeWeightUnit === "kg"
                              ? s.baseframeWeight * 9.81
                              : s.baseframeWeightUnit === "lbs"
                              ? s.baseframeWeight * 4.44822
                              : s.baseframeWeight
                            : 0
                          return sum + baseframeN
                        }, 0)
                        return totalBaseframe.toFixed(0)
                      })()
                    : frameWeight.toFixed(0)}{" "}
                  N)
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  {analysisType === "Base Frame" ? "Total Baseframe Weight" : "Structure Weight"}
                </div>
                {analysisType === "Base Frame" && sections.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    (Sum of all section baseframe weights)
                  </div>
                )}
              </div>
              {analysisType === "Base Frame" && (
                <div className="text-center p-4 bg-teal-50 rounded-lg border border-teal-200">
                  <div className="text-2xl font-bold text-teal-600">
                    {(results.cornerReactionForce / 9.81).toFixed(1)} kg
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    ({results.cornerReactionForce.toFixed(0)} N)
                  </div>
                  <div className="text-sm text-gray-600 mt-1">Max Corner Reaction</div>
                </div>
              )}
              {analysisType === "Base Frame" && cogResult && (
                <>
                  <div className="text-center p-4 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="text-2xl font-bold text-amber-700">
                      {cogResult.cogX.toFixed(0)} mm
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      ({(cogResult.cogXRatio * 100).toFixed(1)}% of length)
                    </div>
                    <div className="text-sm text-gray-600 mt-1">COG / COM — X</div>
                  </div>
                  <div className="text-center p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                    <div className="text-2xl font-bold text-yellow-700">
                      {cogResult.cogY.toFixed(0)} mm
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      ({(cogResult.cogYRatio * 100).toFixed(1)}% of width)
                    </div>
                    <div className="text-sm text-gray-600 mt-1">COG / COM — Y</div>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Diagrams Section */}
      <div className="mt-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-blue-100 rounded-lg">
            <BarChart3 className="w-6 h-6 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Structural Diagrams</h2>
        </div>

        {/* Structure Diagram */}
        <Card className="mb-6 shadow-sm border-gray-200">
          <CardHeader className="pb-4 border-b border-gray-100">
            <CardTitle className="text-lg flex items-center gap-2">
              <Ruler className="w-5 h-5 text-blue-600" />
              Structure Layout
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {analysisType === "Simple Beam" ? (
              <BeamDiagram beamLength={beamLength} leftSupport={leftSupport} rightSupport={rightSupport} loads={loads} />
            ) : (
              <FrameDiagram frameLength={frameLength} frameWidth={frameWidth} loads={loads} sections={sections} />
            )}
          </CardContent>
        </Card>

        {/* Corner Loads Diagram (for Base Frame only) */}
        {analysisType === "Base Frame" && (
          <Card className="mb-6 shadow-sm border-gray-200">
            <CardHeader className="pb-4 border-b border-gray-100">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-green-600" />
                Corner Loads Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <CornerLoadsDiagram
                frameLength={frameLength}
                frameWidth={frameWidth}
                loads={loads}
                cornerReactionForce={results.cornerReactionForce}
                cornerReactions={results.cornerReactions}
                sections={sections}
              />
            </CardContent>
          </Card>
        )}

        {/* Force Diagrams */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Shear Force Diagram */}
          <Card className="shadow-sm border-gray-200">
            <CardHeader className="pb-4 border-b border-gray-100">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-600" />
                Shear Force Diagram
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div id="shear-force-diagram" style={{ width: "100%", height: 250, minWidth: 0, minHeight: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  {shearForceData.length > 0 && (
                    <AreaChart data={shearForceData} margin={{ top: 10, right: 10, left: 50, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="x" 
                        label={{ value: "Position (mm)", position: "bottom", offset: 5, style: { textAnchor: "middle" } }}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis 
                        label={{ value: "Shear Force (N)", angle: -90, position: "left", offset: 0, style: { textAnchor: "middle" } }}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip />
                      <Area type="monotone" dataKey="y" stroke="#8884d8" fill="#8884d8" />
                      <ReferenceLine y={0} stroke="#000" strokeDasharray="3 3" />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Bending Moment Diagram */}
          <Card className="shadow-sm border-gray-200">
            <CardHeader className="pb-4 border-b border-gray-100">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-green-600" />
                Bending Moment Diagram
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div id="bending-moment-diagram" style={{ width: "100%", height: 250, minWidth: 0, minHeight: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  {bendingMomentData.length > 0 && (
                    <AreaChart data={bendingMomentData} margin={{ top: 10, right: 10, left: 50, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="x" 
                        label={{ value: "Position (mm)", position: "bottom", offset: 5, style: { textAnchor: "middle" } }}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis 
                        label={{ value: "Bending Moment (N·m)", angle: -90, position: "left", offset: 0, style: { textAnchor: "middle" } }}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip />
                      <Area type="monotone" dataKey="y" stroke="#82ca9d" fill="#82ca9d" />
                      <ReferenceLine y={0} stroke="#000" strokeDasharray="3 3" />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Deflection Diagram */}
          <Card className="shadow-sm border-gray-200">
            <CardHeader className="pb-4 border-b border-gray-100">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-orange-600" />
                Deflection Diagram
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div id="deflection-diagram" style={{ width: "100%", height: 250, minWidth: 0, minHeight: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  {deflectionData.length > 0 && (
                    <AreaChart data={deflectionData} margin={{ top: 10, right: 10, left: 50, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="x" 
                        label={{ value: "Position (mm)", position: "bottom", offset: 5, style: { textAnchor: "middle" } }}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis 
                        label={{ value: "Deflection (mm)", angle: -90, position: "left", offset: 0, style: { textAnchor: "middle" } }}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip />
                      <Area type="monotone" dataKey="y" stroke="#ff7300" fill="#ff7300" />
                      <ReferenceLine y={0} stroke="#000" strokeDasharray="3 3" />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
