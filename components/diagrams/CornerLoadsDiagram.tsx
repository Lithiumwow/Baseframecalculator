import type React from "react"
import type { Load, Section } from "../../types"
import { validateNumber, validatePositive } from "../../utils/validation"
import { nToKg, nToLbs, getDistributedLoadTotalWeightN } from "../../utils/conversions"

interface CornerLoadsDiagramProps {
  frameLength: number
  frameWidth: number
  loads: Load[]
  cornerReactionForce: number
  cornerReactions?: { R1: number; R2: number; R3: number; R4: number }
  sections?: Section[]
}

export const CornerLoadsDiagram: React.FC<CornerLoadsDiagramProps> = ({
  frameLength,
  frameWidth,
  loads,
  cornerReactionForce,
  cornerReactions,
  sections = [],
}) => {
  const svgWidth = 700 // Increased width further to prevent overlap
  const svgHeight = 520 // Increased height to accommodate two-row table layout
  const margin = 80

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
    <svg width={svgWidth} height={svgHeight} className="mx-auto" id="corner-loads-diagram">
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

      {/* Corner reaction forces - Positioned to prevent overlap */}
      {[
        { 
          x: frameRect.x, 
          y: frameRect.y, 
          label: "R1", 
          reaction: cornerReactions?.R1 || cornerReactionForce,
          offsetX: -25, // Position to the left for top-left corner
          offsetY: -55
        },
        { 
          x: frameRect.x + frameRect.width, 
          y: frameRect.y, 
          label: "R2", 
          reaction: cornerReactions?.R2 || cornerReactionForce,
          offsetX: 25, // Position to the right for top-right corner
          offsetY: -55
        },
        { 
          x: frameRect.x, 
          y: frameRect.y + frameRect.height, 
          label: "R3", 
          reaction: cornerReactions?.R3 || cornerReactionForce,
          offsetX: -25, // Position to the left for bottom-left corner
          offsetY: 15
        },
        { 
          x: frameRect.x + frameRect.width, 
          y: frameRect.y + frameRect.height, 
          label: "R4", 
          reaction: cornerReactions?.R4 || cornerReactionForce,
          offsetX: 25, // Position to the right for bottom-right corner
          offsetY: 15
        },
      ].map((corner, index) => (
        <g key={index}>
          {/* Reaction force arrow */}
          <line
            x1={corner.x}
            y1={corner.y + (corner.offsetY < 0 ? -35 : 0)}
            x2={corner.x}
            y2={corner.y}
            stroke="blue"
            strokeWidth="2.5"
            markerEnd="url(#blueArrowhead)"
          />
          {/* Corner label and value - positioned to avoid overlap */}
          <text 
            x={corner.x + corner.offsetX} 
            y={corner.y + corner.offsetY} 
            textAnchor="middle" 
            fontSize="12" 
            fill="blue" 
            fontWeight="bold"
          >
            {corner.label}: {corner.reaction.toFixed(0)} N
          </text>
        </g>
      ))}

      {/* Section dividers and supports - Simplified to prevent clutter */}
      {sections.map((section, index) => {
        const dividerX = margin + section.endPosition * scaleX
        const supportX = margin + section.startPosition * scaleX
        
        return (
          <g key={section.id}>
            {/* Simple vertical divider line at section end (if not last section) */}
            {index < sections.length - 1 && (
              <line
                x1={dividerX}
                y1={frameRect.y - 10}
                x2={dividerX}
                y2={frameRect.y + frameRect.height + 5}
                stroke="#999"
                strokeWidth="1.5"
                strokeDasharray="4,4"
                opacity="0.6"
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
                  y2={frameRect.y + frameRect.height + 15}
                  stroke={section.supportType === "leg" ? "#0066cc" : "#cc6600"}
                  strokeWidth="2.5"
                />
                {/* Leg support - triangle pointing down */}
                {section.supportType === "leg" && (
                  <polygon
                    points={`${supportX - 6},${frameRect.y + frameRect.height + 15} ${supportX + 6},${frameRect.y + frameRect.height + 15} ${supportX},${frameRect.y + frameRect.height + 22}`}
                    fill="#0066cc"
                  />
                )}
                {/* Hook support - inverted triangle */}
                {section.supportType === "hook" && (
                  <polygon
                    points={`${supportX - 6},${frameRect.y + frameRect.height + 15} ${supportX + 6},${frameRect.y + frameRect.height + 15} ${supportX},${frameRect.y + frameRect.height + 8}`}
                    fill="#cc6600"
                  />
                )}
              </g>
            )}
          </g>
        )
      })}

      {/* Applied loads */}
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
          const y = margin + 40 + (validFrameWidth * scaleY) / 2 - (loadWidthMM * scaleY) / 2;
          const loadValue =
            load.unit === "lbs" || load.unit === "kg"
              ? getDistributedLoadTotalWeightN(load)
              : load.magnitude * loadArea;
          return (
            <g key={index}>
              <rect
                x={Math.max(margin, validateNumber(x, margin))}
                y={Math.max(margin + 40, validateNumber(y, margin + 40))}
                width={validatePositive(Math.min(loadLengthMM * scaleX, validFrameLength * scaleX), 10)}
                height={validatePositive(Math.min(loadWidthMM * scaleY, validFrameWidth * scaleY), 10)}
                fill="rgba(255, 0, 0, 0.3)"
                stroke="red"
                strokeWidth="2"
              />
              {/* Load label - positioned inside the box to avoid overlap */}
              {loadLengthMM * scaleX > 40 && (
                <text
                  x={
                    Math.max(margin, validateNumber(x, margin)) +
                    validatePositive(Math.min(loadLengthMM * scaleX, validFrameLength * scaleX), 10) / 2
                  }
                  y={
                    Math.max(margin + 40, validateNumber(y, margin + 40)) +
                    validatePositive(Math.min(loadWidthMM * scaleY, validFrameWidth * scaleY), 10) / 2 + 4
                  }
                  textAnchor="middle"
                  fontSize="9"
                  fill="red"
                  fontWeight="bold"
                >
                  {loadValue.toFixed(0)}N
                </text>
              )}
            </g>
          );
        } else {
          const loadStartPos = validateNumber(load.startPosition, 0)
          const x = margin + loadStartPos * scaleX
          const y = margin + 40 + (validFrameWidth * scaleY) / 2
          return (
            <g key={index}>
              <line x1={x} y1={y - 20} x2={x} y2={y} stroke="red" strokeWidth="2.5" markerEnd="url(#redArrowhead)" />
              <text x={x} y={y - 25} textAnchor="middle" fontSize="9" fill="red" fontWeight="bold">
                {load.magnitude.toFixed(0)}N
              </text>
            </g>
          )
        }
      })}

      {/* Arrow definitions */}
      <defs>
        <marker id="blueArrowhead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="blue" />
        </marker>
        <marker id="redArrowhead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="red" />
        </marker>
      </defs>

      {/* Corner reactions table below diagram - Two row layout to prevent overlap */}
      {cornerReactions && (
        <g>
          {/* Table background */}
          <rect
            x={margin}
            y={frameRect.y + frameRect.height + 15}
            width={svgWidth - 2 * margin}
            height={70}
            fill="#f8f9fa"
            stroke="#dee2e6"
            strokeWidth="1"
            rx="4"
          />
          
          {/* Table header */}
          <text
            x={svgWidth / 2}
            y={frameRect.y + frameRect.height + 30}
            textAnchor="middle"
            fontSize="11"
            fontWeight="bold"
            fill="#333"
          >
            Corner Reactions
          </text>
          
          {/* Row 1: R1 and R2 */}
          {[
            { label: "R1", x: margin + (svgWidth - 2 * margin) / 4, idx: 0 },
            { label: "R2", x: margin + (3 * (svgWidth - 2 * margin)) / 4, idx: 1 },
          ].map((corner) => {
            const reactionKey = `R${corner.idx + 1}` as keyof typeof cornerReactions
            const reaction = cornerReactions[reactionKey] || 0
            const kgf = nToKg(reaction)
            const lbf = nToLbs(reaction)
            
            // Format: R1 -> N xx | kgf -> xx | lbf ->xx
            const formattedText = `${corner.label} -> N ${reaction.toFixed(0)} | kgf ${kgf.toFixed(1)} | lbf ${lbf.toFixed(1)}`
            
            return (
              <text
                key={corner.label}
                x={corner.x}
                y={frameRect.y + frameRect.height + 48}
                textAnchor="middle"
                fontSize="8"
                fill="#333"
              >
                {formattedText}
              </text>
            )
          })}
          
          {/* Row 2: R3 and R4 */}
          {[
            { label: "R3", x: margin + (svgWidth - 2 * margin) / 4, idx: 2 },
            { label: "R4", x: margin + (3 * (svgWidth - 2 * margin)) / 4, idx: 3 },
          ].map((corner) => {
            const reactionKey = `R${corner.idx + 1}` as keyof typeof cornerReactions
            const reaction = cornerReactions[reactionKey] || 0
            const kgf = nToKg(reaction)
            const lbf = nToLbs(reaction)
            
            // Format: R3 -> N xx | kgf -> xx | lbf ->xx
            const formattedText = `${corner.label} -> N ${reaction.toFixed(0)} | kgf ${kgf.toFixed(1)} | lbf ${lbf.toFixed(1)}`
            
            return (
              <text
                key={corner.label}
                x={corner.x}
                y={frameRect.y + frameRect.height + 65}
                textAnchor="middle"
                fontSize="8"
                fill="#333"
              >
                {formattedText}
              </text>
            )
          })}
        </g>
      )}

      {/* Simplified dimension labels - moved further down to avoid overlap */}
      <text x={svgWidth / 2} y={svgHeight - 5} textAnchor="middle" fontSize="11" fill="#666">
        {validFrameLength}mm × {validFrameWidth}mm
      </text>
    </svg>
  )
}

