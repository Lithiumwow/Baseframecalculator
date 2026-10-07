"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { Button } from "@/components/ui/button"
import type { Load, Section, Results } from "../types"
import { getDistributedLoadTotalWeightN, getLoadMagnitudeInN } from "../utils/conversions"
import { buildMomentContour, intensityToRgb } from "../utils/frameContour"
import type { COGResult } from "../utils/cogCalculation"

export interface Frame3DViewerProps {
  frameLength: number
  frameWidth: number
  sections: Section[]
  loads: Load[]
  results: Results
  bendingMomentData: Array<{ x: number; y: number | null }>
  cog?: COGResult | null
  className?: string
}

const SECTION_TINTS = [0x60a5fa, 0xfbbf24, 0x34d399, 0xf472b6, 0xa78bfa, 0xfb923c]

type ViewApi = {
  fit: () => void
  iso: () => void
  front: () => void
  top: () => void
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  })
}

function makeArrow(
  color: number,
  length: number,
  shaftRadius: number,
  headRadius: number,
  headLength: number
): THREE.Group {
  const g = new THREE.Group()
  const shaftLen = Math.max(0.01, length - headLength)
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLen, 10),
    new THREE.MeshLambertMaterial({ color })
  )
  shaft.position.y = shaftLen / 2
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(headRadius, headLength, 12),
    new THREE.MeshLambertMaterial({ color })
  )
  head.position.y = shaftLen + headLength / 2
  g.add(shaft, head)
  return g
}

function makeLabelSprite(text: string, color = "#0f172a", bg = "rgba(255,255,255,0.92)"): THREE.Sprite {
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!
  const pad = 10
  ctx.font = "600 28px 'Segoe UI', sans-serif"
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  const h = 40
  canvas.width = w
  canvas.height = h
  ctx.font = "600 28px 'Segoe UI', sans-serif"
  ctx.fillStyle = bg
  ctx.strokeStyle = "rgba(15,23,42,0.25)"
  ctx.lineWidth = 2
  const r = 8
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.arcTo(w, 0, w, h, r)
  ctx.arcTo(w, h, 0, h, r)
  ctx.arcTo(0, h, 0, 0, r)
  ctx.arcTo(0, 0, w, 0, r)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, w / 2, h / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(material)
  const scale = 0.22
  sprite.scale.set((w / h) * scale, scale, 1)
  return sprite
}

