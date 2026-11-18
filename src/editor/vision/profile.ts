import type { SceneJSON } from '../../core/types'
import type { IRenderView, VisionCameraSettings } from '../../render/api'

export interface VisionPlcMapping {
  request: string
  found: string
  centerX: string
  centerY: string
  done: string
  fault: string
}

export interface VisionProfile {
  camera: VisionCameraSettings
  color: string
  tolerance: number
  minArea: number
  planeY: number | null
  plcMode: 'pixel' | 'plane'
  automatic: boolean
  mapping: VisionPlcMapping
}

export const VISION_LESSON_TARGET = 'vision-inspection-red'
export const VISION_LESSON_GANTRY = 'vision-inspection-gantry'
export const VISION_LESSON_LIGHT = 'vision-inspection-light'

export function cameraFromView(view: IRenderView): VisionCameraSettings {
  const { px, py, pz, tx, ty, tz } = view.cameraPose()
  return { position: [px, py, pz], target: [tx, ty, tz], fov: 50, width: 320, height: 240, lightIntensity: 0 }
}

function isVisionLesson(scene: SceneJSON | undefined): boolean {
  return Boolean(scene && [VISION_LESSON_TARGET, VISION_LESSON_GANTRY, VISION_LESSON_LIGHT].every((id) => scene.parts.some((part) => part.id === id)))
}

export function hasAutomaticVision(documentId: string | null, scene: SceneJSON): boolean {
  try {
    return (documentId ? loadVisionProfile(documentId)?.automatic : undefined) ?? isVisionLesson(scene)
  } catch {
    return isVisionLesson(scene)
  }
}

export function defaultVisionProfile(view: IRenderView, scene: SceneJSON | undefined): VisionProfile {
  if (isVisionLesson(scene)) {
    return {
      camera: { position: [-0.65, 1.6, 0.32], target: [-0.65, 0.3, 0.32], fov: 38, width: 320, height: 240, lightIntensity: 4 },
      color: '#ad2c24', tolerance: 57, minArea: 40, planeY: 0.3, plcMode: 'plane', automatic: true,
      mapping: { request: 'VisionRequest', found: 'VisionFound', centerX: 'VisionX', centerY: 'VisionZ', done: 'VisionDone', fault: 'VisionFault' },
    }
  }
  return {
    camera: cameraFromView(view), color: '#c04030', tolerance: 60, minArea: 30, planeY: null, plcMode: 'pixel', automatic: false,
    mapping: { request: '', found: '', centerX: '', centerY: '', done: '', fault: '' },
  }
}

const profileKey = (documentId: string): string => 'oip-web/vision/' + documentId
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const point = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(finite)

export function validVisionProfile(value: unknown): value is VisionProfile {
  if (!record(value) || !record(value.camera) || !record(value.mapping)) return false
  const { camera, mapping, color, tolerance, minArea, planeY, plcMode, automatic } = value
  const { position, target, fov, width, height, lightIntensity } = camera
  return point(position) && point(target)
    && Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) >= 0.001
    && finite(fov) && fov >= 10 && fov <= 120
    && (width === 320 || width === 640) && height === width * 3 / 4
    && finite(lightIntensity) && lightIntensity >= 0 && lightIntensity <= 100
    && typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)
    && finite(tolerance) && Number.isInteger(tolerance) && tolerance >= 0 && tolerance <= 200
    && finite(minArea) && Number.isInteger(minArea) && minArea >= 1 && minArea <= width * height
    && (planeY === null || finite(planeY))
    && (plcMode === 'pixel' || plcMode === 'plane')
    && typeof automatic === 'boolean'
    && ['request', 'found', 'centerX', 'centerY', 'done', 'fault'].every((key) =>
      typeof mapping[key] === 'string' && mapping[key].length <= 160)
}

export function loadVisionProfile(documentId: string): VisionProfile | null {
  const raw = localStorage.getItem(profileKey(documentId))
  if (raw === null) return null
  const saved: unknown = JSON.parse(raw)
  if (!record(saved) || saved.version !== 1 || !validVisionProfile(saved.profile)) throw new Error('Invalid saved vision profile.')
  return saved.profile
}

export function saveVisionProfile(documentId: string, profile: VisionProfile): boolean {
  if (!validVisionProfile(profile)) return false
  localStorage.setItem(profileKey(documentId), JSON.stringify({ version: 1, profile }))
  return true
}

export function resetVisionProfile(documentId: string): void {
  localStorage.removeItem(profileKey(documentId))
}
