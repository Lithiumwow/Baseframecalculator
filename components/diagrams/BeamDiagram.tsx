import type React from "react"
import type { Load } from "../../types"
import { validateNumber, validatePositive } from "../../utils/validation"

interface BeamDiagramProps {
  beamLength: number
  leftSupport: number
  rightSupport: number
  loads: Load[]
}

export const BeamDiagram: React.FC<BeamDiagramProps> = ({ beamLength, leftSupport, rightSupport, loads }) => {
  const svgWidth = 500
  const svgHeight = 250
  const margin = 50
  const validBeamLength = validatePositive(beamLength, 1000)
  const validLeftSupport = validateNumber(leftSupport, 0)
  const validRightSupport = validateNumber(rightSupport, validBeamLength)

  const beamY = svgHeight / 2
  const supportSize = 15

  return (
    <svg width={svgWidth} height={svgHeight} className="mx-auto" id="beam-structure-diagram" style={{ fontFamily: '"Noto Sans", sans-serif' }}>
      {/* Beam line */}
      <line x1={margin} y1={beamY} x2={svgWidth - margin} y2={beamY} stroke="black" strokeWidth="3" />

      {/* Supports */}
      <g>
        <line
          x1={margin + (validLeftSupport / validBeamLength) * (svgWidth - 2 * margin)}
          y1={beamY}
          x2={margin + (validLeftSupport / validBeamLength) * (svgWidth - 2 * margin)}
          y2={beamY + supportSize}
          stroke="blue"
          strokeWidth="3"
        />
        <polygon
          points={`${margin + (validLeftSupport / validBeamLength) * (svgWidth - 2 * margin) - supportSize / 2},${beamY + supportSize} ${margin + (validLeftSupport / validBeamLength) * (svgWidth - 2 * margin) + supportSize / 2},${beamY + supportSize} ${margin + (validLeftSupport / validBeamLength) * (svgWidth - 2 * margin)},${beamY + supportSize + supportSize / 2}`}
          fill="blue"
        />
        <line
          x1={margin + (validRightSupport / validBeamLength) * (svgWidth - 2 * margin)}
          y1={beamY}
          x2={margin + (validRightSupport / validBeamLength) * (svgWidth - 2 * margin)}
          y2={beamY + supportSize}
          stroke="blue"
          strokeWidth="3"
        />
        <polygon
          points={`${margin + (validRightSupport / validBeamLength) * (svgWidth - 2 * margin) - supportSize / 2},${beamY + supportSize} ${margin + (validRightSupport / validBeamLength) * (svgWidth - 2 * margin) + supportSize / 2},${beamY + supportSize} ${margin + (validRightSupport / validBeamLength) * (svgWidth - 2 * margin)},${beamY + supportSize + supportSize / 2}`}
          fill="blue"
        />
      </g>

      {/* Arrow marker definition */}
      <defs>
        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="red" />
        </marker>
      </defs>

      {/* Load Arrows */}
      {loads.map((load, index) => {
        const loadStartX = margin + (load.startPosition / validBeamLength) * (svgWidth - 2 * margin)
        const loadEndX =
          load.type === "Uniform Load"
            ? margin + ((load.endPosition || load.startPosition) / validBeamLength) * (svgWidth - 2 * margin)
            : loadStartX

        if (load.type === "Point Load") {
          return (
            <g key={index}>
              <line
                x1={loadStartX}
                y1={beamY - 70}
                x2={loadStartX}
                y2={beamY}
                stroke="red"
                strokeWidth="2"
                markerEnd="url(#arrowhead)"
              />
              <text x={loadStartX} y={beamY - 80} textAnchor="middle" fontSize="11" fill="red" fontWeight="bold">
                {load.magnitude.toFixed(0)} N
              </text>
              {load.name && (
                <text x={loadStartX} y={beamY - 95} textAnchor="middle" fontSize="9" fill="red" fontStyle="italic">
                  {load.name}
                </text>
              )}
            </g>
          )
        } else {
          return (
            <g key={index}>
              <rect
                x={Math.min(loadStartX, loadEndX)}
                y={beamY - 50}
                width={Math.abs(loadEndX - loadStartX)}
                height={40}
                fill="rgba(255, 0, 0, 0.3)"
                stroke="red"
                strokeWidth="1"
              />
              <text
                x={(loadStartX + loadEndX) / 2}
                y={beamY - 55}
                textAnchor="middle"
                fontSize="10"
                fill="red"
                fontWeight="bold"
              >
                {load.magnitude.toFixed(0)} N/m
              </text>
              {load.name && (
                <text
                  x={(loadStartX + loadEndX) / 2}
                  y={beamY - 70}
                  textAnchor="middle"
                  fontSize="9"
                  fill="red"
                  fontStyle="italic"
                >
                  {load.name}
                </text>
              )}
            </g>
          )
        }
      })}

      {/* Dimension line */}
      <line x1={margin} y1={beamY + supportSize + 25} x2={svgWidth - margin} y2={beamY + supportSize + 25} stroke="black" strokeWidth="1" />
      <line x1={margin} y1={beamY + supportSize + 20} x2={margin} y2={beamY + supportSize + 30} stroke="black" strokeWidth="1" />
      <line
        x1={svgWidth - margin}
        y1={beamY + supportSize + 20}
        x2={svgWidth - margin}
        y2={beamY + supportSize + 30}
        stroke="black"
        strokeWidth="1"
      />
      <text x={margin} y={beamY + supportSize + 25} textAnchor="middle" fontSize="12">
        0
      </text>
      <text x={svgWidth - margin} y={beamY + supportSize + 25} textAnchor="middle" fontSize="12">
        {validBeamLength}
      </text>
      <text x={svgWidth / 2} y={svgHeight - 15} textAnchor="middle" fontSize="12">
        Beam Length: {validBeamLength} mm
      </text>
    </svg>
  )
}