export function Frame3DViewer({
  frameLength,
  frameWidth,
  sections,
  loads,
  results,
  bendingMomentData,
  cog,
  className,
}: Frame3DViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ViewApi | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const L = Math.max(frameLength, 1) / 1000
    const W = Math.max(frameWidth, 1) / 1000
    const beamH = 0.08
    const beamT = 0.04
    const casingH = 0.35
    const contentTop = beamH + casingH + 0.55 // include load arrows
    const contentBottom = -0.45 // reactions below

    const center = new THREE.Vector3(L / 2, (contentTop + contentBottom) / 2, W / 2)
    const size = new THREE.Vector3(L, contentTop - contentBottom, W)
    const radius = Math.max(size.length() * 0.5, 0.35)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf3f4f6)

    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.rotateSpeed = 0.7
    controls.zoomSpeed = 0.85
    controls.panSpeed = 0.5
    controls.screenSpacePanning = true
    controls.enablePan = true
    controls.minDistance = radius * 0.55
    controls.maxDistance = radius * 4.5
    controls.maxPolarAngle = Math.PI * 0.49 // stay above ground
    controls.minPolarAngle = 0.08
    controls.target.copy(center)
    // Keep orbit target near the model so it doesn't "fly away"
    const maxPan = radius * 1.25
    const clampTarget = () => {
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, center.x - maxPan, center.x + maxPan)
      controls.target.y = THREE.MathUtils.clamp(controls.target.y, center.y - maxPan * 0.6, center.y + maxPan * 0.6)
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, center.z - maxPan, center.z + maxPan)
    }
    controls.addEventListener("change", clampTarget)

    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const key = new THREE.DirectionalLight(0xffffff, 0.85)
    key.position.set(L + 2, L + 2, W + 2)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.35)
    fill.position.set(-L, L * 0.5, -W)
    scene.add(fill)

    const root = new THREE.Group()
    scene.add(root)

    const loadPeaks: Array<{ xMm: number; weight: number }> = []
    loads.forEach((load) => {
      let forceN = 0
      let xMm = load.startPosition
      if (load.type === "Distributed Load") {
        forceN = getDistributedLoadTotalWeightN(load)
        const len = load.loadLength || (load.area ? Math.sqrt(load.area) * 1000 : 0)
        xMm = load.startPosition + len / 2
      } else if (load.type === "Uniform Load" && load.endPosition != null) {
        forceN = getLoadMagnitudeInN(load) * ((load.endPosition - load.startPosition) / 1000)
        xMm = (load.startPosition + load.endPosition) / 2
      } else {
        forceN = getLoadMagnitudeInN(load)
      }
      if (forceN > 0) loadPeaks.push({ xMm, weight: forceN })
    })
    sections.forEach((section) => {
      let n = section.casingWeight || 0
      if (section.casingWeightUnit === "kg") n *= 9.81
      else if (section.casingWeightUnit === "lbs") n *= 4.44822
      if (n > 0) {
        loadPeaks.push({
          xMm: (section.startPosition + section.endPosition) / 2,
          weight: n,
        })
      }
    })

    const contour = buildMomentContour(bendingMomentData, frameLength, 40, loadPeaks)
    const segCount = Math.max(8, contour.length - 1)

    const addBeamSegment = (x0: number, x1: number, z: number, intensity: number) => {
      const len = Math.max(0.001, x1 - x0)
      const [r, g, b] = intensityToRgb(intensity)
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(r / 255, g / 255, b / 255),
      })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, beamH, beamT), mat)
      mesh.position.set((x0 + x1) / 2, beamH / 2, z)
      root.add(mesh)
    }

    for (let i = 0; i < segCount; i++) {
      const c0 = contour[i] ?? { xMm: (frameLength * i) / segCount, intensity: 0 }
      const c1 = contour[i + 1] ?? {
        xMm: (frameLength * (i + 1)) / segCount,
        intensity: c0.intensity,
      }
      const intensity = (c0.intensity + c1.intensity) / 2
      addBeamSegment(c0.xMm / 1000, c1.xMm / 1000, beamT / 2, intensity)
      addBeamSegment(c0.xMm / 1000, c1.xMm / 1000, W - beamT / 2, intensity)
    }

    const endMat = new THREE.MeshLambertMaterial({ color: 0x64748b })
    for (const x of [beamT / 2, L - beamT / 2]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(beamT, beamH, W), endMat)
      mesh.position.set(x, beamH / 2, W / 2)
      root.add(mesh)
    }

    const crossXs = new Set<number>([0, frameLength])
    sections.forEach((s, idx) => {
      if (idx > 0) crossXs.add(s.startPosition)
      crossXs.add(s.endPosition)
    })
    ;(results.legSupportPositionsMm || []).forEach((p) => crossXs.add(p))
    const crossMat = new THREE.MeshLambertMaterial({ color: 0x475569 })
    for (const xmm of crossXs) {
      if (xmm <= 0 || xmm >= frameLength) continue
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(beamT * 0.8, beamH * 0.85, W), crossMat)
      mesh.position.set(xmm / 1000, beamH / 2, W / 2)
      root.add(mesh)
    }

    sections.forEach((section, index) => {
      const x0 = section.startPosition / 1000
      const x1 = section.endPosition / 1000
      const len = Math.max(0.01, x1 - x0)
      const midX = (x0 + x1) / 2
      const mat = new THREE.MeshLambertMaterial({
        color: SECTION_TINTS[index % SECTION_TINTS.length],
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      })
      const box = new THREE.Mesh(new THREE.BoxGeometry(len * 0.98, casingH, W * 0.92), mat)
      box.position.set(midX, beamH + casingH / 2, W / 2)
      root.add(box)

      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, casingH * 0.95, W * 0.94),
        new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.35 })
      )
      edge.position.set(x0, beamH + casingH / 2, W / 2)
      root.add(edge)

      const label = makeLabelSprite(section.name || `Section ${index + 1}`)
      label.position.set(midX, beamH + casingH + 0.12, W / 2)
      root.add(label)
    })

    const maxLoadN = Math.max(1, ...loadPeaks.map((p) => p.weight))

    loads.forEach((load) => {
      let forceN = 0
      let xMm = load.startPosition
      let zMm = frameWidth / 2
      let footprintLen = 0

      if (load.type === "Distributed Load") {
        forceN = getDistributedLoadTotalWeightN(load)
        const len = load.loadLength || (load.area ? Math.sqrt(load.area) * 1000 : 0)
        footprintLen = len
        xMm = load.startPosition + len / 2
      } else if (load.type === "Uniform Load" && load.endPosition != null) {
        forceN = getLoadMagnitudeInN(load) * ((load.endPosition - load.startPosition) / 1000)
        xMm = (load.startPosition + load.endPosition) / 2
      } else {
        forceN = getLoadMagnitudeInN(load)
        xMm = load.startPosition
      }

      if (forceN <= 0) return
      const scale = 0.12 + 0.35 * Math.min(1, forceN / maxLoadN)
      const arrow = makeArrow(0xef4444, scale, 0.012, 0.03, 0.05)
      arrow.rotation.x = Math.PI
      arrow.position.set(
        Math.min(L, Math.max(0, xMm / 1000)),
        beamH + casingH + scale + 0.05,
        Math.min(W, Math.max(0, zMm / 1000))
      )
      root.add(arrow)

      if (footprintLen > 0) {
        const fp = new THREE.Mesh(
          new THREE.BoxGeometry(
            footprintLen / 1000,
            0.01,
            Math.min(W * 0.7, (load.loadWidth || frameWidth) / 1000)
          ),
          new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.35 })
        )
        fp.position.set(xMm / 1000, beamH + casingH + 0.02, W / 2)
        root.add(fp)
      }
    })

    sections.forEach((section) => {
      const unit = section.casingWeightUnit || "kg"
      let n = section.casingWeight || 0
      if (unit === "kg") n *= 9.81
      else if (unit === "lbs") n *= 4.44822
      if (n <= 0) return
      const x = (section.startPosition + section.endPosition) / 2 / 1000
      const scale = 0.08 + 0.2 * Math.min(1, n / maxLoadN)
      const arrow = makeArrow(0xf59e0b, scale, 0.01, 0.024, 0.04)
      arrow.rotation.x = Math.PI
      arrow.position.set(x, beamH + casingH + scale + 0.02, W * 0.3)
      root.add(arrow)
    })

    // Corner support reactions (gravity case) — not lifting lugs
    const R = results.cornerReactions || { R1: 0, R2: 0, R3: 0, R4: 0 }
    const maxR = Math.max(1, R.R1, R.R2, R.R3, R.R4)
    const corners = [
      { x: 0, z: 0, r: R.R1, name: "R1" },
      { x: L, z: 0, r: R.R2, name: "R2" },
      { x: 0, z: W, r: R.R3, name: "R3" },
      { x: L, z: W, r: R.R4, name: "R4" },
    ]
    corners.forEach((c) => {
      if (c.r <= 0) return
      const scale = 0.08 + 0.22 * (c.r / maxR)
      // Support reaction: pad on ground + short upward arrow (frame sitting on supports)
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.05, 0.02, 16),
        new THREE.MeshLambertMaterial({ color: 0x16a34a })
      )
      pad.position.set(c.x, -0.03, c.z)
      root.add(pad)
      const arrow = makeArrow(0x16a34a, scale, 0.01, 0.024, 0.035)
      arrow.position.set(c.x, -0.02, c.z)
      root.add(arrow)
      const tag = makeLabelSprite(c.name, "#14532d", "rgba(220,252,231,0.95)")
      tag.position.set(c.x, scale + 0.05, c.z)
      root.add(tag)
    })

    if (cog && Number.isFinite(cog.cogX) && Number.isFinite(cog.cogY)) {
      const cogMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 16, 16),
        new THREE.MeshLambertMaterial({ color: 0xf97316 })
      )
      cogMesh.position.set(cog.cogX / 1000, beamH + casingH * 0.55, cog.cogY / 1000)
      root.add(cogMesh)
    }

    const grid = new THREE.GridHelper(Math.max(L, W) * 1.4, 12, 0xcbd5e1, 0xe2e8f0)
    grid.position.set(L / 2, -0.001, W / 2)
    root.add(grid)

    const fitDistance = () => {
      const fov = THREE.MathUtils.degToRad(camera.fov)
      const aspect = Math.max(camera.aspect, 0.1)
      const fitHeightDistance = radius / Math.sin(fov / 2)
      const fitWidthDistance = radius / Math.sin(fov / 2) / aspect
      return Math.max(fitHeightDistance, fitWidthDistance) * 1.15
    }

    const setView = (direction: THREE.Vector3) => {
      controls.target.copy(center)
      const dist = THREE.MathUtils.clamp(fitDistance(), controls.minDistance, controls.maxDistance)
      const dir = direction.clone().normalize()
      camera.position.copy(center).addScaledVector(dir, dist)
      camera.near = Math.max(0.01, dist / 100)
      camera.far = Math.max(100, dist * 20)
      camera.updateProjectionMatrix()
      controls.update()
      clampTarget()
    }

    const api: ViewApi = {
      fit: () => setView(new THREE.Vector3(1, 0.75, 1)),
      iso: () => setView(new THREE.Vector3(1, 0.85, 1)),
      front: () => setView(new THREE.Vector3(0, 0.15, 1)),
      top: () => setView(new THREE.Vector3(0.001, 1, 0.001)),
    }
    apiRef.current = api
    api.fit()

    const resize = () => {
      const w = mount.clientWidth || 640
      const h = mount.clientHeight || 420
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf = 0
    const tick = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.removeEventListener("change", clampTarget)
      controls.dispose()
      disposeObject(root)
      renderer.dispose()
      apiRef.current = null
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [
    frameLength,
    frameWidth,
    sections,
    loads,
    results.cornerReactions,
    results.legSupportPositionsMm,
    bendingMomentData,
    cog,
  ])

  const maxMoment = results.maxBendingMoment || 0
  const runView = (name: keyof ViewApi) => apiRef.current?.[name]()

  return (
    <div className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="text-sm text-gray-600 max-w-xl">
          Parametric baseframe: rails colored by bending moment from your loads. Labeled translucent
          boxes = sections. Red arrows = component loads (down). Amber = casing weight (down). Green
          pads/arrows = corner <em>support reactions</em> (up) — not lifting lugs
          {cog ? ". Orange = COG" : ""}.
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={() => runView("fit")}>
              Fit
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => runView("iso")}>
              Isometric
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => runView("front")}>
              Front
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => runView("top")}>
              Top
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span>Low</span>
            <div
              className="h-2.5 w-28 rounded-full"
              style={{
                background: "linear-gradient(90deg,#1d4ed8,#22c55e,#eab308,#ef4444)",
              }}
            />
            <span>High |M|</span>
            {maxMoment > 0 && (
              <span className="text-gray-500 ml-1">max {maxMoment.toFixed(0)} N·m</span>
            )}
          </div>
        </div>
      </div>
      <div
        ref={mountRef}
        className="w-full h-[420px] rounded-lg border border-gray-200 overflow-hidden bg-gray-100 touch-none"
      />
      <p className="text-xs text-gray-500 mt-2">
        Drag to orbit · scroll to zoom · right-drag to pan (limited). Use Fit if the model drifts.
        Contour uses the longitudinal moment diagram from the current analysis.
      </p>
    </div>
  )
}
