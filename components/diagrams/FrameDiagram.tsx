import type React from "react"
import type { Load, Section } from "../../types"
import { validateNumber, validatePositive } from "../../utils/validation"
import { getDistributedLoadTotalWeightN } from "../../utils/conversions"

interface FrameDiagramProps {
  frameLength: number
  frameWidth: number
  loads: Load[]
  sections?: Section[]
}

export const FrameDiagram: React.FC<FrameDiagramProps> = ({ frameLength, frameWidth, loads, sections = [] }) => {
  const svgWidth = 500
  const svgHeight = 450
  const margin = 60

  // Scale factors with validation
  const validFrameLength = validatePositive(frameLength, 1000)
  const validFrameWidth = validatePositive(frameWidth, 1000)
  const scaleX = (svgWidth - 2 * margin) / validFrameLength
  const scaleY = (svgHeight - 2 * margin - 50) / validFrameWidth

  const frameRect = {
    x: margin,
    y: margin + 40,
    width: validFrameLength * scaleX,
    height: validFrameWidth * scaleY,
  }

  return (
    <svg width={svgWidth} height={svgHeight} className="mx-auto" id="frame-structure-diagram">
      {/* Frame outline */}
      <rect
        x={frameRect.x}
        y={frameRect.y}
        width={frameRect.width}
        height={frameRect.height}
        fill="none"
        stroke="black"
        strokeWidth="3"
      />

      {/* Longitudinal beams (top and bottom) */}
      <line
        x1={margin}
        y1={margin + 30}
        x2={margin + validatePositive(validFrameLength * scaleX, 100)}
        y2={margin + 30}
        stroke="blue"
        strokeWidth="3"
      />
      <line
        x1={margin}
        y1={margin + 30 + validatePositive(validFrameWidth * scaleY, 100)}
        x2={margin + validatePositive(validFrameLength * scaleX, 100)}
        y2={margin + 30 + validatePositive(validFrameWidth * scaleY, 100)}
        stroke="blue"
        strokeWidth="3"
      />

      {/* Transverse beams (left and right) */}
      <line
        x1={margin}
        y1={margin + 30}
        x2={margin}
        y2={margin + 30 + validatePositive(validFrameWidth * scaleY, 100)}
        stroke="red"
        strokeWidth="3"
      />
      <line
        x1={margin + validatePositive(validFrameLength * scaleX, 100)}
        y1={margin + 30}
        x2={margin + validatePositive(validFrameLength * scaleX, 100)}
        y2={margin + 30 + validatePositive(validFrameWidth * scaleY, 100)}
        stroke="red"
        strokeWidth="3"
      />

      {/* Section dividers and supports */}
      {sections.map((section, index) => {
        const dividerX = margin + section.endPosition * scaleX
        const sectionLength = section.endPosition - section.startPosition
        const sectionCenterX = margin + (section.startPosition + sectionLength / 2) * scaleX
        const supportX = margin + section.startPosition * scaleX
        
        return (
          <g key={section.id}>
            {/* Vertical divider line at section end */}
            {index < sections.length - 1 && (
              <line
                x1={dividerX}
                y1={frameRect.y - 20}
                x2={dividerX}
                y2={frameRect.y + frameRect.height + 5}
                stroke="#666"
                strokeWidth="2"
                strokeDasharray="5,5"
              />
            )}
            
            {/* Support indicator at section start (if not first section) */}
            {index > 0 && section.supportType && section.supportType !== "none" && (
              <g>
                {/* Support line */}
                <line
                  x1={supportX}
                  y1={frameRect.y + frameRect.height}
                  x2={supportX}
                  y2={frameRect.y + frameRect.height + 20}
                  stroke={section.supportType === "leg" ? "#0066cc" : "#cc6600"}
                  strokeWidth="3"
                />
                {/* Leg support (ground support) - triangle pointing down */}
                {section.supportType === "leg" && (
                  <polygon
                    points={`${supportX - 8},${frameRect.y + frameRect.height + 20} ${supportX + 8},${frameRect.y + frameRect.height + 20} ${supportX},${frameRect.y + frameRect.height + 28}`}
                    fill="#0066cc"
                  />
                )}
                {/* Hook support (lifting prevention) - inverted triangle */}
                {section.supportType === "hook" && (
                  <polygon
                    points={`${supportX - 8},${frameRect.y + frameRect.height + 20} ${supportX + 8},${frameRect.y + frameRect.height + 20} ${supportX},${frameRect.y + frameRect.height + 12}`}
                    fill="#cc6600"
                  />
                )}
                {/* Support label */}
                <text
                  x={supportX}
                  y={frameRect.y + frameRect.height + 40}
                  textAnchor="middle"
                  fontSize="9"
                  fill={section.supportType === "leg" ? "#0066cc" : "#cc6600"}
                  fontWeight="bold"
                >
                  {section.supportType === "leg" ? "Leg" : "Hook"}
                </text>
              </g>
            )}
            
            {/* Section label with arrow */}
            <line
              x1={sectionCenterX}
              y1={frameRect.y - 25}
              x2={sectionCenterX}
              y2={frameRect.y - 15}
              stroke="#333"
              strokeWidth="2"
              markerEnd="url(#arrowhead-section)"
            />
            <text
              x={sectionCenterX}
              y={frameRect.y - 30}
              textAnchor="middle"
              fontSize="11"
              fill="#333"
              fontWeight="bold"
            >
              {section.name || `Section ${index + 1}`}
            </text>
            {/* Section length label */}
            <text
              x={sectionCenterX}
              y={frameRect.y + frameRect.height + 20}
              textAnchor="middle"
              fontSize="10"
              fill="#666"
            >
              {sectionLength.toFixed(0)}mm
            </text>
          </g>
        )
      })}

      {/* Arrow marker for section labels */}
      <defs>
        <marker id="arrowhead-section" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <polygon points="0 0, 8 4, 0 8" fill="#333" />
        </marker>
      </defs>

      {/* Load indicators */}
      {loads.map((load, index) => {
        if (load.type === "Distributed Load") {
          let loadLengthMM = 0;
          let loadWidthMM = 0;
          let loadArea = 0;
          
          if (load.loadLength && load.loadWidth) {
            // For baseframe: use length and width directly
            loadLengthMM = validatePositive(load.loadLength, 100);
            loadWidthMM = validatePositive(load.loadWidth, 100);
            loadArea = (loadLengthMM * loadWidthMM) / 1_000_000; // Convert to m²
          } else if (load.area) {
            // For simple beam: convert area to square side length
            loadLengthMM = Math.sqrt(validatePositive(load.area, 1)) * 1000;
            loadWidthMM = loadLengthMM; // Square
            loadArea = load.area;
          } else {
            return null; // Skip invalid load
          }
          
          const loadStartPos = validateNumber(load.startPosition, 0);
          const x = margin + loadStartPos * scaleX; // Start from left side (startPosition)
          const y = margin + 30 + (validFrameWidth * scaleY) / 2 - (loadWidthMM * scaleY) / 2;
          const loadValue =
            load.unit === "lbs" || load.unit === "kg"
              ? getDistributedLoadTotalWeightN(load)
              : load.magnitude * loadArea;
          return (
            <g key={index}>
              <rect
                x={Math.max(margin, validateNumber(x, margin))}
                y={Math.max(margin + 30, validateNumber(y, margin + 30))}
                width={validatePositive(Math.min(loadLengthMM * scaleX, validFrameLength * scaleX), 10)}
                height={validatePositive(Math.min(loadWidthMM * scaleY, validFrameWidth * scaleY), 10)}
                fill="rgba(255, 0, 0, 0.3)"
                stroke="red"
                strokeWidth="1"
              />
              <text
                x={
                  Math.max(margin, validateNumber(x, margin)) +
                  validatePositive(Math.min(loadLengthMM * scaleX, validFrameLength * scaleX), 10) / 2
                }
                y={Math.max(margin + 30, validateNumber(y, margin + 30)) - 8}
                textAnchor="middle"
                fontSize="10"
                fill="red"
                fontWeight="bold"
              >
                {loadValue.toFixed(0)}N
              </text>
              {load.name && (
                <text
                  x={
                    Math.max(margin, validateNumber(x, margin)) +
                    validatePositive(Math.min(loadLengthMM * scaleX, validFrameLength * scaleX), 10) / 2
                  }
                  y={Math.max(margin + 30, validateNumber(y, margin + 30)) - 22}
                  textAnchor="middle"
                  fontSize="9"
                  fill="red"
                  fontStyle="italic"
                >
                  {load.name}
                </text>
              )}
            </g>
          );
        } else {
          const loadStartPos = validateNumber(load.startPosition, 0)
          const x = margin + loadStartPos * scaleX
          const y = margin + 30 + (validFrameWidth * scaleY) / 2
          return (
            <g key={index}>
              <line x1={x} y1={y - 25} x2={x} y2={y} stroke="red" strokeWidth="3" markerEnd="url(#redArrowhead)" />
              <text x={x} y={y - 30} textAnchor="middle" fontSize="10" fill="red" fontWeight="bold">
                {load.magnitude.toFixed(0)}N
              </text>
              {load.name && (
                <text x={x} y={y - 45} textAnchor="middle" fontSize="9" fill="red" fontStyle="italic">
                  {load.name}
                </text>
              )}
            </g>
          )
        }
      })}

      {/* Arrow definitions */}
      <defs>
        <marker id="redArrowhead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="red" />
        </marker>
      </defs>

      {/* Labels */}
      <text x={svgWidth / 2} y={svgHeight - 15} textAnchor="middle" fontSize="12">
        Base Frame: {validFrameLength}mm × {validFrameWidth}mm
      </text>
      <text x={10} y={20} fontSize="12" fill="blue">
        Longitudinal Beams (2)
      </text>
      <text x={10} y={35} fontSize="12" fill="red">
        Transverse Beams (2)
      </text>
    </svg>
  )
}

